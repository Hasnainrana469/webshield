/**
 * Unit tests for userService.
 *
 * The DB is mocked so these run without a live PostgreSQL instance.
 *
 * Covers:
 *  - getUserProfile
 *  - updateUserProfile
 *  - changePassword
 *  - updateUserSettings
 */

import bcrypt from 'bcrypt';
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  updateUserSettings,
  ValidationError,
  DuplicateEmailError,
  PasswordMismatchError,
  UserNotFoundError,
} from './userService';

// ---- Mock db ----

const mockWhereNot = jest.fn().mockReturnThis();
const mockDbChain = {
  where: jest.fn().mockReturnThis(),
  whereNot: mockWhereNot,
  first: jest.fn(),
  update: jest.fn().mockReturnThis(),
  returning: jest.fn(),
};

jest.mock('../db', () => {
  const mockFn = jest.fn(() => mockDbChain);
  return { __esModule: true, default: mockFn };
});

// ---- Shared fixtures ----

const USER_ID = 'user-uuid-001';

const FULL_USER_ROW = {
  id: USER_ID,
  display_name: 'Alice Smith',
  email: 'alice@example.com',
  role: 'user',
  is_active: true,
  email_notif_enabled: true,
  created_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-01-02T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default chain setup
  mockDbChain.where.mockReturnThis();
  mockWhereNot.mockReturnThis();
  mockDbChain.update.mockReturnThis();
});

// ================================================================
// getUserProfile
// ================================================================

describe('getUserProfile', () => {
  it('returns a UserProfile for an existing user', async () => {
    mockDbChain.first.mockResolvedValue(FULL_USER_ROW);

    const profile = await getUserProfile(USER_ID);

    expect(profile).toEqual({
      user_id: USER_ID,
      display_name: 'Alice Smith',
      email: 'alice@example.com',
      role: 'user',
      is_active: true,
      email_notif_enabled: true,
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    });
  });

  it('throws UserNotFoundError when user does not exist', async () => {
    mockDbChain.first.mockResolvedValue(undefined);
    await expect(getUserProfile(USER_ID)).rejects.toThrow(UserNotFoundError);
  });
});

// ================================================================
// updateUserProfile
// ================================================================

