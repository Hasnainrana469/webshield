/**
 * CrawlerModule — headless Puppeteer crawler that discovers internal URLs and
 * web forms for use by downstream scan modules.
 *
 * Behaviour:
 *  - Crawls the target domain up to depth 5, capped at 500 URLs.
 *  - Records all reachable internal URLs and all web forms found
 *    (action URL, HTTP method, input field names, source page URL).
 *  - Persists the site map to `scan_site_maps` table as JSONB.
 *  - If the 500-URL cap is reached, stops crawling, persists what was
 *    collected, and logs a warning to Activity_Log.
 *  - Attaches the SiteMap as the first element of `findings` so the
 *    orchestrator can store it in `ctx.siteMap` for downstream modules.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import {
  ScanModule,
  ScanContext,
  ModuleResult,
  registerModule,
} from '../services/scanOrchestrator';
import { logEvent } from '../utils/activityLog';
import db from '../db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormRecord {
  action_url: string;
  method: 'GET' | 'POST';
  fields: string[];
  page_url: string;
}

export interface SiteMap {
  urls: string[];
  forms: FormRecord[];
  url_count: number;
  was_capped: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_URLS = 500;
const MAX_DEPTH = 5;

/** Navigation timeout per page (ms). */
const NAV_TIMEOUT_MS = 15_000;

/** Puppeteer launch args suited for a server / Docker environment. */
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a URL: strips hash, trailing slash, and enforces lowercase scheme/host.
 */
function normalise(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.pathname = u.pathname.replace(/\/$/, '') || '/';
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Returns true when `url` belongs to the same origin as `origin`.
 */
function isSameDomain(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * Extracts all same-domain <a href> links from the current page DOM.
 */
async function extractLinks(page: Page, origin: string): Promise<string[]> {
  // page.evaluate runs inside the browser; DOM types are available at runtime even
  // though the Node tsconfig does not include the "dom" lib. We use globalThis to
  // avoid TypeScript errors caused by 'document' not being in the ES2020 lib.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hrefs: string[] = await page.evaluate((): string[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc: any = (globalThis as any).document;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Array.from(doc.querySelectorAll('a[href]')).map((a: any) => a.href as string);
  });

  const links: string[] = [];
  for (const href of hrefs) {
    try {
      const abs = new URL(href, origin).toString();
      if (isSameDomain(abs, origin)) {
        links.push(normalise(abs));
      }
    } catch {
      // ignore unparseable hrefs
    }
  }
  return links;
}

/**
 * Extracts all web forms from the current page DOM.
 */
async function extractForms(page: Page, pageUrl: string, origin: string): Promise<FormRecord[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: Array<{ action: string; method: string; fields: string[] }> = await page.evaluate(
    (): Array<{ action: string; method: string; fields: string[] }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc: any = (globalThis as any).document;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(doc.querySelectorAll('form')).map((form: any) => {
        const action: string = form.action || '';
        const method: string = (form.method || 'get').toUpperCase();
        const fields: string[] = Array.from(
          form.querySelectorAll('input[name], select[name], textarea[name]'),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ).map((el: any) => el.name as string);
        return { action, method, fields };
      });
    },
  );

  const forms: FormRecord[] = [];
  for (const f of raw) {
    let actionUrl = f.action || pageUrl;
    try {
      actionUrl = new URL(f.action || pageUrl, origin).toString();
    } catch {
      actionUrl = pageUrl;
    }
    forms.push({
      action_url: actionUrl,
      method: (f.method === 'POST' ? 'POST' : 'GET') as 'GET' | 'POST',
      fields: f.fields,
      page_url: pageUrl,
    });
  }
  return forms;
}

// ---------------------------------------------------------------------------
// Module implementation
// ---------------------------------------------------------------------------

class CrawlerModule implements ScanModule {
  readonly name = 'crawler';
  readonly timeout = 600; // 10 minutes; orchestrator timeout

