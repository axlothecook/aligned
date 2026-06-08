// Password hashing (bcrypt) + the short-lived JWT "code" tokens used for
// email verification and password reset (DESIGN.md #10: session cookies for
// login; JWT ONLY for codes, short expiry).
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ── Short-lived code tokens (JWT) ────────────────────────────────────────────
// Used for email-verification + password-reset links. NOT for the login session.
type CodePayload = { userId: string; kind: 'verify-email' | 'reset-password' };

function secret(): string {
  const s = process.env['JWT_SECRET'];
  if (!s) throw new Error('JWT_SECRET is not set (see apps/api/.env.example)');
  return s;
}

export function makeCodeToken(payload: CodePayload, expiresIn: string): string {
  return jwt.sign(payload, secret(), { expiresIn });
}

export function verifyCodeToken(token: string): CodePayload | null {
  try {
    return jwt.verify(token, secret()) as CodePayload;
  } catch {
    return null;
  }
}
