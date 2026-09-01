import { Request, Response, NextFunction } from 'express';
import { requireRole, requireUserRole, requireAdminRole } from './requireRole';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockReq = Partial<Request> & { user?: { user_id: string; role: string; jti: string; iat: number; exp: number } };

function makeReq(role?: string): MockReq {
  if (role === undefined) return {};
  return { user: { user_id: 'uid-1', role, jti: 'jti-1', iat: 1000, exp: 9999 } };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: {} as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

// ---------------------------------------------------------------------------
// requireRole factory — core tests (Requirements 2.2, 2.3, 2.5, 2.6)
// ---------------------------------------------------------------------------

describe('requireRole()', () => {
  describe('user role', () => {
    it('permits "user" token when "user" is in allowed roles (req 2.2)', () => {
      const mw = requireRole('user');
      const req = makeReq('user');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(0); // status never set
    });

    it('denies "user" token when only "admin" is in allowed roles (req 2.5)', () => {
      const mw = requireRole('admin');
      const req = makeReq('user');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('admin role', () => {
    it('permits "admin" token when "admin" is in allowed roles (req 2.3)', () => {
      const mw = requireRole('admin');
      const req = makeReq('admin');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('permits "admin" token when "user" and "admin" are both in allowed roles (req 2.3)', () => {
      const mw = requireRole('user', 'admin');
      const req = makeReq('admin');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('unrecognised role values', () => {
    it('returns 403 for an unrecognised role even if that exact string is passed as allowed (req 2.6)', () => {
      // "superuser" is not a valid WebShield role ("user" | "admin")
      const mw = requireRole('superuser');
      const req = makeReq('superuser');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for an empty-string role', () => {
      const mw = requireRole('user', 'admin');
      const req = makeReq('');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 for a role that is a capitalised variant (role values are case-sensitive)', () => {
      const mw = requireRole('user', 'admin');
      const req = makeReq('Admin');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('missing req.user', () => {
    it('returns 403 when req.user is absent (authenticate should have prevented this)', () => {
      const mw = requireRole('user', 'admin');
      const req = makeReq(); // no user attached
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('response body', () => {
    it('returns { error: "Forbidden" } for denied requests', () => {
      const mw = requireRole('admin');
      const req = makeReq('user');
      const res = makeRes();
      const next = jest.fn() as unknown as NextFunction;

      mw(req as Request, res, next);

      expect(res.body).toEqual({ error: 'Forbidden' });
    });
  });
});

// ---------------------------------------------------------------------------
// requireUserRole convenience export
// ---------------------------------------------------------------------------

describe('requireUserRole', () => {
  it('permits "user" token', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireUserRole(makeReq('user') as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('permits "admin" token (admins can access user endpoints per req 2.3)', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireUserRole(makeReq('admin') as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies tokens with unrecognised roles', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireUserRole(makeReq('guest') as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// requireAdminRole convenience export
// ---------------------------------------------------------------------------

describe('requireAdminRole', () => {
  it('permits "admin" token', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireAdminRole(makeReq('admin') as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('denies "user" token (req 2.5)', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireAdminRole(makeReq('user') as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('denies tokens with unrecognised roles', () => {
    const res = makeRes();
    const next = jest.fn() as unknown as NextFunction;
    requireAdminRole(makeReq('superadmin') as Request, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
