import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import db from './db';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import scansRouter from './routes/scans';
import reportsRouter, { scanReportsRouter } from './routes/reports';
import adminRouter from './routes/admin';
import { unauthRateLimiter } from './middleware/rateLimiter';
import { sanitizeBody } from './middleware/sanitize';
// Initialize notification service listeners
import './services/notificationService';
// Register scanner modules during startup through their module side effects.
import './modules/httpHeaderModule';
import './modules/sslTlsModule';
import './modules/portScanModule';
import './modules/crawlerModule';
import './modules/sqlInjectionModule';
import './modules/xssModule';
import './modules/directoryDiscoveryModule';
import './modules/sensitiveInfoModule';
import './modules/cookieSecurityModule';

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security headers (Requirement 21.1) ──────────────────────────────────────
// Helmet sets Content-Security-Policy, X-Frame-Options, HSTS, X-Content-Type-Options,
// Referrer-Policy, X-XSS-Protection, Permissions-Policy and more on every response.
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }));

// ── Unauthenticated rate limiter (Requirement 21.2, 21.4) ────────────────────
// Applied before all routes so every request — authenticated or not — counts
// toward the 20 req/min per IP limit at this layer.  Protected routes also
// apply the per-user authRateLimiter after JWT verification.
app.use(unauthRateLimiter);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());

// ── Input sanitization (Requirement 21.5) ────────────────────────────────────
// Strips HTML/script tags from all user-supplied string body fields before
// any route handler sees them.
app.use(sanitizeBody);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API v1 routes
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/scans', scansRouter);
app.use('/api/v1/scans/:id/reports', scanReportsRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/admin', adminRouter);

async function main(): Promise<void> {
  // Run pending migrations on startup
  await db.migrate.latest();
  console.log('Migrations complete');

  app.listen(PORT, () => {
    console.log(`WebShield API listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;
