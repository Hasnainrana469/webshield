import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import db from '../db';

/**
 * JWT verification middleware.
 *
 * Checks `Authorization: Bearer <token>`:
 *   1. Header absent or not Bearer scheme → 401
 *   2. Token malformed / invalid signature / expired → 401
 *   3. Missing required claims (jti, user_id, role) → 401
 *   4. jti found in token_blocklist → 401
 *   5. All checks pass → attach decoded payload to req.user, call next()
 *
 * req.user = { jti, user_id, role, iat, exp }
 *
 * Requirements: 2.4
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Extract Bearer token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    return;
  }

  const token = authHeader.slice(7).trim(); // strip "Bearer "
  if (!token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    return;
  }

  // 2. Verify signature and expiry
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server configuration error.' });
    return;
  }

  let decoded: jwt.JwtPayload;
  try {
    const result = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof result === 'string') {
      // jwt.verify returned a raw string — not a valid structured payload
      res.status(401).json({ error: 'Invalid token.' });
      return;
    }
    decoded = result as jwt.JwtPayload;
  } catch {
    // Covers JsonWebTokenError (bad signature / malformed) and TokenExpiredError
    res.status(401).json({ error: 'Invalid or expired token.' });
    return;
  }

  // 3. Require the three custom claims
  const { jti, user_id, role } = decoded;
  if (!jti || !user_id || !role) {
    res.status(401).json({ error: 'Token is missing required claims.' });
    return;
  }

  // 4. Check token blocklist
  try {
    const blocked = await db('token_blocklist').where({ token_jti: jti }).first();
    if (blocked) {
      res.status(401).json({ error: 'Token has been revoked.' });
      return;
    }
  } catch {
    res.status(500).json({ error: 'Internal server error.' });
    return;
  }

  // 5. Attach payload to request and continue
  req.user = {
    jti: jti as string,
    user_id: user_id as string,
    role: role as string,
    iat: decoded.iat as number,
    exp: decoded.exp as number,
  };

  next();
}
