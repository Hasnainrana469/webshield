/**
 * Unit tests for password reset flow:
 *   requestPasswordReset  (forgot-password)
 *   resetPassword         (reset-password)
 *
 * DB and Nodemailer (via emailService) are mocked so these run without
 * a live PostgreSQL instance or SMTP server.
 *
 * Requirements: 1.6, 1.7, 1.8
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';

// ---- Mock db ----
// Replicate the same chained mock pattern used in authService.test.ts
const mockDbChain = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  insert: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue(1),
  returning: jest.fn(),
};

// We need to support db.transaction(callback). Build a simple mock that
// passes a transaction proxy (with the same interface) to the callback.
const mockTrxChain = {
  where: jest.fn().mockReturnThis(),
  update: jest.fn().mockResolvedValue(1),
};
const mockTrx = jest.fn((table: string) => {
  void table; // suppress unused-variable warning
  return mockTrxChain;
});

const mockDb = jest.fn((table: string) => {
  void table;
  return mockDbChain;
}) as jest.Mock & { transaction: jest.Mock };
mockDb.transaction = jest.fn((callback: (trx: unknown) => Promise<void>) => callback(mockTrx));

jest.mock('../db', () => ({
  __esModule: true,
  default: mockDb,
  withId: <T>(payload: T): T => payload,
}));

// ---- Mock activityLog ----
jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

// ---- Mock emailService ----
const mockSendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('./emailService', () => ({
  sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
}));

// Import after mocks are in place
import {
  requestPasswordReset,
  resetPassword,
  UserNotFoundError,
  InvalidResetTokenError,
  ValidationError,
} from './authService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const EXISTING_USER = {
  id: 'user-uuid-abc',
  display_name: 'Bob Tester',
  email: 'bob@example.com',
  is_active: true,
};

/** A valid raw token (64 hex chars = 32 bytes) */
const RAW_TOKEN = crypto.randomBytes(32).toString('hex');
const TOKEN_HASH = sha256hex(RAW_TOKEN);

const FUTURE_EXPIRES = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

const VALID_TOKEN_RECORD = {
  id: 'prt-uuid-001',
  user_id: 'user-uuid-abc',
  token_hash: TOKEN_HASH,
  expires_at: FUTURE_EXPIRES,
  used_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Reset transaction mock so each test can override if needed
  mockDb.transaction = jest.fn((callback: (trx: unknown) => Promise<void>) => callback(mockTrx));
  // Reset trxChain mocks
  mockTrxChain.where.mockReturnThis();
  mockTrxChain.update.mockResolvedValue(1);
});

// ===========================================================================
// requestPasswordReset
// ===========================================================================

