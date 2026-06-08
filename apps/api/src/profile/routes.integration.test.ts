// Integration tests for profile routes (edit own profile, lookup by tag with
// Discord-style bio gating). Real app + test DB; tables truncated per test.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';

let app: Express;
let db: typeof import('../db/client').db;
let users: typeof import('../db/schema').users;
let friendships: typeof import('../db/schema').friendships;

beforeAll(async () => {
  app = (await import('../app')).createApp();
  ({ db } = await import('../db/client'));
  ({ users, friendships } = await import('../db/schema'));
});

// Sign up a user and return a logged-in agent + their public info.
async function makeUser(email: string, username = 'archer') {
  const agent = request.agent(app);
  const signup = await agent
    .post('/auth/signup')
    .send({ email, username, displayName: 'Name', password: 'supersecret123' });
  await agent.post('/auth/login').send({ email, password: 'supersecret123' });
  return { agent, user: signup.body.user as { id: string; tag: string } };
}

describe('PATCH /profile', () => {
  it('updates display name + bio + image for the logged-in user', async () => {
    const { agent } = await makeUser('a@aligned.dev');
    const res = await agent
      .patch('/profile')
      .send({ displayName: 'New Name', bio: 'hi there', imageUrl: 'https://x.dev/p.png' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('New Name');
    expect(res.body.user.bio).toBe('hi there');
    expect(res.body.user.imageUrl).toBe('https://x.dev/p.png');
  });

  it('requires auth (401 when not logged in)', async () => {
    const res = await request(app).patch('/profile').send({ displayName: 'X' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty update (400)', async () => {
    const { agent } = await makeUser('b@aligned.dev');
    const res = await agent.patch('/profile').send({});
    expect(res.status).toBe(400);
  });

  it('rejects a bad image url (400)', async () => {
    const { agent } = await makeUser('c@aligned.dev');
    const res = await agent.patch('/profile').send({ imageUrl: 'not-a-url' });
    expect(res.status).toBe(400);
  });
});

describe('GET /users/:tag (lookup + bio gating)', () => {
  it('400 for a malformed tag', async () => {
    const { agent } = await makeUser('d@aligned.dev');
    const res = await agent.get('/users/' + encodeURIComponent('nothashtag'));
    expect(res.status).toBe(400);
  });

  it('404 for a tag that does not exist', async () => {
    const { agent } = await makeUser('e@aligned.dev');
    const res = await agent.get('/users/' + encodeURIComponent('ghost#0000'));
    expect(res.status).toBe(404);
  });

  it('HIDES bio when the viewer is NOT a friend', async () => {
    const { user: target } = await makeUser('target@aligned.dev', 'targetuser');
    // give the target a bio
    await db.update(users).set({ bio: 'secret bio' }).where(eq(users.id, target.id));
    const { agent: viewer } = await makeUser('viewer@aligned.dev', 'vieweruser');

    const res = await viewer.get('/users/' + encodeURIComponent(target.tag));
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBeNull(); // gated
    expect(res.body.user.friendshipStatus).toBe('none');
    expect(res.body.user.displayName).toBeDefined(); // public basics still shown
  });

  it('SHOWS bio when the viewer IS a friend', async () => {
    const { user: target } = await makeUser('t2@aligned.dev', 'targettwo');
    await db.update(users).set({ bio: 'secret bio' }).where(eq(users.id, target.id));
    const { agent: viewer, user: viewerUser } = await makeUser('v2@aligned.dev', 'viewertwo');

    // make them accepted friends directly (normalized pair)
    const [low, high] =
      viewerUser.id < target.id ? [viewerUser.id, target.id] : [target.id, viewerUser.id];
    await db.insert(friendships).values({
      userLow: low,
      userHigh: high,
      requesterId: viewerUser.id,
      status: 'accepted',
    });

    const res = await viewer.get('/users/' + encodeURIComponent(target.tag));
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe('secret bio'); // visible to friends
    expect(res.body.user.friendshipStatus).toBe('friends');
  });

  it("reports 'self' when looking up your own tag (and shows bio)", async () => {
    const { agent, user } = await makeUser('self@aligned.dev', 'selfuser');
    await agent.patch('/profile').send({ bio: 'my own bio' });
    const res = await agent.get('/users/' + encodeURIComponent(user.tag));
    expect(res.body.user.friendshipStatus).toBe('self');
    expect(res.body.user.bio).toBe('my own bio');
  });
});
