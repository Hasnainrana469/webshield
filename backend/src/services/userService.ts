/**
 * User profile management service.
 *
 * Handles:
 *  - Fetching the authenticated user's profile
 *  - Updating display name and/or email
 *  - Changing password (verify current → hash new)
 *  - Updating notification settings
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import bcrypt from 'bcrypt';
import db from '../db';
// Note: MySQL does not support .returning() on UPDATE — we do update then fetch.
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
} from '../utils/validation';

const BCRYPT_COST_FACTOR = 12;

// ---- Public types ----

export interface UserProfile {
  user_id: string;
  display_name: string;
  email: string;
  role: string;
  is_active: boolean;
  email_notif_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileInput {
  display_name?: string;
  email?: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface UpdateSettingsInput {
  email_notif_enabled: boolean;
}

// ---- Custom errors ----

/** Thrown when profile update input fails validation (→ HTTP 422). */
export class ValidationError extends Error {
  public readonly errors: { field: string; message: string }[];

  constructor(errors: { field: string; message: string }[]) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

/** Thrown when the new email is already taken by another account (→ HTTP 409). */
export class DuplicateEmailError extends Error {
  constructor() {
    super('A user with this email address already exists.');
    this.name = 'DuplicateEmailError';
  }
}

/** Thrown when the current password does not match the stored hash (→ HTTP 400). */
export class PasswordMismatchError extends Error {
  constructor() {
    super('Current password is incorrect.');
    this.name = 'PasswordMismatchError';
  }
}

/** Thrown when the target user does not exist (→ HTTP 404). */
export class UserNotFoundError extends Error {
  constructor() {
    super('User not found.');
    this.name = 'UserNotFoundError';
  }
}

// ---- Service functions ----

/**
 * Returns the profile for the given user.
 *
 * @throws {UserNotFoundError} if no active user exists with this ID.
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const user = await db('users')
    .where({ id: userId })
    .first<{
      id: string;
      display_name: string;
      email: string;
      role: string;
      is_active: boolean;
      email_notif_enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>();

  if (!user) {
    throw new UserNotFoundError();
  }

  return {
    user_id: user.id,
    display_name: user.display_name,
    email: user.email,
    role: user.role,
    is_active: user.is_active,
    email_notif_enabled: user.email_notif_enabled,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
  };
}

/**
 * Updates the user's display name and/or email.
 *
 * - At least one field must be provided.
 * - Each provided field is validated before the update.
 * - Email is normalised to lowercase.
 * - Returns the updated profile.
 *
 * @throws {ValidationError}     on invalid field values (→ HTTP 422).
 * @throws {DuplicateEmailError} if the new email belongs to another account (→ HTTP 409).
 * @throws {UserNotFoundError}   if the user does not exist.
 */
export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<UserProfile> {
  const fieldErrors: { field: string; message: string }[] = [];

  if (input.display_name !== undefined) {
    const result = validateDisplayName(input.display_name);
    if (!result.valid) {
      fieldErrors.push({ field: 'display_name', message: result.message! });
    }
  }

  if (input.email !== undefined) {
    const result = validateEmail(input.email);
    if (!result.valid) {
      fieldErrors.push({ field: 'email', message: result.message! });
    }
  }

  if (fieldErrors.length > 0) {
    throw new ValidationError(fieldErrors);
  }

  const updates: Record<string, unknown> = { updated_at: new Date() };

  if (input.display_name !== undefined) {
    updates.display_name = input.display_name.trim();
  }

  if (input.email !== undefined) {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Check for conflict with another account
    const existing = await db('users')
      .where({ email: normalizedEmail })
      .whereNot({ id: userId })
      .first<{ id: string }>();

    if (existing) {
      throw new DuplicateEmailError();
    }

    updates.email = normalizedEmail;
  }

  await db('users')
    .where({ id: userId })
    .update(updates);

  const updated = await db('users')
    .where({ id: userId })
    .first<{
      id: string;
      display_name: string;
      email: string;
      role: string;
      is_active: boolean;
      email_notif_enabled: boolean;
      created_at: Date;
      updated_at: Date;
    }>([
      'id',
      'display_name',
      'email',
      'role',
      'is_active',
      'email_notif_enabled',
      'created_at',
      'updated_at',
    ]);

  if (!updated) {
    throw new UserNotFoundError();
  }

  return {
    user_id: updated.id,
    display_name: updated.display_name,
    email: updated.email,
    role: updated.role,
    is_active: updated.is_active,
    email_notif_enabled: updated.email_notif_enabled,
    created_at: new Date(updated.created_at).toISOString(),
    updated_at: new Date(updated.updated_at).toISOString(),
  };
}

/**
 * Changes the user's password.
 *
 * Steps:
 *  1. Load the user's current password_hash.
 *  2. Verify current_password against the stored hash.
 *  3. Validate new_password against the password policy.
 *  4. Hash the new password and UPDATE users.password_hash.
 *
 * @throws {UserNotFoundError}      if the user does not exist.
 * @throws {PasswordMismatchError}  if current_password is wrong (→ HTTP 400).
 * @throws {ValidationError}        if new_password fails policy (→ HTTP 422).
 */
export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await db('users')
    .where({ id: userId })
    .first<{ id: string; password_hash: string }>();

  if (!user) {
    throw new UserNotFoundError();
  }

  // Verify current password
  const match = await bcrypt.compare(input.current_password ?? '', user.password_hash);
  if (!match) {
    throw new PasswordMismatchError();
  }

  // Validate new password
  const passwordResult = validatePassword(input.new_password);
  if (!passwordResult.valid) {
    throw new ValidationError([
      { field: 'new_password', message: passwordResult.message! },
    ]);
  }

  const newHash = await bcrypt.hash(input.new_password, BCRYPT_COST_FACTOR);

  await db('users')
    .where({ id: userId })
    .update({ password_hash: newHash, updated_at: new Date() });
}

/**
 * Toggles the user's email notification preference.
 *
 * @throws {UserNotFoundError} if the user does not exist.
 */
export async function updateUserSettings(
  userId: string,
  input: UpdateSettingsInput,
): Promise<void> {
  const count = await db('users')
    .where({ id: userId })
    .update({ email_notif_enabled: input.email_notif_enabled, updated_at: new Date() });

  if (count === 0) {
    throw new UserNotFoundError();
  }
}
