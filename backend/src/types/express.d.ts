import 'express';

/**
 * Extends Express Request to carry the decoded JWT payload
 * after the authenticate middleware has verified it.
 */
declare module 'express' {
  interface Request {
    user?: {
      jti: string;
      user_id: string;
      role: string;
      iat: number;
      exp: number;
    };
  }
}
