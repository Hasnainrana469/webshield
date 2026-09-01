/**
 * Auth_Service — registration and login logic.
 * Handles password hashing, user INSERT, JWT issuance, and activity logging.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db, { withId } from '../db';
import { logEvent } from '../utils/activityLog';
import { sendPasswordResetEmail } from './emailService';
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../utils/validation';

// Require JWT_SECRET at startup so a missing env var fails loudly.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set.');
  }
  return secret;
}

const BCRYPT_COST_FACTOR = 12;
const JWT_EXPIRY_SECONDS = 60 * 60 * 24; // 24 hours

// ---- Public types ----

export interface RegisterInput {
  display_name: string;
  email: string;
  password: string;
}

export interface RegisteredUser {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: {
    user_id: string;
    display_name: string;
    email: string;
    role: string;
  };
}

/** Thrown when registration input fails validation. Carries per-field errors. */
export class ValidationError extends Error {
  public readonly errors: { field: string; message: string }[];

  constructor(errors: { field: string; message: string }[]) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Thrown when the supplied email already exists in the users table. */
export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this email address already exists.');
    this.name = 'DuplicateEmailError';
  }
}

/** Thrown when login credentials are invalid or the account is inactive. */
export class InvalidCredentialsError extends Error {
  constructor() {
    // Generic message — do NOT reveal which field is wrong (Req 1.4)
    super('Invalid email or password.');
    this.name = 'InvalidCredentialsError';
  }
}

/** Thrown when a logout request is missing or has an invalid Bearer token. */
export class InvalidTokenError extends Error {
  constructor(message = 'Missing or invalid authorization token.') {
    super(message);
    this.name = 'InvalidTokenError';
  }
}

/** Thrown when the provided email is not registered (forgot-password). */
export class UserNotFoundError extends Error {
  constructor() {
    super('No account found with that email address.');
    this.name = 'UserNotFoundError';
  }
}

/** Thrown when a reset token is expired, already used, or not found (reset-password). */
export class InvalidResetTokenError extends Error {
  constructor(message = 'The reset token is expired, already used, or invalid.') {
    super(message);
    this.name = 'InvalidResetTokenError';
  }
}

/**
 * Registers a new user.
 *
 * @throws {ValidationError}   when any input field is invalid (→ HTTP 422)
 * @throws {DuplicateEmailError} when the email is already taken (→ HTTP 409)
 */
export async function registerUser(input: RegisterInput): Promise<RegisteredUser> {
  // --- 1. Validate inputs ---
  const fieldErrors: { field: string; message: string }[] = [];

  const nameResult = validateDisplayName(input.display_name);
  if (!nameResult.valid) {
    fieldErrors.push({ field: 'display_name', message: nameResult.message! });
  }

  const emailResult = validateEmail(input.email);
  if (!emailResult.valid) {
    fieldErrors.push({ field: 'email', message: emailResult.message! });
  }

  const passwordResult = validatePassword(input.password);
  if (!passwordResult.valid) {
    fieldErrors.push({ field: 'password', message: passwordResult.message! });
  }

  if (fieldErrors.length > 0) {
    throw new ValidationError(fieldErrors);
  }

  // --- 2. Normalise email ---
  const normalizedEmail = input.email.trim().toLowerCase();

  // --- 3. Check for duplicate email ---
  const existing = await db('users').where({ email: normalizedEmail }).first();
  if (existing) {
    throw new DuplicateEmailError();
  }

  // --- 4. Hash password (bcrypt, cost ≥ 12) ---
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);

  // --- 5. INSERT new user ---
  await db('users').insert(withId({
    display_name: input.display_name.trim(),
    email: normalizedEmail,
    password_hash: passwordHash,
    role: 'user',
  }));

  // Fetch the newly created user record by email
  const newUser = await db('users')
    .where({ email: normalizedEmail })
    .first<{ id: string; display_name: string; email: string; role: string }>(
      ['id', 'display_name', 'email', 'role'],
    );

  if (!newUser) {
    throw new Error('Failed to retrieve newly registered user.');
  }

  // --- 6. Write Activity_Log record ---
  await logEvent({
    eventType: 'user_registration',
    actorUserId: newUser.id,
    targetResourceId: newUser.id,
    targetResourceType: 'user',
    description: `New user registered: ${normalizedEmail}`,
  });

  return {
    user_id: newUser.id,
    display_name: newUser.display_name,
    email: newUser.email,
    role: newUser.role,
  };
}

