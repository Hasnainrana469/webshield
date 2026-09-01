/**
 * Authentication routes — /api/v1/auth
 *
 * Public routes  : /register, /login, /forgot-password, /reset-password
 * Protected routes: /logout (requires valid JWT)
 *
 * Middleware chain on protected routes (per design):
 *   Helmet.js (app-level) → Rate_Limiter (TBD) → JWT_Verify → Role_Guard → Route Handler
 */

import { Router, Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  logoutUser,
  requestPasswordReset,
  resetPassword,
  ValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidTokenError,
  UserNotFoundError,
  InvalidResetTokenError,
} from '../services/authService';
import { authenticate, requireUserRole, authRateLimiter } from '../middleware';

const router = Router();

/**
 * POST /api/v1/auth/register
 *
 * Body: { display_name, email, password }
 * 201 → { user_id, display_name, email, role }
 * 409 → duplicate email
 * 422 → validation failure
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { display_name, email, password } = req.body as {
      display_name: unknown;
      email: unknown;
      password: unknown;
    };

    const result = await registerUser({
      display_name: display_name as string,
      email: email as string,
      password: password as string,
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

    if (err instanceof DuplicateEmailError) {
      res.status(409).json({
        error: err.message,
      });
      return;
    }

    console.error('[POST /auth/register] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/login
 *
 * Body: { email, password }
 * 200 → { token, user: { user_id, display_name, email, role } }
 * 401 → invalid credentials (no field discrimination per Req 1.4)
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as {
      email: unknown;
      password: unknown;
    };

    const result = await loginUser({
      email: email as string,
      password: password as string,
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    console.error('[POST /auth/login] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/logout
 *
 * Header: Authorization: Bearer <token>
 * 204 → token blocklisted successfully
 * 401 → missing or invalid Bearer token
 *
 * The authenticate middleware validates and decodes the JWT before this
 * handler runs. logoutUser then records the jti in token_blocklist and
 * writes a `user_logout` Activity_Log record.
 *
 * Middleware chain: authenticate → requireUserRole → handler
 *
 * Requirements: 1.9, 1.10, 20.1
 */
router.post('/logout', authenticate, requireUserRole, authRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    await logoutUser(req.headers.authorization);
    res.status(204).send();
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      res.status(401).json({ error: err.message });
      return;
    }

    console.error('[POST /auth/logout] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/forgot-password
 *
 * Body: { email }
 * 200 → reset email sent
 * 404 → email not found
 *
 * Generates a 1-hour reset token, stores its SHA-256 hash in
 * password_reset_tokens, and sends the raw token via email.
 *
 * Requirements: 1.6
 */
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body as { email: unknown };

    await requestPasswordReset(email as string);

    res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: 'No account found with that email address.' });
      return;
    }

    console.error('[POST /auth/forgot-password] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/auth/reset-password
 *
 * Body: { token, new_password }
 * 200 → password updated successfully
 * 400 → expired or already-used token
 * 422 → new password fails policy
 *
 * Verifies the token (hash lookup, expiry, used_at), validates the new
 * password, updates the password_hash with bcrypt cost 12, and marks
 * the token as used.
 *
 * Requirements: 1.7, 1.8
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, new_password } = req.body as { token: unknown; new_password: unknown };

    await resetPassword(token as string, new_password as string);

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    if (err instanceof InvalidResetTokenError) {
      res.status(400).json({ error: err.message });
      return;
    }

    if (err instanceof ValidationError) {
      res.status(422).json({
        error: 'Validation failed',
        details: err.errors,
      });
      return;
    }

    console.error('[POST /auth/reset-password] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
