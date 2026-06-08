// Integration tests for the auth flow — hit the real Express app against a real
// (test) Postgres DB. Tables are truncated before each test (integration-setup.ts).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { eq } from 'drizzle-orm';

let app: Express;
let db: typeof import('../db/client').db;
let users: typeof import('../db/schema').users;

beforeAll(async () => {
  // Import AFTER integration-setup has set env + pointed the client at the test DB.
  app = (await import('../app')).createApp();
  ({ db } = await import('../db/client'));
  ({ users } = await import('../db/schema'));
});

const goodSignup = {
  email: 'test@aligned.dev',
  username: 'archer',
  displayName: 'Test Archer',
  password: 'supersecret123',
};

describe('POST /auth/signup', () => {
  it('creates a user (201) with a tag', async () => {
    const res = await request(app).post('/auth/signup').send(goodSignup);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(goodSignup.email);
    expect(res.body.user.tag).toMatch(/^archer#\d{4}$/);
    expect(res.body.user.emailVerified).toBe(false);
    // password hash never leaks
    expect(res.body.user.passwordHash).toBeUndefined();
    // user row exists
    const found = await db.select().from(users).where(eq(users.email, goodSignup.email));
    expect(found.length).toBe(1);
  });

  it('rejects a duplicate email (409)', async () => {
    await request(app).post('/auth/signup').send(goodSignup);
    const res = await request(app).post('/auth/signup').send(goodSignup);
    expect(res.status).toBe(409);
  });

  it('rejects invalid input (400) with field errors', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'nope', username: 'x', displayName: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors).toBeDefined();
  });

  it('two users can share a username (different discriminators)', async () => {
    const a = await request(app).post('/auth/signup').send(goodSignup);
    const b = await request(app)
      .post('/auth/signup')
      .send({ ...goodSignup, email: 'second@aligned.dev' });
    expect(a.body.user.tag).toMatch(/^archer#\d{4}$/);
    expect(b.body.user.tag).toMatch(/^archer#\d{4}$/);
    expect(a.body.user.discriminator).not.toBe(b.body.user.discriminator);
  });
});

describe('login / me / logout', () => {
  it('logs in (200), /me returns the user, logout clears the session', async () => {
    await request(app).post('/auth/signup').send(goodSignup);
    const agent = request.agent(app); // keeps the session cookie across requests

    const login = await agent
      .post('/auth/login')
      .send({ email: goodSignup.email, password: goodSignup.password });
    expect(login.status).toBe(200);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(goodSignup.email);

    await agent.post('/auth/logout').expect(200);
    const after = await agent.get('/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects a wrong password (401)', async () => {
    await request(app).post('/auth/signup').send(goodSignup);
    const res = await request(app)
      .post('/auth/login')
      .send({ email: goodSignup.email, password: 'WRONG' });
    expect(res.status).toBe(401);
  });

  it('/me without a session is 401', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/verify-email', () => {
  it('flips email_verified to true with a valid code', async () => {
    await request(app).post('/auth/signup').send(goodSignup);
    const [u] = await db.select().from(users).where(eq(users.email, goodSignup.email));

    // mint the same kind of token the signup email contains
    const { makeCodeToken } = await import('./password');
    const token = makeCodeToken({ userId: u.id, kind: 'verify-email' }, '1d');

    const res = await request(app).post('/auth/verify-email').send({ token });
    expect(res.status).toBe(200);

    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after.emailVerified).toBe(true);
  });

  it('rejects an invalid token (400)', async () => {
    const res = await request(app).post('/auth/verify-email').send({ token: 'garbage' });
    expect(res.status).toBe(400);
  });
});
