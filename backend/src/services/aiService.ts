/**
 * AI Assistant service — wraps OpenAI (GPT-4o) and Google Gemini with structured prompts.
 *
 * Provider selection (in order of priority):
 *  1. OpenAI — if OPENAI_API_KEY env var is set
 *  2. Gemini — if GEMINI_API_KEY env var is set
 *  3. Fallback — return raw data / null and log to activity_logs
 *
 * After scoring, updates vulnerabilities table with ai_score, ai_description, ai_remediation.
 *
 * Requirements: 15.1-15.5
 */

import db from '../db';
import { logEvent } from '../utils/activityLog';
import type { VulnerabilityRecord } from './scanService';

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

/** Calls OpenAI GPT-4o to get a completion for the given prompt. */
async function callOpenAI(prompt: string): Promise<string> {
  // Dynamic import so the module doesn't fail when openai is not configured
  const { OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a cybersecurity expert assistant. Respond with structured JSON only — no markdown fences.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content ?? '';
}

/** Calls Google Gemini to get a completion for the given prompt. */
async function callGemini(prompt: string): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const result = await model.generateContent(
    `You are a cybersecurity expert assistant. Respond with structured JSON only — no markdown fences.\n\n${prompt}`,
  );

  return result.response.text();
}

/**
 * Dispatches a prompt to the configured AI provider.
 * Returns the raw text response, or null on failure.
 */
async function callAI(prompt: string): Promise<string | null> {
  if (process.env.OPENAI_API_KEY) {
    return callOpenAI(prompt);
  }

  if (process.env.GEMINI_API_KEY) {
    return callGemini(prompt);
  }

  return null; // No AI provider configured
}

/** Safely parse JSON from an AI response, stripping potential markdown fences. */
function parseJsonResponse<T>(raw: string | null): T | null {
  if (!raw) return null;
  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public service functions
// ---------------------------------------------------------------------------

export interface AIExplanationResult {
  description: string;
  remediation: string;
  score: number;
}

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Answers a short cybersecurity chat using the configured provider or fallback guidance. */
export async function chatWithAssistant(messages: AIChatMessage[]): Promise<string> {
  const recentMessages = messages.slice(-12);
  const prompt = `
You are WebShield Assistant, a concise cybersecurity advisor. Help the user understand web security scanning, vulnerability findings, remediation, HTTP security, TLS, authentication, and safe testing practices. Do not claim to have scanned a target unless scan data is included. Do not provide instructions for unauthorized access or destructive activity. Use plain text with short paragraphs and bullets when useful.

Conversation:
${recentMessages.map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`).join('\n')}

Respond directly to the latest user message.
`.trim();

  try {
    const response = await callAI(prompt);
    if (response?.trim()) return response.trim();
  } catch (error) {
    console.error('[aiService] chatWithAssistant failed:', error);
  }

  const latest = recentMessages.at(-1)?.content.toLowerCase() ?? '';
  if (latest.includes('tls') || latest.includes('ssl')) {
    return 'Review certificate validity, enforce TLS 1.2 or TLS 1.3, disable TLS 1.0 and 1.1, and enable HSTS after confirming HTTPS redirects work.';
  }
  if (latest.includes('xss')) {
    return 'For XSS findings, encode output by context, avoid unsafe DOM sinks, validate input, and add a restrictive Content-Security-Policy.';
  }
  if (latest.includes('sql')) {
    return 'For SQL injection findings, use parameterized queries, least-privilege database accounts, server-side validation, and safe error handling.';
  }
  return 'I can help interpret scan findings, explain OWASP risks, and suggest practical remediation steps. Ask about a vulnerability, module, or security control.';
}

/**
 * Explains a vulnerability using AI and persists the result back to the DB.
 *
 * Returns { description, remediation, score } or null if AI is unavailable.
 *
 * Requirements: 15.1, 15.2, 15.5
 */
export async function explainVulnerability(
  vuln: VulnerabilityRecord,
): Promise<AIExplanationResult | null> {
  const prompt = `
Analyze the following web security vulnerability and return a JSON object with these exact keys:
- "description": a plain-language explanation of the vulnerability (2-3 sentences), its potential impact
- "remediation": step-by-step remediation recommendations (3-5 numbered steps)
- "score": a numeric risk score between 0 and 10 (float, 1 decimal)

Vulnerability details:
- Name: ${vuln.name}
- Risk Level: ${vuln.risk_level}
- OWASP Category: ${vuln.owasp_category}
- Affected URL: ${vuln.affected_url ?? 'N/A'}
- Affected Parameter: ${vuln.affected_param ?? 'N/A'}
- Description: ${vuln.description ?? 'N/A'}
- PoC Payload: ${vuln.poc_payload ?? 'N/A'}

Return ONLY valid JSON like: {"description":"...","remediation":"...","score":7.5}
`.trim();

  try {
    const raw = await callAI(prompt);
    const parsed = parseJsonResponse<AIExplanationResult>(raw);

    if (!parsed) {
      return null;
    }

    // Clamp score to 0–10
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));

    // Persist AI analysis back to the vulnerabilities table
    await db('vulnerabilities')
      .where({ id: vuln.id })
      .update({
        ai_score: score,
        ai_description: parsed.description ?? null,
        ai_remediation: parsed.remediation ?? null,
      });

    return {
      description: parsed.description ?? '',
      remediation: parsed.remediation ?? '',
      score,
    };
  } catch (err) {
    console.error('[aiService] explainVulnerability failed:', err);
    await logEvent({
      eventType: 'ai_failure',
      actorUserId: null,
      targetResourceId: vuln.id,
      targetResourceType: 'vulnerability',
      description: `AI explainVulnerability failed for vulnerability ${vuln.id}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return null;
  }
}

