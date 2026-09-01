/**
 * Middleware barrel — re-exports all authentication, authorisation,
 * rate-limiting, and sanitization middleware so consumers can import
 * from a single location:
 *
 *   import { authenticate, requireRole, unauthRateLimiter, sanitizeBody } from '../middleware';
 */

export { authenticate } from './authenticate';
export { requireRole, requireUserRole, requireAdminRole } from './requireRole';
export { unauthRateLimiter, authRateLimiter } from './rateLimiter';
export { sanitizeBody } from './sanitize';
