/**
 * Input sanitization middleware — Requirement 21.5
 *
 * Recursively strips HTML and script tags from all string values in
 * `req.body` using the `xss` library before the request reaches any
 * route handler.  This prevents stored/reflected XSS payloads from
 * being persisted or echoed back through the API.
 *
 * Requirement 21.5: sanitize all user-supplied string inputs server-side
 *                   before persisting or using them in queries.
 */

import type { Request, Response, NextFunction } from 'express';
import xss from 'xss';

/**
 * Recursively sanitize every string value in the given object.
 * Non-string primitives, arrays, and nested objects are traversed
 * but left otherwise untouched.
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return xss(value);
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeValue(val);
    }
    return sanitized;
  }

  return value;
}

/**
 * Express middleware that sanitizes `req.body` in-place.
 * Safe to use with `express.json()` — operates on the already-parsed body.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body !== null && req.body !== undefined && typeof req.body === 'object') {
    req.body = sanitizeValue(req.body) as Record<string, unknown>;
  }
  next();
}