describe('requestPasswordReset', () => {
  describe('success path', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(EXISTING_USER);
      mockDbChain.insert.mockResolvedValue([]);
    });

    it('does not throw when email is registered', async () => {
      await expect(requestPasswordReset('bob@example.com')).resolves.toBeUndefined();
    });

    it('normalises email to lowercase before lookup', async () => {
      await requestPasswordReset('BOB@EXAMPLE.COM');
      expect(mockDbChain.where).toHaveBeenCalledWith({ email: 'bob@example.com' });
    });

    it('inserts a password_reset_tokens row with token_hash, user_id, and expires_at', async () => {
      await requestPasswordReset('bob@example.com');

      // The db('password_reset_tokens') call is the second call on mockDb
      const insertPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertPayload.user_id).toBe(EXISTING_USER.id);
      expect(typeof insertPayload.token_hash).toBe('string');
      expect(insertPayload.token_hash).toHaveLength(64); // SHA-256 hex
      expect(insertPayload.expires_at).toBeInstanceOf(Date);
    });

    it('stores the SHA-256 hash of the raw token, not the raw token itself', async () => {
      // Intercept sendPasswordResetEmail to capture the raw token
      let capturedRawToken: string | undefined;
      mockSendPasswordResetEmail.mockImplementation(
        (opts: { rawToken: string }) => {
          capturedRawToken = opts.rawToken;
          return Promise.resolve();
        }
      );

      await requestPasswordReset('bob@example.com');

      const insertPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, unknown>;
      const storedHash = insertPayload.token_hash as string;

      expect(capturedRawToken).toBeDefined();
      // The stored hash must be the SHA-256 of the raw token sent by email
      expect(storedHash).toBe(sha256hex(capturedRawToken!));
      // The raw token itself must not be stored
      expect(storedHash).not.toBe(capturedRawToken);
    });

    it('sets expires_at approximately 1 hour in the future', async () => {
      const before = Date.now();
      await requestPasswordReset('bob@example.com');
      const after = Date.now();

      const insertPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, unknown>;
      const expiresAt = (insertPayload.expires_at as Date).getTime();

      const oneHourMs = 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThanOrEqual(before + oneHourMs - 1000);
      expect(expiresAt).toBeLessThanOrEqual(after + oneHourMs + 1000);
    });

    it('calls sendPasswordResetEmail with the user email, displayName, and raw token', async () => {
      await requestPasswordReset('bob@example.com');

      expect(mockSendPasswordResetEmail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendPasswordResetEmail.mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.toEmail).toBe(EXISTING_USER.email);
      expect(callArgs.displayName).toBe(EXISTING_USER.display_name);
      expect(typeof callArgs.rawToken).toBe('string');
      expect((callArgs.rawToken as string).length).toBeGreaterThan(0);
    });
  });

  describe('failure path — email not registered', () => {
    it('throws UserNotFoundError when email does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(requestPasswordReset('nobody@example.com')).rejects.toThrow(UserNotFoundError);
    });

    it('does NOT send an email when user is not found', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      try {
        await requestPasswordReset('nobody@example.com');
      } catch {
        // expected
      }
      expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// resetPassword
// ===========================================================================

describe('resetPassword', () => {
  const VALID_NEW_PASSWORD = 'N3wP@ssword!';

  describe('success path', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(VALID_TOKEN_RECORD);
    });

    it('resolves without throwing on valid token and valid password', async () => {
      await expect(resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD)).resolves.toBeUndefined();
    });

    it('looks up the SHA-256 hash of the raw token, not the raw token', async () => {
      await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);
      expect(mockDbChain.where).toHaveBeenCalledWith({ token_hash: TOKEN_HASH });
    });

    it('updates users.password_hash with a bcrypt hash', async () => {
      await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);

      const updatePayload = mockTrxChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(typeof updatePayload.password_hash).toBe('string');
      const isValidBcrypt = await bcrypt.compare(VALID_NEW_PASSWORD, updatePayload.password_hash as string);
      expect(isValidBcrypt).toBe(true);
    });

    it('stores the new password as bcrypt with cost ≥ 12', async () => {
      await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);

      const updatePayload = mockTrxChain.update.mock.calls[0][0] as Record<string, unknown>;
      const hash = updatePayload.password_hash as string;
      // bcrypt hash format: $2b$<cost>$...
      const costMatch = hash.match(/^\$2[ab]\$(\d+)\$/);
      expect(costMatch).not.toBeNull();
      const cost = parseInt(costMatch![1], 10);
      expect(cost).toBeGreaterThanOrEqual(12);
    });

    it('sets used_at on the token_reset_tokens row', async () => {
      await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);

      // Second .update() call on trxChain is for password_reset_tokens
      const tokenUpdatePayload = mockTrxChain.update.mock.calls[1][0] as Record<string, unknown>;
      expect(tokenUpdatePayload.used_at).toBeInstanceOf(Date);
    });

    it('runs password update and token invalidation in the same transaction', async () => {
      await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure — token not found', () => {
    it('throws InvalidResetTokenError when token hash is not in DB', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD)).rejects.toThrow(
        InvalidResetTokenError
      );
    });
  });

  describe('failure — expired token', () => {
    it('throws InvalidResetTokenError when token is expired', async () => {
      const expiredRecord = {
        ...VALID_TOKEN_RECORD,
        expires_at: new Date(Date.now() - 1000), // 1 second in the past
      };
      mockDbChain.first.mockResolvedValue(expiredRecord);
      await expect(resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD)).rejects.toThrow(
        InvalidResetTokenError
      );
    });

    it('does not update password when token is expired', async () => {
      const expiredRecord = {
        ...VALID_TOKEN_RECORD,
        expires_at: new Date(Date.now() - 1000),
      };
      mockDbChain.first.mockResolvedValue(expiredRecord);
      try {
        await resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD);
      } catch {
        // expected
      }
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('failure — already used token', () => {
    it('throws InvalidResetTokenError when used_at is set', async () => {
      const usedRecord = {
        ...VALID_TOKEN_RECORD,
        used_at: new Date(Date.now() - 300_000), // was used 5 minutes ago
      };
      mockDbChain.first.mockResolvedValue(usedRecord);
      await expect(resetPassword(RAW_TOKEN, VALID_NEW_PASSWORD)).rejects.toThrow(
        InvalidResetTokenError
      );
    });
  });

  describe('failure — invalid new password', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(VALID_TOKEN_RECORD);
    });

    it('throws ValidationError when new password is too short', async () => {
      await expect(resetPassword(RAW_TOKEN, 'Aa1!')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when new password has no uppercase letter', async () => {
      await expect(resetPassword(RAW_TOKEN, 'nouppercase1!')).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when new password has no special character', async () => {
      await expect(resetPassword(RAW_TOKEN, 'NoSpecial123')).rejects.toThrow(ValidationError);
    });

    it('reports error on field new_password in ValidationError', async () => {
      try {
        await resetPassword(RAW_TOKEN, 'weak');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const e = err as ValidationError;
        const fields = e.errors.map((f) => f.field);
        expect(fields).toContain('new_password');
      }
    });

    it('does NOT update password when new password fails policy', async () => {
      try {
        await resetPassword(RAW_TOKEN, 'weak');
      } catch {
        // expected
      }
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });
});
