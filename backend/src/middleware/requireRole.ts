import { Request, Response, NextFunction } from 'express';

/**
 * Factory function that returns an Express middleware enforcing role-based access control.
 *
 * - Permits requests whose `req.user.role` matches any of the allowed roles.
 * - Admits "admin" tokens to any endpoint that accepts "user" (caller must include both roles
 *   when registering user-role endpoints, OR use the convenience wrapper below).
 * - Returns 403 for:
 *   - Valid tokens whose role does not satisfy the required roles.
 *   - Valid tokens whose role value is unrecognised (not "user" or "admin").
 *
 * Requirements: 2.1, 2.2, 2.3, 2.5, 2.6
 *
 * @example
 * // User-only endpoint (admins are also admitted via the "user" inclusivity rule)
 * router.get('/scans', authenticate, requireRole('user', 'admin'), handler);
 *
 * // Admin-only endpoint
 * router.get('/admin/stats', authenticate, requireRole('admin'), handler);
 */
export function requireRole(...roles: string[]) {
  // Normalise to a Set for O(1) lookup
  const allowedRoles = new Set(roles);

  return (req: Request, res: Response, next: NextFunction): void => {
    // req.user is attached by the authenticate middleware (task 4.1).
    // If it is absent for any reason, treat the request as forbidden rather
    // than crashing — the authenticate middleware should have already rejected
    // requests without a valid token with 401.
    const user = req.user;

    if (!user) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { role } = user;

    // Reject unrecognised role values (req 2.6)
    if (role !== 'user' && role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Check whether this role is permitted (req 2.2, 2.3, 2.5)
    if (!allowedRoles.has(role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    next();
  };
}

/**
 * Pre-built middleware that permits "user" tokens and, by design, also admits
 * "admin" tokens (admins can access all user-role endpoints per req 2.3).
 *
 * Usage:
 *   router.get('/scans', authenticate, requireUserRole, handler);
 */
export const requireUserRole = requireRole('user', 'admin');

/**
 * Pre-built middleware that permits only "admin" tokens.
 *
 * Usage:
 *   router.get('/admin/stats', authenticate, requireAdminRole, handler);
 */
export const requireAdminRole = requireRole('admin');