describe('updateUserProfile', () => {
  const UPDATED_ROW = {
    ...FULL_USER_ROW,
    display_name: 'Bob Jones',
    email: 'bob@example.com',
    updated_at: new Date('2024-06-01T00:00:00Z'),
  };

  describe('success path', () => {
    beforeEach(() => {
      // No conflicting email
      mockDbChain.first.mockResolvedValue(undefined);
    });

    it('updates and returns the profile when both fields are valid', async () => {
      mockDbChain.first
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(UPDATED_ROW);

      const result = await updateUserProfile(USER_ID, {
        display_name: 'Bob Jones',
        email: 'bob@example.com',
      });

      expect(result.display_name).toBe('Bob Jones');
      expect(result.email).toBe('bob@example.com');
    });

    it('normalises email to lowercase', async () => {
      mockDbChain.first
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(UPDATED_ROW);

      await updateUserProfile(USER_ID, { email: 'BOB@EXAMPLE.COM' });

      // The update payload sent to Knex should contain the lowercased email
      const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload.email).toBe('bob@example.com');
    });

    it('trims whitespace from display_name before update', async () => {
      mockDbChain.first.mockResolvedValue(UPDATED_ROW);

      await updateUserProfile(USER_ID, { display_name: '  Bob Jones  ' });

      const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload.display_name).toBe('Bob Jones');
    });

    it('only updates display_name when email is not provided', async () => {
      mockDbChain.first.mockResolvedValue(UPDATED_ROW);

      await updateUserProfile(USER_ID, { display_name: 'New Name' });

      const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload.display_name).toBe('New Name');
      expect(updatePayload.email).toBeUndefined();
    });

    it('only updates email when display_name is not provided', async () => {
      mockDbChain.first
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(UPDATED_ROW);

      await updateUserProfile(USER_ID, { email: 'new@example.com' });

      const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload.email).toBe('new@example.com');
      expect(updatePayload.display_name).toBeUndefined();
    });
  });

  describe('validation failures → ValidationError (HTTP 422)', () => {
    it('throws ValidationError for display_name shorter than 2 chars', async () => {
      await expect(
        updateUserProfile(USER_ID, { display_name: 'A' }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for display_name longer than 100 chars', async () => {
      await expect(
        updateUserProfile(USER_ID, { display_name: 'A'.repeat(101) }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for invalid email format', async () => {
      await expect(
        updateUserProfile(USER_ID, { email: 'not-an-email' }),
      ).rejects.toThrow(ValidationError);
    });

    it('includes field-level error details', async () => {
      try {
        await updateUserProfile(USER_ID, { display_name: 'A', email: 'bad' });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const e = err as ValidationError;
        const fields = e.errors.map((f) => f.field);
        expect(fields).toContain('display_name');
        expect(fields).toContain('email');
      }
    });
  });

  describe('duplicate email → DuplicateEmailError (HTTP 409)', () => {
    it('throws DuplicateEmailError when email belongs to another account', async () => {
      // Simulate another user existing with the target email
      mockDbChain.first.mockResolvedValue({ id: 'other-user-uuid' });

      await expect(
        updateUserProfile(USER_ID, { email: 'taken@example.com' }),
      ).rejects.toThrow(DuplicateEmailError);
    });
  });

  describe('user not found', () => {
    it('throws UserNotFoundError when update returns no row', async () => {
      // No conflict for email
      mockDbChain.first.mockResolvedValue(undefined);
      // But the update returns nothing (user was deleted between calls)
      mockDbChain.returning.mockResolvedValue([]);

      await expect(
        updateUserProfile(USER_ID, { display_name: 'Ghost' }),
      ).rejects.toThrow(UserNotFoundError);
    });
  });
});

// ================================================================
// changePassword
// ================================================================

describe('changePassword', () => {
  const PLAIN_PASSWORD = 'OldPass1!';
  const NEW_PASSWORD = 'NewPass2@';

  let hashedOldPassword: string;

  beforeAll(async () => {
    // Use cost factor 1 for test speed
    hashedOldPassword = await bcrypt.hash(PLAIN_PASSWORD, 1);
  });

  beforeEach(() => {
    mockDbChain.update.mockResolvedValue(1);
  });

  describe('success path', () => {
    it('resolves without throwing when current password is correct and new password is valid', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await expect(
        changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: NEW_PASSWORD,
        }),
      ).resolves.toBeUndefined();
    });

    it('hashes the new password before storing', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await changePassword(USER_ID, {
        current_password: PLAIN_PASSWORD,
        new_password: NEW_PASSWORD,
      });

      const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updatePayload.password_hash).toBeDefined();
      expect(updatePayload.password_hash).not.toBe(NEW_PASSWORD);

      const isValid = await bcrypt.compare(NEW_PASSWORD, updatePayload.password_hash as string);
      expect(isValid).toBe(true);
    });
  });

  describe('wrong current password → PasswordMismatchError (HTTP 400)', () => {
    it('throws PasswordMismatchError when current_password is wrong', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await expect(
        changePassword(USER_ID, {
          current_password: 'WrongPass1!',
          new_password: NEW_PASSWORD,
        }),
      ).rejects.toThrow(PasswordMismatchError);
    });
  });

  describe('invalid new password → ValidationError (HTTP 422)', () => {
    it('throws ValidationError when new password is too short', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await expect(
        changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: 'short',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when new password has no uppercase letter', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await expect(
        changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: 'nouppercase1!',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when new password has no special character', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      await expect(
        changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: 'NoSpecialChar1',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('ValidationError for new password targets the new_password field', async () => {
      mockDbChain.first.mockResolvedValue({ id: USER_ID, password_hash: hashedOldPassword });

      try {
        await changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: 'weak',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const e = err as ValidationError;
        expect(e.errors[0].field).toBe('new_password');
      }
    });
  });

  describe('user not found', () => {
    it('throws UserNotFoundError when user does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);

      await expect(
        changePassword(USER_ID, {
          current_password: PLAIN_PASSWORD,
          new_password: NEW_PASSWORD,
        }),
      ).rejects.toThrow(UserNotFoundError);
    });
  });
});

// ================================================================
// updateUserSettings
// ================================================================

describe('updateUserSettings', () => {
  it('resolves when the update succeeds', async () => {
    mockDbChain.update.mockResolvedValue(1);

    await expect(
      updateUserSettings(USER_ID, { email_notif_enabled: false }),
    ).resolves.toBeUndefined();
  });

  it('passes the correct email_notif_enabled value to the DB', async () => {
    mockDbChain.update.mockResolvedValue(1);

    await updateUserSettings(USER_ID, { email_notif_enabled: false });

    const updatePayload = mockDbChain.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.email_notif_enabled).toBe(false);
  });

  it('throws UserNotFoundError when no rows were updated (user does not exist)', async () => {
    mockDbChain.update.mockResolvedValue(0);

    await expect(
      updateUserSettings(USER_ID, { email_notif_enabled: true }),
    ).rejects.toThrow(UserNotFoundError);
  });
});
