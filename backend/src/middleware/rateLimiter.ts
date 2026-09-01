/**
 * Rate limiting middleware — Requirement 21.2, 21.3, 21.4
 *
 * Two limiters are exported:
 *   - unauthRateLimiter  : 20 requests/min per IP  (applied before auth)
 *   - authRateLimiter    : 100 requests/min per user account (applied after authenticate)
 *
 * Both return HTTP 429 with a `Retry-After` header on breach.
 */

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Unauthenticated rate limiter — 20 req/min per IP.
 * Applied globally (before JWT verification) so it covers all endpoints
 * whether or not the caller is authenticated.
 *
 * Requirement 21.2: max 20 unauthenticated requests per minute per IP.
 * Requirement 21.4: return 429 + Retry-After header on breach.
 */
export const unauthRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 20,
  standardHeaders: true,  // sets RateLimit-* headers (RFC 6585)
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Use the real client IP (works behind proxies when trust proxy is set)
    return (req.ip ?? req.socket?.remoteAddress ?? 'unknown');
  },
  handler: (_req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
      retryAfter,
    });
  },
});

/**
 * Authenticated rate limiter — 100 req/min per user account.
 * Applied on protected routes after the `authenticate` middleware has
 * populated `req.user`.  Falls back to IP if `req.user` is absent.
 *
 * Requirement 21.3: max 100 authenticated requests per minute per user.
 * Requirement 21.4: return 429 + Retry-After header on breach.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Key by user_id once authenticated, otherwise fall back to IP
    return req.user?.user_id ?? req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  },
  handler: (_req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Too many requests',
      message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
      retryAfter,
    });
  },
});
