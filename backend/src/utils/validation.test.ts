import {
  validateDisplayName,
  validateEmail,
  validatePassword,
} from './validation';

describe('validateDisplayName', () => {
  it('accepts a valid display name', () => {
    expect(validateDisplayName('Alice Smith').valid).toBe(true);
  });

  it('accepts exactly 2 characters', () => {
    expect(validateDisplayName('AB').valid).toBe(true);
  });

  it('accepts exactly 100 characters', () => {
    expect(validateDisplayName('A'.repeat(100)).valid).toBe(true);
  });

  it('rejects a single character', () => {
    const result = validateDisplayName('A');
    expect(result.valid).toBe(false);
    expect(result.message).toBeDefined();
  });

  it('rejects 101 characters', () => {
    const result = validateDisplayName('A'.repeat(101));
    expect(result.valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateDisplayName('').valid).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validateDisplayName(123).valid).toBe(false);
  });

  it('trims whitespace before checking length', () => {
    // A space-only string should fail
    expect(validateDisplayName('  ').valid).toBe(false);
  });
});

describe('validateEmail', () => {
  it('accepts a standard email', () => {
    expect(validateEmail('alice@example.com').valid).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.co.uk').valid).toBe(true);
  });

  it('accepts email with plus sign', () => {
    expect(validateEmail('user+tag@example.com').valid).toBe(true);
  });

  it('rejects email without @', () => {
    expect(validateEmail('notanemail').valid).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(validateEmail('user@').valid).toBe(false);
  });

  it('rejects email without TLD', () => {
    expect(validateEmail('user@localhost').valid).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validateEmail(42).valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEmail('').valid).toBe(false);
  });
});

describe('validatePassword', () => {
  const validPassword = 'P@ssw0rd!';

  it('accepts a valid password', () => {
    expect(validatePassword(validPassword).valid).toBe(true);
  });

  it('accepts a password of exactly 8 characters', () => {
    expect(validatePassword('Aa1!aaaa').valid).toBe(true);
  });

  it('accepts a password of exactly 128 characters', () => {
    // 4 required chars + 124 lowercase to fill
    const base = 'Aa1!';
    expect(validatePassword(base + 'a'.repeat(124)).valid).toBe(true);
  });

  it('rejects password shorter than 8 chars', () => {
    expect(validatePassword('Aa1!ab').valid).toBe(false);
  });

  it('rejects password longer than 128 chars', () => {
    expect(validatePassword('Aa1!' + 'a'.repeat(125)).valid).toBe(false);
  });

  it('rejects password without uppercase', () => {
    expect(validatePassword('pa$$w0rd').valid).toBe(false);
  });

  it('rejects password without lowercase', () => {
    expect(validatePassword('PA$$W0RD').valid).toBe(false);
  });

  it('rejects password without digit', () => {
    expect(validatePassword('P@ssword!').valid).toBe(false);
  });

  it('rejects password without special character', () => {
    expect(validatePassword('Password1').valid).toBe(false);
  });

  it('rejects non-string', () => {
    expect(validatePassword(null).valid).toBe(false);
  });
});