/**
 * Authenticates a user and issues a signed JWT.
 *
 * Steps:
 *  1. Look up user by normalised email.
 *  2. Verify the account is active.
 *  3. Compare the provided password against the stored bcrypt hash.
 *  4. Issue a HS256 JWT with jti, user_id, and role claims (24-hour expiry).
 *  5. Write a `user_login` Activity_Log record.
 *
 * @throws {InvalidCredentialsError} for any auth failure — deliberately does
 *   NOT distinguish which field is wrong (Requirement 1.4).
 */
export async function loginUser(input: LoginInput): Promise<LoginResult> {
  const normalizedEmail = (input.email ?? '').trim().toLowerCase();

  // --- 1. Look up the user ---
  const user = await db('users').where({ email: normalizedEmail }).first<{
    id: string;
    display_name: string;
    email: string;
    password_hash: string;
    role: string;
    is_active: boolean;
  }>();

  // Generic failure — do not reveal whether email or password is wrong.
  if (!user || !user.is_active) {
    throw new InvalidCredentialsError();
  }

  // --- 2. Compare password ---
  const passwordMatch = await bcrypt.compare(input.password ?? '', user.password_hash);
  if (!passwordMatch) {
    throw new InvalidCredentialsError();
  }

  // --- 3. Issue JWT (HS256, 24-hour expiry) ---
  const jti = uuidv4();

  const token = jwt.sign(
    {
      jti,
      user_id: user.id,
      role: user.role,
    },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRY_SECONDS,
      subject: user.id,
    },
  );

  // --- 4. Write Activity_Log record ---
  await logEvent({
    eventType: 'user_login',
    actorUserId: user.id,
    targetResourceId: user.id,
    targetResourceType: 'user',
    description: `User logged in: ${normalizedEmail}`,
  });

  return {
    token,
    user: {
      user_id: user.id,
      display_name: user.display_name,
      email: user.email,
      role: user.role,
    },
  };
}

/**
 * Invalidates a JWT by recording its jti in the token_blocklist table.
 *
 * The token is decoded (without re-verification — the caller is trusted to
 * have already authenticated) to extract the jti and exp claims.
 *
 * Steps:
 *  1. Decode the raw Bearer token to extract jti, user_id, and exp.
 *  2. INSERT a row into token_blocklist.
 *  3. Write a `user_logout` Activity_Log record.
 *
 * @throws {InvalidTokenError} when the Authorization header is absent,
 *   malformed, or the token cannot be decoded.
 *
 * Requirements: 1.9, 1.10, 20.1
 */
export async function logoutUser(authorizationHeader: string | undefined): Promise<void> {
  // --- 1. Extract the raw token from "Bearer <token>" ---
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new InvalidTokenError('Authorization header missing or not a Bearer token.');
  }

  const rawToken = authorizationHeader.slice(7).trim();
  if (!rawToken) {
    throw new InvalidTokenError('Bearer token is empty.');
  }

  // --- 2. Decode (no signature verification — we trust the caller is authenticated) ---
  const decoded = jwt.decode(rawToken) as {
    jti?: string;
    user_id?: string;
    sub?: string;
    exp?: number;
  } | null;

  if (!decoded || !decoded.jti || !decoded.exp) {
    throw new InvalidTokenError('Token is missing required claims (jti or exp).');
  }

  const jti = decoded.jti;
  // sub carries the user id (set as subject when the token was issued)
  const userId = decoded.user_id ?? decoded.sub;
  if (!userId) {
    throw new InvalidTokenError('Token is missing user identity claim.');
  }

  const expiresAt = new Date(decoded.exp * 1000);

  // --- 3. INSERT into token_blocklist (ignore conflict on duplicate jti — double logout is fine) ---
  await db('token_blocklist')
    .insert(withId({
      token_jti: jti,
      user_id: userId,
      expires_at: expiresAt,
    }))
    .onConflict('token_jti')
    .ignore();

  // --- 4. Write Activity_Log record ---
  await logEvent({
    eventType: 'user_logout',
    actorUserId: userId,
    targetResourceId: userId,
    targetResourceType: 'user',
    description: `User logged out; token jti=${jti} blocklisted until ${expiresAt.toISOString()}`,
  });
}

