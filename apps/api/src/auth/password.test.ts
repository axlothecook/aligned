import { describe, it, expect, beforeAll } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  makeCodeToken,
  verifyCodeToken,
} from './password';

beforeAll(() => {
  process.env['JWT_SECRET'] = 'unit_test_jwt_secret';
});

describe('password hashing', () => {
  it('hashes a password to something that is not the plaintext', async () => {
    const hash = await hashPassword('supersecret123');
    expect(hash).not.toBe('supersecret123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifyPassword accepts the correct password', async () => {
    const hash = await hashPassword('supersecret123');
    await expect(verifyPassword('supersecret123', hash)).resolves.toBe(true);
  });

  it('verifyPassword rejects a wrong password', async () => {
    const hash = await hashPassword('supersecret123');
    await expect(verifyPassword('wrongpass', hash)).resolves.toBe(false);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('samepass');
    const b = await hashPassword('samepass');
    expect(a).not.toBe(b);
  });
});

describe('JWT code tokens', () => {
  it('round-trips a payload through make → verify', () => {
    const token = makeCodeToken({ userId: 'u1', kind: 'verify-email' }, '1d');
    const payload = verifyCodeToken(token);
    expect(payload?.userId).toBe('u1');
    expect(payload?.kind).toBe('verify-email');
  });

  it('returns null for a garbage token', () => {
    expect(verifyCodeToken('not.a.real.token')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = makeCodeToken({ userId: 'u1', kind: 'reset-password' }, '1ms');
    await new Promise((r) => setTimeout(r, 10));
    expect(verifyCodeToken(token)).toBeNull();
  });
});
