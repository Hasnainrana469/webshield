/**
 * Report routes
 *
 * POST /api/v1/scans/:id/reports   — generate PDF + HTML report for a scan
 * GET  /api/v1/reports             — list the authenticated user's reports
 * GET  /api/v1/reports/:id/download/pdf  — binary PDF download
 * GET  /api/v1/reports/:id/download/html — binary HTML download
 *
 * Requirements: 16.1, 16.3, 16.5
 */

import fs from 'fs';
import { Router, Request, Response } from 'express';
import { authenticate, requireUserRole, authRateLimiter } from '../middleware';
import { generateReport } from '../services/reportService';
import db from '../db';

// ---------------------------------------------------------------------------
// Scans sub-router (mounted at /api/v1/scans)
// ---------------------------------------------------------------------------

export const scanReportsRouter = Router({ mergeParams: true });
scanReportsRouter.use(authenticate, requireUserRole, authRateLimiter);

/**
 * POST /api/v1/scans/:id/reports
 *
 * Generates a PDF and HTML report for the given completed scan.
 * 201 → { report_id, pdf_url, html_url }
 * 404 → scan not found
 * 504 → generation timed out
 *
 * Requirements: 16.1, 16.5, 16.6
 */
scanReportsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await generateReport(req.params.id, req.user!.user_id);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Scan not found.') {
      res.status(404).json({ error: 'Scan not found.' });
      return;
    }

    if (err instanceof Error && err.message === 'REPORT_TIMEOUT') {
      res.status(504).json({ error: 'Report generation timed out. Please try again.' });
      return;
    }

    console.error('[POST /scans/:id/reports] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Reports router (mounted at /api/v1/reports)
// ---------------------------------------------------------------------------

const reportsRouter = Router();
reportsRouter.use(authenticate, requireUserRole, authRateLimiter);

/**
 * GET /api/v1/reports
 *
 * Returns a paginated list of reports belonging to the authenticated user.
 * 200 → { data, total, page, per_page, total_pages }
 *
 * Requirements: 16.3
 */
reportsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawPage = parseInt((req.query.page as string) ?? '1', 10);
    const rawPerPage = parseInt((req.query.per_page as string) ?? '20', 10);
    const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const perPage = isNaN(rawPerPage) || rawPerPage < 1 ? 20 : Math.min(rawPerPage, 100);
    const offset = (page - 1) * perPage;

    // Join with scans to filter by user
    const [{ count }] = await db('reports')
      .join('scans', 'reports.scan_id', 'scans.id')
      .where('scans.user_id', req.user!.user_id)
      .count<[{ count: string }]>('reports.id as count');

    const total = parseInt(count, 10);

    const rows = await db('reports')
      .join('scans', 'reports.scan_id', 'scans.id')
      .where('scans.user_id', req.user!.user_id)
      .orderBy('reports.created_at', 'desc')
      .limit(perPage)
      .offset(offset)
      .select([
        'reports.id',
        'reports.scan_id',
        'reports.format',
        'reports.file_path',
        'reports.file_size_bytes',
        'reports.created_at',
        'scans.target_url',
      ]);

    res.status(200).json({
      data: rows,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err) {
    console.error('[GET /reports] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reports/:id/download/pdf
 *
 * Returns the PDF report as a binary download.
 * 200 → binary file (application/pdf)
 * 404 → report not found or does not belong to user
 *
 * Requirements: 16.3
 */
reportsRouter.get('/:id/download/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await db('reports')
      .join('scans', 'reports.scan_id', 'scans.id')
      .where({ 'reports.id': req.params.id, 'reports.format': 'pdf', 'scans.user_id': req.user!.user_id })
      .first<{ id: string; file_path: string } | undefined>(['reports.id', 'reports.file_path']);

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    if (!fs.existsSync(report.file_path)) {
      res.status(404).json({ error: 'Report file not found on server.' });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="webshield-report-${report.id}.pdf"`,
    );
    fs.createReadStream(report.file_path).pipe(res);
  } catch (err) {
    console.error('[GET /reports/:id/download/pdf] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reports/:id/download/html
 *
 * Returns the HTML report as a binary download.
 * 200 → binary file (text/html)
 * 404 → report not found or does not belong to user
 *
 * Requirements: 16.3
 */
reportsRouter.get('/:id/download/html', async (req: Request, res: Response): Promise<void> => {
  try {
    const report = await db('reports')
      .join('scans', 'reports.scan_id', 'scans.id')
      .where({ 'reports.id': req.params.id, 'reports.format': 'html', 'scans.user_id': req.user!.user_id })
      .first<{ id: string; file_path: string } | undefined>(['reports.id', 'reports.file_path']);

    if (!report) {
      res.status(404).json({ error: 'Report not found.' });
      return;
    }

    if (!fs.existsSync(report.file_path)) {
      res.status(404).json({ error: 'Report file not found on server.' });
      return;
    }

    res.setHeader('Content-Type', 'text/html');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="webshield-report-${report.id}.html"`,
    );
    fs.createReadStream(report.file_path).pipe(res);
  } catch (err) {
    console.error('[GET /reports/:id/download/html] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default reportsRouter;
