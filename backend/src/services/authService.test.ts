/**
 * Unit tests for authService.registerUser.
 *
 * The DB is mocked so these run without a live PostgreSQL instance.
 */

import bcrypt from 'bcrypt';
import { registerUser, ValidationError, DuplicateEmailError } from './authService';

// ---- Mock db ----
const mockDbChain = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  returning: jest.fn(),
  onConflict: jest.fn().mockReturnThis(),
  ignore: jest.fn().mockResolvedValue([]),
  update: jest.fn().mockResolvedValue(1),
};

jest.mock('../db', () => {
  const mockFn = jest.fn(() => mockDbChain);
  return {
    __esModule: true,
    default: mockFn,
    db: mockFn,
    withId: <T>(payload: T): T => payload,
  };
});

// ---- Mock activityLog ----
jest.mock('../utils/activityLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
}));

const VALID_INPUT = {
  display_name: 'Alice Smith',
  email: 'alice@example.com',
  password: 'P@ssw0rd123!',
};

const NEW_USER_ROW = {
  id: 'uuid-1234',
  display_name: 'Alice Smith',
  email: 'alice@example.com',
  role: 'user',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('registerUser', () => {
  describe('success path', () => {
    beforeEach(() => {
      mockDbChain.first
        .mockResolvedValueOnce(undefined) // no existing user
        .mockResolvedValueOnce(NEW_USER_ROW); // fetch inserted user
    });

    it('returns the new user profile on success', async () => {
      const result = await registerUser(VALID_INPUT);
      expect(result).toEqual({
        user_id: 'uuid-1234',
        display_name: 'Alice Smith',
        email: 'alice@example.com',
        role: 'user',
      });
    });

    it('stores a bcrypt hash, not the plain password', async () => {
      await registerUser(VALID_INPUT);

      // Retrieve what was passed to .insert()
      const insertedPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, string>;
      expect(insertedPayload.password_hash).toBeDefined();
      expect(insertedPayload.password_hash).not.toBe(VALID_INPUT.password);

      const match = await bcrypt.compare(VALID_INPUT.password, insertedPayload.password_hash);
      expect(match).toBe(true);
    });

    it('normalises the email to lowercase', async () => {
      await registerUser({ ...VALID_INPUT, email: 'Alice@Example.COM' });
      const insertedPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, string>;
      expect(insertedPayload.email).toBe('alice@example.com');
    });

    it('assigns the "user" role by default', async () => {
      await registerUser(VALID_INPUT);
      const insertedPayload = mockDbChain.insert.mock.calls[0][0] as Record<string, string>;
      expect(insertedPayload.role).toBe('user');
    });
  });

  describe('duplicate email', () => {
    it('throws DuplicateEmailError when the email exists', async () => {
      mockDbChain.first.mockResolvedValue({ id: 'existing-uuid' });
      await expect(registerUser(VALID_INPUT)).rejects.toThrow(DuplicateEmailError);
    });
  });

  describe('validation failures → ValidationError', () => {
    beforeEach(() => {
      mockDbChain.first.mockResolvedValue(undefined);
    });

    it('throws on missing display_name', async () => {
      await expect(
        registerUser({ ...VALID_INPUT, display_name: 'A' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws on invalid email', async () => {
      await expect(
        registerUser({ ...VALID_INPUT, email: 'notanemail' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws on weak password (no special char)', async () => {
      await expect(
        registerUser({ ...VALID_INPUT, password: 'Password1' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws on password shorter than 8 chars', async () => {
      await expect(
        registerUser({ ...VALID_INPUT, password: 'Aa1!' })
      ).rejects.toThrow(ValidationError);
    });

    it('includes per-field error details', async () => {
      try {
        await registerUser({ display_name: 'A', email: 'bad', password: 'weak' });
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const e = err as ValidationError;
        // All three fields should produce errors
        const fields = e.errors.map((f) => f.field);
        expect(fields).toContain('display_name');
        expect(fields).toContain('email');
        expect(fields).toContain('password');
      }
    });
  });
});

// ============================================================
// loginUser tests
// ============================================================

import jwt from 'jsonwebtoken';
import { loginUser, InvalidCredentialsError, LoginResult } from './authService';

const VALID_EMAIL = 'alice@example.com';
const VALID_PASSWORD = 'P@ssw0rd123!';

// Use cost 1 for test speed — bcrypt.compare still works correctly at any cost.
let hashedPassword: string;

beforeAll(async () => {
  const bcrypt = await import('bcrypt');
  hashedPassword = await bcrypt.hash(VALID_PASSWORD, 1);
});

const ACTIVE_USER_ROW = () => ({
  id: 'user-uuid-999',
  display_name: 'Alice Smith',
  email: VALID_EMAIL,
  password_hash: hashedPassword,
  role: 'user',
  is_active: true,
});

describe('loginUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-key-for-jest';
  });

  afterAll(() => {
    delete process.env.JWT_SECRET;
  });

  describe('success path', () => {
    beforeEach(() => {
      mockDbChain.first.mockImplementation(() => Promise.resolve(ACTIVE_USER_ROW()));
    });

    it('returns a token and user object on valid credentials', async () => {
      const result: LoginResult = await loginUser({ email: VALID_EMAIL, password: VALID_PASSWORD });
      expect(result.token).toBeDefined();
      expect(result.user.user_id).toBe('user-uuid-999');
      expect(result.user.email).toBe(VALID_EMAIL);
      expect(result.user.role).toBe('user');
      expect(result.user.display_name).toBe('Alice Smith');
    });

    it('issues a JWT with jti, user_id, and role claims', async () => {
      const result = await loginUser({ email: VALID_EMAIL, password: VALID_PASSWORD });
      const decoded = jwt.verify(result.token, 'test-secret-key-for-jest') as jwt.JwtPayload;
      expect(decoded.jti).toBeDefined();
      expect(decoded.user_id).toBe('user-uuid-999');
      expect(decoded.role).toBe('user');
    });

    it('issues a JWT with approximately 24-hour expiry', async () => {
      const result = await loginUser({ email: VALID_EMAIL, password: VALID_PASSWORD });
      const decoded = jwt.verify(result.token, 'test-secret-key-for-jest') as jwt.JwtPayload;
      const ttlSeconds = decoded.exp! - decoded.iat!;
      expect(ttlSeconds).toBe(86400); // exactly 24 hours
    });

    it('normalises email to lowercase before lookup', async () => {
      await loginUser({ email: 'Alice@Example.COM', password: VALID_PASSWORD });
      // DB should be queried with lowercased email
      expect(mockDbChain.where).toHaveBeenCalledWith({ email: 'alice@example.com' });
    });

    it('issues a JWT signed with HS256 algorithm', async () => {
      const result = await loginUser({ email: VALID_EMAIL, password: VALID_PASSWORD });
      const header = JSON.parse(Buffer.from(result.token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');
    });
  });

  describe('failure paths — all return InvalidCredentialsError (no field discrimination)', () => {
    it('throws InvalidCredentialsError when user does not exist', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      await expect(loginUser({ email: 'nope@example.com', password: VALID_PASSWORD }))
        .rejects.toThrow(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError when account is inactive', async () => {
      mockDbChain.first.mockResolvedValue({ ...ACTIVE_USER_ROW(), is_active: false });
      await expect(loginUser({ email: VALID_EMAIL, password: VALID_PASSWORD }))
        .rejects.toThrow(InvalidCredentialsError);
    });

    it('throws InvalidCredentialsError when password is wrong', async () => {
      mockDbChain.first.mockImplementation(() => Promise.resolve(ACTIVE_USER_ROW()));
      await expect(loginUser({ email: VALID_EMAIL, password: 'WrongPass1!' }))
        .rejects.toThrow(InvalidCredentialsError);
    });

    it('error message does not reveal which field is wrong', async () => {
      mockDbChain.first.mockResolvedValue(undefined);
      try {
        await loginUser({ email: 'nobody@example.com', password: VALID_PASSWORD });
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidCredentialsError);
        const e = err as InvalidCredentialsError;
        // Message must be generic — must not mention "email" or "password" specifically
        expect(e.message).toBe('Invalid email or password.');
      }
    });
  });
});

// ============================================================
// logoutUser tests
// ============================================================

import { logoutUser, InvalidTokenError } from './authService';

// A real HS256 token with jti, user_id, sub, and exp — signed with 'test-secret-key-for-jest'.
const VALID_TOKEN = jwt.sign(
  { user_id: 'user-uuid-999', role: 'user' },
  'test-secret-key-for-jest',
  { algorithm: 'HS256', expiresIn: '99y', subject: 'user-uuid-999', jwtid: 'test-jti-001' }
);

describe('logoutUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // insert must return mockDbChain (not a resolved value) so that .onConflict().ignore() can chain
    mockDbChain.insert.mockReturnThis();
    mockDbChain.onConflict.mockReturnThis();
    mockDbChain.ignore.mockResolvedValue([]);
    mockDbChain.returning.mockResolvedValue([]);
  });

  describe('success path', () => {
    it('inserts the token jti into token_blocklist', async () => {
      // We need mockDbChain.insert to be called on 'token_blocklist'.
      // The existing db mock returns mockDbChain for any table name.
      await logoutUser(`Bearer ${VALID_TOKEN}`);

      const insertCall = mockDbChain.insert.mock.calls[0][0] as Record<string, unknown>;
      expect(insertCall.token_jti).toBe('test-jti-001');
      expect(insertCall.user_id).toBe('user-uuid-999');
      expect(insertCall.expires_at).toBeInstanceOf(Date);
    });

    it('resolves without throwing on a valid token', async () => {
      await expect(logoutUser(`Bearer ${VALID_TOKEN}`)).resolves.toBeUndefined();
    });

    it('sets expires_at from the token exp claim', async () => {
      const now = Math.floor(Date.now() / 1000);
      const futureExp = now + 3600;
      const tokenWithKnownExp = jwt.sign(
        { jti: 'jti-exp-test', user_id: 'user-abc', role: 'user' },
        'test-secret-key-for-jest',
        { algorithm: 'HS256', expiresIn: '1h', subject: 'user-abc' }
      );
      await logoutUser(`Bearer ${tokenWithKnownExp}`);
      const insertCall = mockDbChain.insert.mock.calls[0][0] as Record<string, unknown>;
      const expiresAt = insertCall.expires_at as Date;
      // Allow ±5 seconds tolerance for test timing
      expect(expiresAt.getTime() / 1000).toBeCloseTo(futureExp, -1);
    });
  });

  describe('failure paths → InvalidTokenError', () => {
    it('throws when Authorization header is undefined', async () => {
      await expect(logoutUser(undefined)).rejects.toThrow(InvalidTokenError);
    });

    it('throws when Authorization header does not start with "Bearer "', async () => {
      await expect(logoutUser('Basic abc123')).rejects.toThrow(InvalidTokenError);
    });

    it('throws when Bearer token is empty', async () => {
      await expect(logoutUser('Bearer ')).rejects.toThrow(InvalidTokenError);
    });

    it('throws when token cannot be decoded (garbage string)', async () => {
      await expect(logoutUser('Bearer not.a.jwt')).rejects.toThrow(InvalidTokenError);
    });

    it('throws when token is missing jti claim', async () => {
      const tokenNoJti = jwt.sign(
        { user_id: 'user-uuid-999', role: 'user' },
        'test-secret-key-for-jest',
        { algorithm: 'HS256', expiresIn: '1h', subject: 'user-uuid-999' }
      );
      await expect(logoutUser(`Bearer ${tokenNoJti}`)).rejects.toThrow(InvalidTokenError);
    });
  });
});
