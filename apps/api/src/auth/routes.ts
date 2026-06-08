// Auth routes: signup, verify-email, login, logout, me.
// Per DESIGN.md #10: session cookies for login; bcrypt passwords; JWT only for
// the email-verification code. Email verification is required ONCE at signup.
import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, verifyPassword, makeCodeToken, verifyCodeToken } from './password';
import { assignDiscriminator, UsernameFullError } from './discriminator';
import { requireAuth } from './session';
import { sendEmail } from '../email';

export const authRouter = Router();

// ── validation ───────────────────────────────────────────────────────────────
const signupSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers, underscore only'),
  displayName: z.string().min(1).max(40),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── helpers ──────────────────────────────────────────────────────────────────
function webBase(): string {
  return process.env['WEB_BASE_URL'] ?? 'http://localhost:3000';
}

async function sendVerifyEmail(userId: string, email: string) {
  // 1-day code (DESIGN.md #10: short-lived JWT for codes).
  const token = makeCodeToken({ userId, kind: 'verify-email' }, '1d');
  const link = `${webBase()}/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Verify your Aligned account',
    text: `Welcome to Aligned!\n\nConfirm your email by opening this link:\n${link}\n\nThis link expires in 24 hours.`,
  });
}

// Public shape of a user (never leak the password hash).
function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    username: u.username,
    discriminator: u.discriminator,
    tag: `${u.username}#${u.discriminator}`,
    displayName: u.displayName,
    bio: u.bio,
    imageUrl: u.imageUrl,
  };
}

// ── POST /auth/signup ─────────────────────────────────────────────────────────
authRouter.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const { email, username, displayName, password } = parsed.data;

  // Email must be unique.
  const emailTaken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (emailTaken.length > 0) {
    res.status(409).json({ error: 'That email is already in use.' });
    return;
  }

  try {
    const discriminator = await assignDiscriminator(username);
    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ email, username, discriminator, displayName, passwordHash })
      .returning();

    // (No auto-default-calendar: in the shared-calendar model there are no personal
    // calendars — a calendar is a group meetup created by selecting members.)

    // Send the verification code (logged to console in dev).
    await sendVerifyEmail(user.id, user.email);

    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof UsernameFullError) {
      res.status(409).json({ error: 'That username is full — try another.' });
      return;
    }
    console.error('signup error:', err);
    res.status(500).json({ error: 'Could not create the account.' });
  }
});

// ── POST /auth/verify-email ────────────────────────────────────────────────────
authRouter.post('/verify-email', async (req, res) => {
  const token = z.string().safeParse(req.body?.token);
  if (!token.success) {
    res.status(400).json({ error: 'Missing token.' });
    return;
  }
  const payload = verifyCodeToken(token.data);
  if (!payload || payload.kind !== 'verify-email') {
    res.status(400).json({ error: 'Invalid or expired verification link.' });
    return;
  }
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, payload.userId));
  res.json({ ok: true });
});

// ── POST /auth/login ───────────────────────────────────────────────────────────
authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Same generic message whether the email or password is wrong (don't leak which).
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: 'Incorrect email or password.' });
    return;
  }

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────────
authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req, res) => {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, req.session.userId!))
    .limit(1);
  if (!user) {
    // Session points at a deleted user — clear it.
    req.session.destroy(() => {});
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({ user: publicUser(user) });
});
