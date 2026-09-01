/**
 * Scan routes — /api/v1/scans
 *
 * All routes are protected by authenticate + requireUserRole.
 *
 * POST   /           — create scan (201 + scan_id)
 * GET    /           — paginated list of caller's scans
 * GET    /:id        — scan detail with module statuses and progress
 * POST   /:id/start  — transition pending → running (409 if not pending, 429 if limit)
 * POST   /:id/stop   — transition running → stopped (409 if not running)
 * DELETE /:id        — delete stopped/completed scan (409 if running/pending)
 * GET    /:id/vulnerabilities      — paginated vulnerability list (filterable, sortable)
 * GET    /:id/vulnerabilities/:vid — single vulnerability detail
 * GET    /:id/vulnerabilities/:vid/explain — AI explanation
 * GET    /:id/summary              — AI executive summary
 * GET    /:id/prioritized          — AI-prioritized vulnerability list
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.10, 4.11, 15.1, 15.3, 15.4, 20.1, 23.1-23.4
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireUserRole, authRateLimiter } from '../middleware';
import {
  createScan,
  getUserScans,
  getScanById,
  deleteScan,
  startScan,
  stopScan,
  getVulnerabilities,
  getVulnerabilityById,
  ValidationError,
  NotFoundError,
  ConflictError,
  ConcurrentLimitError,
} from '../services/scanService';
import {
  explainVulnerability,
  generateExecutiveSummary,
  prioritizeVulnerabilities,
  chatWithAssistant,
  AIChatMessage,
} from '../services/aiService';
import db from '../db';

const router = Router();

// Apply auth middleware to every route in this router.
// Order: authenticate → requireUserRole → authRateLimiter (Req 21.3)
router.use(authenticate, requireUserRole, authRateLimiter);

router.post('/ai/chat', async (req: Request, res: Response): Promise<void> => {
  try {
    const messages = req.body?.messages as unknown;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
      res.status(422).json({ error: 'messages must contain between 1 and 20 items.' });
      return;
    }

    const validMessages = messages.filter((message): message is AIChatMessage => (
      message &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0 &&
      message.content.length <= 2000
    ));

    if (validMessages.length !== messages.length) {
      res.status(422).json({ error: 'Each message needs a valid role and content.' });
      return;
    }

    const reply = await chatWithAssistant(validMessages);
    res.status(200).json({ reply });
  } catch (err) {
    console.error('[POST /scans/ai/chat] Unexpected error:', err);
    res.status(500).json({ error: 'Unable to reach the AI assistant.' });
  }
});

/**
 * POST /api/v1/scans
 *
 * Body: { target_url: string, modules: string[] }
 * 201 → { scan_id, status, target_url, created_at }
 * 422 → validation failure (invalid URL, bad scheme, private IP, empty modules)
 *
 * Requirements: 4.1, 4.2, 20.1
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { target_url, modules } = req.body as {
      target_url: unknown;
      modules: unknown;
    };

    const result = await createScan(req.user!.user_id, {
      target_url: target_url as string,
      modules: modules as string[],
    });

    res.status(201).json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(422).json({
        error: 'Validation failed',
        details: err.errors,
      });
      return;
    }

    console.error('[POST /scans] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans
 *
 * Query params: page (default 1), per_page (default 20, max 100)
 * 200 → { data: ScanSummary[], total, page, per_page, total_pages }
 *
 * Requirements: 4.1
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPage = parseInt((req.query.page as string) ?? '1', 10);
    const rawPerPage = parseInt((req.query.per_page as string) ?? '20', 10);

    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPage = isNaN(rawPerPage) || rawPerPage < 1 ? 20 : Math.min(rawPerPage, 100);

    const result = await getUserScans(req.user!.user_id, { page, perPage });

    res.status(200).json(result);
  } catch (err) {
    console.error('[GET /scans] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/stats
 *
 * Returns dashboard statistics for the authenticated user.
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!.user_id;
    const [{ totalScans }] = await db('scans')
      .where({ user_id: userId })
      .count<{ totalScans: string }[]>('id as totalScans');

    const vulnerabilityRows = await db('vulnerabilities')
      .join('scans', 'vulnerabilities.scan_id', 'scans.id')
      .where('scans.user_id', userId)
      .select('vulnerabilities.risk_level')
      .count('vulnerabilities.id as count')
      .groupBy('vulnerabilities.risk_level') as Array<{ risk_level: string; count: string | number }>;

    const riskDistribution = vulnerabilityRows.map((row) => ({
      risk_level: row.risk_level,
      count: Number(row.count),
    }));

    const scanStatusRows = await db('scans')
      .where({ user_id: userId })
      .select('status')
      .count('id as count')
      .groupBy('status') as Array<{ status: string; count: string | number }>;

    const since = new Date();
    since.setDate(since.getDate() - 29);
    const scanDates = await db('scans')
      .where({ user_id: userId })
      .where('created_at', '>=', since)
      .select<{ created_at: Date }[]>('created_at');

    const activityCounts = new Map<string, number>();
    for (const row of scanDates) {
      const date = new Date(row.created_at).toISOString().slice(0, 10);
      activityCounts.set(date, (activityCounts.get(date) ?? 0) + 1);
    }

    const scanActivity = Array.from(activityCounts.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, count]) => ({ date, count }));

    res.status(200).json({
      total_scans: Number(totalScans),
      total_vulnerabilities: riskDistribution.reduce((sum, item) => sum + item.count, 0),
      critical_vulnerabilities: riskDistribution.find((item) => item.risk_level === 'critical')?.count ?? 0,
      risk_distribution: riskDistribution,
      scan_status: scanStatusRows.map((row) => ({ status: row.status, count: Number(row.count) })),
      scan_activity: scanActivity,
    });
  } catch (err) {
    console.error('[GET /scans/stats] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id
 *
 * 200 → ScanDetail (with modules array and progress)
 * 404 → scan not found or belongs to another user
 *
 * Requirements: 4.1
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const detail = await getScanById(req.params.id, req.user!.user_id);
    res.status(200).json(detail);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/scans/:id/start
 *
 * Transitions a pending scan to running status and kicks off module execution.
 *
 * 200 → { scan_id, status: "running" }
 * 404 → scan not found or belongs to another user
 * 409 → scan is not in "pending" status
 * 429 → user already has 3 running scans (concurrent limit)
 *
 * Writes Activity_Log record for `scan_start`.
 *
 * Requirements: 4.3, 4.4, 4.10, 4.11, 20.1
 */