  async execute(ctx: ScanContext): Promise<ModuleResult> {
    const start = Date.now();
    const { scanId, targetUrl, db, logger } = ctx;

    logger.log(`[CrawlerModule] Starting crawl for ${targetUrl}`);

    const origin = (() => {
      try {
        return new URL(targetUrl).origin;
      } catch {
        return targetUrl;
      }
    })();

    // BFS state
    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [
      { url: normalise(targetUrl), depth: 0 },
    ];
    const allForms: FormRecord[] = [];
    let wasCapped = false;

    let browser: Browser | null = null;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: PUPPETEER_ARGS,
      });

      while (queue.length > 0) {
        const item = queue.shift()!;
        const { url, depth } = item;

        if (visited.has(url)) continue;
        if (!isSameDomain(url, origin)) continue;

        // Enforce URL cap (Req 8.4 / 8.5)
        if (visited.size >= MAX_URLS) {
          wasCapped = true;
          logger.warn(`[CrawlerModule] URL cap (${MAX_URLS}) reached — stopping crawl.`);
          break;
        }

        visited.add(url);

        let page: Page | null = null;
        try {
          page = await browser.newPage();
          await page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
          // Block images/fonts/media to speed up crawling
          await page.setRequestInterception(true);
          page.on('request', (req) => {
            const type = req.resourceType();
            if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
              req.abort();
            } else {
              req.continue();
            }
          });

          const response = await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => null);

          if (!response) {
            logger.warn(`[CrawlerModule] Failed to navigate to ${url}`);
            continue;
          }

          // Discover forms (Req 8.2)
          const pageForms = await extractForms(page, url, origin);
          allForms.push(...pageForms);

          // Discover links (Req 8.1)
          if (depth < MAX_DEPTH) {
            const links = await extractLinks(page, origin);
            for (const link of links) {
              if (!visited.has(link) && visited.size + queue.length < MAX_URLS + 1) {
                queue.push({ url: link, depth: depth + 1 });
              }
            }
          }
        } catch (err) {
          logger.warn(
            `[CrawlerModule] Error crawling ${url}: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          if (page) {
            await page.close().catch(() => undefined);
          }
        }
      }
    } catch (launchErr) {
      logger.error(
        `[CrawlerModule] Failed to launch Puppeteer: ${launchErr instanceof Error ? launchErr.message : String(launchErr)}`,
      );
      return { status: 'failed', findings: [], duration: Date.now() - start };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }

    const discoveredUrls = Array.from(visited);

    // Log warning to Activity_Log if cap was hit (Req 8.5)
    if (wasCapped) {
      await logEvent({
        eventType: 'crawler_cap_reached',
        targetResourceId: scanId,
        targetResourceType: 'scan',
        description:
          `Crawler reached the ${MAX_URLS}-URL cap for scan ${scanId} on target ${targetUrl}. ` +
          `${discoveredUrls.length} URLs were discovered and persisted.`,
      });
    }

    // Persist site map (Req 8.3)
    try {
      await db('scan_site_maps').insert({
        scan_id: scanId,
        urls: JSON.stringify(discoveredUrls),
        forms: JSON.stringify(allForms),
        url_count: discoveredUrls.length,
        was_capped: wasCapped,
      });
    } catch (dbErr) {
      logger.error('[CrawlerModule] Failed to persist site map:', dbErr);
    }

    const siteMap: SiteMap = {
      urls: discoveredUrls,
      forms: allForms,
      url_count: discoveredUrls.length,
      was_capped: wasCapped,
    };

    const duration = Date.now() - start;
    logger.log(
      `[CrawlerModule] Completed in ${duration}ms. ` +
        `Discovered ${discoveredUrls.length} URL(s), ${allForms.length} form(s). Capped: ${wasCapped}.`,
    );

    // The orchestrator reads findings[0] and attaches it to ctx.siteMap
    return {
      status: 'completed',
      findings: [siteMap],
      duration,
    };
  }
}

// ---------------------------------------------------------------------------
// Export and register
// ---------------------------------------------------------------------------

const crawlerModule = new CrawlerModule();
export default crawlerModule;
registerModule(crawlerModule);
