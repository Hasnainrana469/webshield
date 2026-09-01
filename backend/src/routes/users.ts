/**
 * User profile routes — /api/v1/users
 *
 * All routes are protected by the authenticate + requireUserRole middleware chain.
 *
 * GET  /me          — return authenticated user profile
 * PUT  /me          — update display name / email
 * PUT  /me/password — change password
 * PUT  /me/settings — toggle email_notif_enabled
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireUserRole, authRateLimiter } from '../middleware';
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserSettings,
  ValidationError,
  DuplicateEmailError,
  PasswordMismatchError,
  UserNotFoundError,
} from '../services/userService';

const router = Router();

// Apply auth middleware to every route in this router
// Order: authenticate → requireUserRole → authRateLimiter (Req 21.3)
router.use(authenticate, requireUserRole, authRateLimiter);

/**
 * GET /api/v1/users/me
 *
 * Returns the authenticated user's profile.
 * 200 → { user_id, display_name, email, role, is_active, email_notif_enabled, created_at, updated_at }
 *
 * Requirements: 3.1
 */
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const profile = await getUserProfile(req.user!.user_id);
    res.status(200).json(profile);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error('[GET /users/me] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/users/me
 *
 * Update display name and/or email.
 * Body: { display_name?: string, email?: string }
 * 200 → updated UserProfile
 * 409 → duplicate email
 * 422 → validation failure
 *
 * Requirements: 3.1, 3.2, 3.3
 */
router.put('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const { display_name, email } = req.body as {
      display_name?: unknown;
      email?: unknown;
    };

    const updated = await updateUserProfile(req.user!.user_id, {
      ...(display_name !== undefined ? { display_name: display_name as string } : {}),
      ...(email !== undefined ? { email: email as string } : {}),
    });

    res.status(200).json(updated);
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(422).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error('[PUT /users/me] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/users/me/password
 *
 * Change the authenticated user's password.
 * Body: { current_password: string, new_password: string }
 * 200 → { message: "Password updated successfully." }
 * 400 → wrong current password
 * 422 → new password fails policy
 *
 * Requirements: 3.4, 3.5, 3.6
 */
router.put('/me/password', async (req: Request, res: Response): Promise<void> => {
  try {
    const { current_password, new_password } = req.body as {
      current_password?: unknown;
      new_password?: unknown;
    };

    await changePassword(req.user!.user_id, {
      current_password: current_password as string,
      new_password: new_password as string,
    });

    res.status(200).json({ message: 'Password updated successfully.' });
  } catch (err) {
    if (err instanceof PasswordMismatchError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof ValidationError) {
      res.status(422).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error('[PUT /users/me/password] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/users/me/settings
 *
 * Toggle email notification preference.
 * Body: { email_notif_enabled: boolean }
 * 200 → { message: "Settings updated successfully." }
 *
 * Requirements: 3.1 (email notification flag)
 */
router.put('/me/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email_notif_enabled } = req.body as { email_notif_enabled?: unknown };

    // Coerce to boolean in case the client sends a string
    const enabled = Boolean(email_notif_enabled);

    await updateUserSettings(req.user!.user_id, { email_notif_enabled: enabled });

    res.status(200).json({ message: 'Settings updated successfully.' });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    console.error('[PUT /users/me/settings] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