/**
 * Scores a vulnerability's risk (0–10) using AI.
 * Also persists the score to the DB.
 *
 * Returns the numeric score, or 0 on failure.
 *
 * Requirements: 15.2, 15.5
 */
export async function scoreRisk(vuln: VulnerabilityRecord): Promise<number> {
  const prompt = `
Given the following web security vulnerability, assign a numeric risk score between 0 and 10 
(where 0 = no risk, 10 = maximum critical risk). Return ONLY a JSON object: {"score": <number>}

Vulnerability:
- Name: ${vuln.name}
- Risk Level: ${vuln.risk_level}
- OWASP Category: ${vuln.owasp_category}
- Affected URL: ${vuln.affected_url ?? 'N/A'}
- Description: ${vuln.description ?? 'N/A'}
`.trim();

  try {
    const raw = await callAI(prompt);
    const parsed = parseJsonResponse<{ score: number }>(raw);

    if (!parsed || typeof parsed.score !== 'number') {
      return 0;
    }

    const score = Math.max(0, Math.min(10, parsed.score));

    await db('vulnerabilities')
      .where({ id: vuln.id })
      .update({ ai_score: score });

    return score;
  } catch (err) {
    console.error('[aiService] scoreRisk failed:', err);
    await logEvent({
      eventType: 'ai_failure',
      actorUserId: null,
      targetResourceId: vuln.id,
      targetResourceType: 'vulnerability',
      description: `AI scoreRisk failed for vulnerability ${vuln.id}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return 0;
  }
}

/**
 * Generates an executive summary for a scan (≤ 500 words).
 *
 * Returns the summary string, or a fallback plain-text summary on failure.
 *
 * Requirements: 15.3, 15.5
 */
export async function generateExecutiveSummary(
  scanId: string,
  vulns: VulnerabilityRecord[],
): Promise<string> {
  const criticalCount = vulns.filter((v) => v.risk_level === 'critical').length;
  const highCount = vulns.filter((v) => v.risk_level === 'high').length;
  const mediumCount = vulns.filter((v) => v.risk_level === 'medium').length;
  const lowCount = vulns.filter((v) => v.risk_level === 'low').length;

  const topVulns = vulns.slice(0, 5).map((v) =>
    `- ${v.name} (${v.risk_level}, ${v.owasp_category})`,
  );

  const prompt = `
You are a senior cybersecurity analyst. Write an executive summary (maximum 500 words) for a 
completed security scan report. The summary should describe the overall security posture, 
highlight the most critical findings, and provide prioritized remediation recommendations.
Return ONLY a JSON object: {"summary": "<plain text summary>"}

Scan statistics:
- Total vulnerabilities: ${vulns.length}
- Critical: ${criticalCount}
- High: ${highCount}
- Medium: ${mediumCount}
- Low: ${lowCount}

Top findings:
${topVulns.join('\n')}
`.trim();

  try {
    const raw = await callAI(prompt);
    const parsed = parseJsonResponse<{ summary: string }>(raw);

    if (!parsed?.summary) {
      return buildFallbackSummary(vulns);
    }

    return parsed.summary;
  } catch (err) {
    console.error('[aiService] generateExecutiveSummary failed:', err);
    await logEvent({
      eventType: 'ai_failure',
      actorUserId: null,
      targetResourceId: scanId,
      targetResourceType: 'scan',
      description: `AI generateExecutiveSummary failed for scan ${scanId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    return buildFallbackSummary(vulns);
  }
}

/** Builds a plain-text fallback summary without AI. */
function buildFallbackSummary(vulns: VulnerabilityRecord[]): string {
  const criticalCount = vulns.filter((v) => v.risk_level === 'critical').length;
  const highCount = vulns.filter((v) => v.risk_level === 'high').length;
  const mediumCount = vulns.filter((v) => v.risk_level === 'medium').length;
  const lowCount = vulns.filter((v) => v.risk_level === 'low').length;

  return (
    `Security Scan Summary\n\n` +
    `The scan identified ${vulns.length} vulnerability/vulnerabilities in total. ` +
    `Critical: ${criticalCount}, High: ${highCount}, Medium: ${mediumCount}, Low: ${lowCount}.\n\n` +
    `Immediate attention is recommended for all Critical and High severity findings. ` +
    `Please review each vulnerability and apply the recommended remediations.`
  );
}

/**
 * Returns vulnerabilities sorted by AI risk score descending.
 * Vulnerabilities without an ai_score fall back to a risk-level-based score.
 *
 * Requirements: 15.4
 */
export async function prioritizeVulnerabilities(
  vulns: VulnerabilityRecord[],
): Promise<VulnerabilityRecord[]> {
  const RISK_SCORE_FALLBACK: Record<string, number> = {
    critical: 9.0,
    high: 7.0,
    medium: 5.0,
    low: 2.5,
    informational: 0.5,
  };

  return [...vulns].sort((a, b) => {
    const scoreA = a.ai_score ?? RISK_SCORE_FALLBACK[a.risk_level] ?? 0;
    const scoreB = b.ai_score ?? RISK_SCORE_FALLBACK[b.risk_level] ?? 0;
    return scoreB - scoreA;
  });
}
