/**
 * Unit tests for authenticate middleware (Task 4.1)
 * Requirements: 2.4
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// ── Mock the db module so tests don't need a real database ─────────────────
jest.mock('../db', () => {
  const mockQuery = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(undefined), // not blocked by default
  };
  const mockDb = jest.fn(() => mockQuery);
  // Expose the inner mock so tests can tweak behaviour
  (mockDb as unknown as Record<string, unknown>).__mockQuery = mockQuery;
  return { __esModule: true, default: mockDb, db: mockDb };
});

// Import after mock is in place
import { authenticate } from './authenticate';
import db from '../db';

// Helper to access the shared mock query object
const getMockQuery = () =>
  (db as unknown as Record<string, unknown>).__mockQuery as {
    where: jest.Mock;
    first: jest.Mock;
  };

// ── Test app setup ─────────────────────────────────────────────────────────
const SECRET = 'test-secret-key-32-chars-long-!!';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', authenticate, (_req: Request, res: Response) => {
    res.json({ ok: true, user: _req.user });
  });
  // Generic error handler so unexpected throws surface as 500 instead of 501
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });
  return app;
}

function makeToken(
  payload: object,
  secret = SECRET,
  options: jwt.SignOptions = {}
) {
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: '24h',
    ...options,
  });
}

function makeClaims(overrides: object = {}) {
  return {
    jti: uuidv4(),
    user_id: uuidv4(),
    role: 'user',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('authenticate middleware', () => {
  const OLD_ENV = process.env;

  beforeAll(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: SECRET };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: token is NOT blocklisted
    getMockQuery().first.mockResolvedValue(undefined);
  });

  // ── Absent / malformed header ────────────────────────────────────────────

  it('returns 401 when Authorization header is absent', async () => {
    const app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header lacks Bearer scheme', async () => {
    const app = buildApp();
    const token = makeToken(makeClaims());
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Token ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when Bearer token is an empty string', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is clearly malformed (random garbage)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer not.a.real.jwt.value');
    expect(res.status).toBe(401);
  });

  // ── Invalid signature ────────────────────────────────────────────────────

  it('returns 401 when token has an invalid signature (wrong secret)', async () => {
    const app = buildApp();
    const token = makeToken(makeClaims(), 'wrong-secret-key-that-is-different');
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Expired token ────────────────────────────────────────────────────────

  it('returns 401 when token is expired', async () => {
    const app = buildApp();
    const token = makeToken(makeClaims(), SECRET, { expiresIn: '-1s' });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Blocklisted token ────────────────────────────────────────────────────

  it('returns 401 when token jti is in the blocklist', async () => {
    const app = buildApp();
    const claims = makeClaims();
    const token = makeToken(claims);

    // Simulate the jti being found in the DB
    getMockQuery().first.mockResolvedValueOnce({
      token_jti: claims.jti,
      expires_at: new Date(Date.now() + 86400_000),
    });

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Missing required claims ──────────────────────────────────────────────

  it('returns 401 when token is missing jti claim', async () => {
    const app = buildApp();
    const token = makeToken({ user_id: uuidv4(), role: 'user' });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is missing user_id claim', async () => {
    const app = buildApp();
    const token = makeToken({ jti: uuidv4(), role: 'user' });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is missing role claim', async () => {
    const app = buildApp();
    const token = makeToken({ jti: uuidv4(), user_id: uuidv4() });
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  // ── Valid token ──────────────────────────────────────────────────────────

  it('returns 200 and attaches req.user for a valid, non-blocklisted token', async () => {
    const app = buildApp();
    const claims = makeClaims({ role: 'admin' });
    const token = makeToken(claims);

    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toMatchObject({
      jti: claims.jti,
      user_id: claims.user_id,
      role: 'admin',
    });
  });

  it('queries the blocklist using the token jti', async () => {
    const app = buildApp();
    const claims = makeClaims();
    const token = makeToken(claims);

    await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(getMockQuery().where).toHaveBeenCalledWith({ token_jti: claims.jti });
    expect(getMockQuery().first).toHaveBeenCalled();
  });
});