router.post('/:id/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await startScan(req.params.id, req.user!.user_id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }

    if (err instanceof ConcurrentLimitError) {
      res.status(429).json({ error: err.message });
      return;
    }

    console.error('[POST /scans/:id/start] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/scans/:id/stop
 *
 * Stops a running scan, transitioning it to "stopped" status.
 *
 * 200 → { scan_id, status: "stopped" }
 * 404 → scan not found or belongs to another user
 * 409 → scan is not in "running" status
 *
 * Writes Activity_Log record for `scan_stop`.
 *
 * Requirements: 4.6, 4.7, 20.1
 */
router.post('/:id/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await stopScan(req.params.id, req.user!.user_id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }

    console.error('[POST /scans/:id/stop] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/v1/scans/:id
 *
 * 204 → scan deleted
 * 404 → not found or belongs to another user
 * 409 → scan is running or pending
 *
 * Requirements: 4.1
 */
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteScan(req.params.id, req.user!.user_id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    if (err instanceof ConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }

    console.error('[DELETE /scans/:id] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id/vulnerabilities
 *
 * Query params:
 *   risk_level  = informational | low | medium | high | critical
 *   owasp       = OWASP category string
 *   sort_by     = risk_score | risk_level | discovered_at  (default: risk_score)
 *   order       = asc | desc                               (default: desc)
 *   page        = integer (default: 1)
 *   per_page    = integer 1–100 (default: 20)
 *
 * 200 → PaginatedResult<VulnerabilityRecord>
 * 404 → scan not found
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4
 */
router.get('/:id/vulnerabilities', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPage = parseInt((req.query.page as string) ?? '1', 10);
    const rawPerPage = parseInt((req.query.per_page as string) ?? '20', 10);

    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPage = isNaN(rawPerPage) || rawPerPage < 1 ? 20 : Math.min(rawPerPage, 100);

    const sortByRaw = (req.query.sort_by as string) ?? 'risk_score';
    const orderRaw = (req.query.order as string) ?? 'desc';

    const validSortBy = ['risk_score', 'risk_level', 'discovered_at'];
    const sortBy = validSortBy.includes(sortByRaw)
      ? (sortByRaw as 'risk_score' | 'risk_level' | 'discovered_at')
      : 'risk_score';

    const order: 'asc' | 'desc' = orderRaw === 'asc' ? 'asc' : 'desc';

    const result = await getVulnerabilities(req.params.id, req.user!.user_id, {
      page,
      perPage,
      riskLevel: req.query.risk_level as string | undefined,
      owasp: req.query.owasp as string | undefined,
      sortBy,
      order,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id/vulnerabilities] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id/vulnerabilities/:vid
 *
 * 200 → VulnerabilityRecord
 * 404 → scan or vulnerability not found
 *
 * Requirements: 23.1
 */
router.get('/:id/vulnerabilities/:vid', async (req: Request, res: Response): Promise<void> => {
  try {
    const vuln = await getVulnerabilityById(
      req.params.id,
      req.params.vid,
      req.user!.user_id,
    );
    res.status(200).json(vuln);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id/vulnerabilities/:vid] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id/vulnerabilities/:vid/explain
 *
 * Calls AI service to explain a specific vulnerability.
 * 200 → { description, remediation, score }
 * 404 → scan or vulnerability not found
 *
 * Requirements: 15.1
 */
router.get('/:id/vulnerabilities/:vid/explain', async (req: Request, res: Response): Promise<void> => {
  try {
    const vuln = await getVulnerabilityById(
      req.params.id,
      req.params.vid,
      req.user!.user_id,
    );

    const result = await explainVulnerability(vuln);
    res.status(200).json(result ?? {
      description: vuln.description ?? vuln.name,
      remediation: vuln.ai_remediation ?? 'No remediation available.',
      score: vuln.ai_score ?? null,
    });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id/vulnerabilities/:vid/explain] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id/summary
 *
 * Generates an AI executive summary for the completed scan.
 * 200 → { summary: string }
 * 404 → scan not found
 *
 * Requirements: 15.3
 */
router.get('/:id/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const scanDetail = await getScanById(req.params.id, req.user!.user_id);

    // Fetch all vulnerabilities for summary generation
    const vulnsResult = await getVulnerabilities(req.params.id, req.user!.user_id, {
      page: 1,
      perPage: 200,
      sortBy: 'risk_score',
      order: 'desc',
    });

    const summary = await generateExecutiveSummary(req.params.id, vulnsResult.data);
    res.status(200).json({ scan_id: req.params.id, summary });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id/summary] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/scans/:id/prioritized
 *
 * Returns vulnerabilities sorted by AI risk score descending.
 * 200 → VulnerabilityRecord[]
 * 404 → scan not found
 *
 * Requirements: 15.4
 */
router.get('/:id/prioritized', async (req: Request, res: Response): Promise<void> => {
  try {
    const vulnsResult = await getVulnerabilities(req.params.id, req.user!.user_id, {
      page: 1,
      perPage: 200,
      sortBy: 'risk_score',
      order: 'desc',
    });

    const prioritized = await prioritizeVulnerabilities(vulnsResult.data);
    res.status(200).json({ scan_id: req.params.id, vulnerabilities: prioritized });
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }

    console.error('[GET /scans/:id/prioritized] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
