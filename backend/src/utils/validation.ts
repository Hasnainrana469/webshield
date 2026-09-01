/**
 * Shared validation utilities for WebShield.
 * All validators return { valid: true } on success or { valid: false, message: string } on failure.
 */

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

/**
 * Validates a display name: 2–100 characters.
 */
export function validateDisplayName(value: unknown): ValidationResult {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > 100) {
    return {
      valid: false,
      message: 'display_name must be between 2 and 100 characters.',
    };
  }
  return { valid: true };
}

/**
 * Validates an email address using an RFC 5322-compatible regex.
 * Note: full RFC 5322 is extremely complex; this covers the common cases.
 */
export function validateEmail(value: unknown): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, message: 'email must be a string.' };
  }

  // RFC 5322-compatible regex covering the common practical subset
  const RFC5322 =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

  if (!RFC5322.test(value)) {
    return { valid: false, message: 'email must be a valid RFC 5322 email address.' };
  }
  return { valid: true };
}

/**
 * Validates a password:
 * - 8–128 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one digit
 * - At least one special character
 */
export function validatePassword(value: unknown): ValidationResult {
  if (typeof value !== 'string') {
    return { valid: false, message: 'password must be a string.' };
  }

  if (value.length < 8 || value.length > 128) {
    return {
      valid: false,
      message: 'password must be between 8 and 128 characters.',
    };
  }

  if (!/[A-Z]/.test(value)) {
    return {
      valid: false,
      message: 'password must contain at least one uppercase letter.',
    };
  }

  if (!/[a-z]/.test(value)) {
    return {
      valid: false,
      message: 'password must contain at least one lowercase letter.',
    };
  }

  if (!/[0-9]/.test(value)) {
    return {
      valid: false,
      message: 'password must contain at least one digit.',
    };
  }

  // Special characters: any non-alphanumeric character
  if (!/[^A-Za-z0-9]/.test(value)) {
    return {
      valid: false,
      message: 'password must contain at least one special character.',
    };
  }

  return { valid: true };
}