// ---------------------------------------------------------------------------
// Password Reset Flow — Requirements 1.6, 1.7, 1.8
// ---------------------------------------------------------------------------

const TOKEN_EXPIRY_HOURS = 1;
const RESET_TOKEN_BYTES = 32; // 256-bit entropy

/**
 * Hashes a raw reset token using SHA-256.
 * The raw token is sent to the user; only the hash is stored in the DB.
 */
function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Initiates the password reset flow for the given email address.
 *
 * Steps:
 *  1. Look up the user by normalised email; throw UserNotFoundError if absent (→ 404).
 *  2. Generate a cryptographically secure random token (32 bytes → hex string).
 *  3. Hash the token (SHA-256) and INSERT a row into password_reset_tokens with
 *     expires_at = NOW() + 1 hour.
 *  4. Send an email containing the raw token via emailService.
 *
 * @throws {UserNotFoundError} when the email is not registered (→ HTTP 404).
 *
 * Requirements: 1.6
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalizedEmail = (email ?? '').trim().toLowerCase();

  // --- 1. Look up user ---
  const user = await db('users')
    .where({ email: normalizedEmail })
    .first<{ id: string; display_name: string; email: string; is_active: boolean }>();

  if (!user) {
    throw new UserNotFoundError();
  }

  // --- 2. Generate raw token (sent via email) ---
  const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');

  // --- 3. Store the SHA-256 hash in DB ---
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  await db('password_reset_tokens').insert(withId({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt,
  }));

  // --- 4. Send email ---
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  await sendPasswordResetEmail({
    toEmail: user.email,
    displayName: user.display_name,
    rawToken,
    frontendUrl,
  });
}

/**
 * Consumes a password reset token and updates the user's password.
 *
 * Steps:
 *  1. Hash the provided raw token (SHA-256) and look it up in password_reset_tokens.
 *  2. Verify the record exists, is not expired (expires_at > NOW()), and has not been
 *     used (used_at IS NULL); throw InvalidResetTokenError otherwise (→ 400).
 *  3. Validate the new password against the password policy; throw ValidationError (→ 422).
 *  4. Hash the new password with bcrypt (cost 12) and UPDATE users.password_hash.
 *  5. SET password_reset_tokens.used_at = NOW().
 *
 * @throws {InvalidResetTokenError} when the token is not found, expired, or already used (→ HTTP 400).
 * @throws {ValidationError}        when the new password fails the policy check (→ HTTP 422).
 *
 * Requirements: 1.7, 1.8
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  // --- 1. Hash the provided token ---
  const tokenHash = hashResetToken(rawToken ?? '');

  // --- 2. Look up in DB ---
  const tokenRecord = await db('password_reset_tokens')
    .where({ token_hash: tokenHash })
    .first<{
      id: string;
      user_id: string;
      expires_at: Date;
      used_at: Date | null;
    }>();

  // Token not found, expired, or already used
  if (!tokenRecord) {
    throw new InvalidResetTokenError();
  }

  const now = new Date();
  if (tokenRecord.expires_at <= now) {
    throw new InvalidResetTokenError('The reset token has expired.');
  }

  if (tokenRecord.used_at !== null) {
    throw new InvalidResetTokenError('The reset token has already been used.');
  }

  // --- 3. Validate new password ---
  const passwordResult = validatePassword(newPassword);
  if (!passwordResult.valid) {
    throw new ValidationError([{ field: 'new_password', message: passwordResult.message! }]);
  }

  // --- 4. Hash new password (bcrypt cost 12) ---
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);

  // --- 5. Update in a transaction: set new password, mark token used ---
  await db.transaction(async (trx) => {
    await trx('users')
      .where({ id: tokenRecord.user_id })
      .update({ password_hash: passwordHash, updated_at: now });

    await trx('password_reset_tokens')
      .where({ id: tokenRecord.id })
      .update({ used_at: now });
  });
}
