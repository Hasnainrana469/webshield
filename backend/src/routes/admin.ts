/**
 * Admin routes — /api/v1/admin
 *
 * All routes require admin role.
 *
 * GET  /stats                 — system-wide statistics
 * GET  /scans                 — all scans across all users (paginated)
 * GET  /users                 — paginated user list with scan count
 * GET  /users/:id             — single user detail
 * PUT  /users/:id/role        — change user role
 * PUT  /users/:id/deactivate  — deactivate user account
 * GET  /activity-logs         — paginated activity log (50/page, desc)
 *
 * Requirements: 18.1-18.5, 20.1, 20.3
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireAdminRole, authRateLimiter } from '../middleware';
import { logEvent } from '../utils/activityLog';
import db from '../db';

const router = Router();
router.use(authenticate, requireAdminRole, authRateLimiter);

// ---------------------------------------------------------------------------
// GET /admin/stats — system-wide statistics (Req 18.1)
// ---------------------------------------------------------------------------

router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const [{ userCount }] = await db('users').count<[{ userCount: string }]>('id as userCount');
    const [{ scanCount }] = await db('scans').count<[{ scanCount: string }]>('id as scanCount');

    const vulnRows = await db('vulnerabilities')
      .select('risk_level')
      .count('id as count')
      .groupBy('risk_level');

    const vulnStats: Record<string, number> = {};
    for (const row of vulnRows as Array<{ risk_level: string; count: string }>) {
      vulnStats[row.risk_level] = parseInt(row.count, 10);
    }

    const [{ activeScanCount }] = await db('scans')
      .where({ status: 'running' })
      .count<[{ activeScanCount: string }]>('id as activeScanCount');
    const [{ recentRegistrationCount }] = await db('users')
      .where('created_at', '>=', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .count<[{ recentRegistrationCount: string }]>('id as recentRegistrationCount');
    const totalVulnerabilities = Object.values(vulnStats).reduce((sum, count) => sum + count, 0);

    res.status(200).json({
      total_users: parseInt(userCount, 10),
      total_scans: parseInt(scanCount, 10),
      total_vulnerabilities: totalVulnerabilities,
      vulnerability_breakdown: Object.entries(vulnStats).map(([risk_level, count]) => ({ risk_level, count })),
      active_scans: parseInt(activeScanCount, 10),
      recent_registrations: parseInt(recentRegistrationCount, 10),
    });
  } catch (err) {
    console.error('[GET /admin/stats]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/scans — all scans across all users (Req 18.1)
// ---------------------------------------------------------------------------

router.get('/scans', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt((req.query.per_page as string) ?? '20', 10) || 20));
    const offset = (page - 1) * perPage;

    const [{ count }] = await db('scans').count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const rows = await db('scans')
      .join('users', 'scans.user_id', 'users.id')
      .orderBy('scans.created_at', 'desc')
      .limit(perPage)
      .offset(offset)
      .select([
        'scans.id', 'scans.target_url', 'scans.status', 'scans.progress_pct',
        'scans.started_at', 'scans.completed_at', 'scans.created_at',
        'users.email as user_email', 'users.display_name as user_name',
      ]);

    res.status(200).json({
      data: rows,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error('[GET /admin/scans]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users — paginated user list (Req 18.2)
// ---------------------------------------------------------------------------

router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt((req.query.per_page as string) ?? '20', 10) || 20));
    const offset = (page - 1) * perPage;

    const [{ count }] = await db('users').count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const rows = await db('users')
      .leftJoin(
        db('scans').count('id as scan_count').select('user_id').groupBy('user_id').as('sc'),
        'users.id',
        'sc.user_id',
      )
      .orderBy('users.created_at', 'desc')
      .limit(perPage)
      .offset(offset)
      .select([
        'users.id', 'users.display_name', 'users.email', 'users.role',
        'users.is_active', 'users.created_at',
        db.raw('COALESCE(sc.scan_count, 0) as scan_count'),
      ]);

    res.status(200).json({
      data: rows,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error('[GET /admin/users]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id — single user detail
// ---------------------------------------------------------------------------

router.get('/users/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await db('users')
      .where({ id: req.params.id })
      .first(['id', 'display_name', 'email', 'role', 'is_active', 'email_notif_enabled', 'created_at', 'updated_at']);

    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const [{ count }] = await db('scans')
      .where({ user_id: req.params.id })
      .count<[{ count: string }]>('id as count');

    res.status(200).json({ ...user, scan_count: parseInt(count, 10) });
  } catch (err) {
    console.error('[GET /admin/users/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/role — change user role (Req 18.3)
// ---------------------------------------------------------------------------

router.put('/users/:id/role', async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.body as { role?: string };

    if (role !== 'user' && role !== 'admin') {
      res.status(422).json({ error: 'role must be "user" or "admin".' });
      return;
    }

    const updated = await db('users').where({ id: req.params.id }).update({ role, updated_at: new Date() });

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await logEvent({
      eventType: 'admin_role_change',
      actorUserId: req.user!.user_id,
      targetResourceId: req.params.id,
      targetResourceType: 'user',
      description: `Admin changed role of user ${req.params.id} to "${role}".`,
    });

    res.status(200).json({ message: 'Role updated successfully.' });
  } catch (err) {
    console.error('[PUT /admin/users/:id/role]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/users/:id/deactivate — deactivate user (Req 18.4, 18.5)
// ---------------------------------------------------------------------------

router.put('/users/:id/deactivate', async (req: Request, res: Response): Promise<void> => {
  try {
    // Prevent self-deactivation (Req 18.5)
    if (req.params.id === req.user!.user_id) {
      res.status(400).json({ error: 'Administrators cannot deactivate their own account.' });
      return;
    }

    const updated = await db('users')
      .where({ id: req.params.id })
      .update({ is_active: false, updated_at: new Date() });

    if (!updated) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await logEvent({
      eventType: 'admin_account_deactivation',
      actorUserId: req.user!.user_id,
      targetResourceId: req.params.id,
      targetResourceType: 'user',
      description: `Admin deactivated user account ${req.params.id}.`,
    });

    res.status(200).json({ message: 'User account deactivated.' });
  } catch (err) {
    console.error('[PUT /admin/users/:id/deactivate]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/activity-logs — paginated activity log (Req 20.3)
// ---------------------------------------------------------------------------

router.get('/activity-logs', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) ?? '1', 10) || 1);
    const perPage = 50; // fixed at 50 per Req 20.3
    const offset = (page - 1) * perPage;

    const [{ count }] = await db('activity_logs').count<[{ count: string }]>('id as count');
    const total = parseInt(count, 10);

    const rows = await db('activity_logs')
      .orderBy('created_at', 'desc')
      .limit(perPage)
      .offset(offset)
      .select(['id', 'event_type', 'actor_user_id', 'target_resource_id', 'target_resource_type', 'description', 'created_at']);

    res.status(200).json({
      data: rows,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error('[GET /admin/activity-logs]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
