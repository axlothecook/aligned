// Integration tests for the friends flow: request/accept/decline, listing,
// unfriend, block (removes friendship + suppresses requests), and the cooldown.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { and, eq } from 'drizzle-orm';

let app: Express;
let db: typeof import('../db/client').db;
let friendships: typeof import('../db/schema').friendships;

beforeAll(async () => {
  app = (await import('../app')).createApp();
  ({ db } = await import('../db/client'));
  ({ friendships } = await import('../db/schema'));
});

// Sign up + log in; return an agent (keeps cookie) and the user's tag/id.
async function makeUser(email: string, username: string) {
  const agent = request.agent(app);
  const signup = await agent
    .post('/auth/signup')
    .send({ email, username, displayName: 'N', password: 'supersecret123' });
  await agent.post('/auth/login').send({ email, password: 'supersecret123' });
  return { agent, ...(signup.body.user as { id: string; tag: string }) };
}

describe('friend requests', () => {
  it('A requests B → B sees it in /friends/requests → B accepts → both are friends', async () => {
    const A = await makeUser('a@al.dev', 'aaa');
    const B = await makeUser('b@al.dev', 'bbb');

    const req = await A.agent.post('/friends/request').send({ tag: B.tag });
    expect(req.status).toBe(200);
    expect(req.body.status).toBe('pending');

    // B sees the incoming request
    const incoming = await B.agent.get('/friends/requests');
    expect(incoming.body.requests.map((r: any) => r.tag)).toContain(A.tag);

    // A should NOT see it as incoming (A sent it)
    const aIncoming = await A.agent.get('/friends/requests');
    expect(aIncoming.body.requests.length).toBe(0);

    // B accepts
    const acc = await B.agent.post('/friends/accept').send({ tag: A.tag });
    expect(acc.status).toBe(200);

    // both now list each other as friends
    const aFriends = await A.agent.get('/friends');
    const bFriends = await B.agent.get('/friends');
    expect(aFriends.body.friends.map((f: any) => f.tag)).toContain(B.tag);
    expect(bFriends.body.friends.map((f: any) => f.tag)).toContain(A.tag);
  });

  it('cannot accept your OWN request', async () => {
    const A = await makeUser('a2@al.dev', 'aaa2');
    const B = await makeUser('b2@al.dev', 'bbb2');
    await A.agent.post('/friends/request').send({ tag: B.tag });
    const r = await A.agent.post('/friends/accept').send({ tag: B.tag });
    expect(r.status).toBe(400); // A is the requester
  });

  it('re-requesting does NOT create a second row (UNIQUE pair)', async () => {
    const A = await makeUser('a3@al.dev', 'aaa3');
    const B = await makeUser('b3@al.dev', 'bbb3');
    await A.agent.post('/friends/request').send({ tag: B.tag });
    await A.agent.post('/friends/request').send({ tag: B.tag });
    await A.agent.post('/friends/request').send({ tag: B.tag });
    const rows = await db.select().from(friendships);
    expect(rows.length).toBe(1); // spam → still one row
  });

  it('declined re-request is blocked by the cooldown (429)', async () => {
    const A = await makeUser('a4@al.dev', 'aaa4');
    const B = await makeUser('b4@al.dev', 'bbb4');
    await A.agent.post('/friends/request').send({ tag: B.tag });
    await B.agent.post('/friends/decline').send({ tag: A.tag });
    // immediate re-request → cooldown
    const retry = await A.agent.post('/friends/request').send({ tag: B.tag });
    expect(retry.status).toBe(429);
    expect(retry.body.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('unfriend + block', () => {
  it('unfriend removes the friendship', async () => {
    const A = await makeUser('a5@al.dev', 'aaa5');
    const B = await makeUser('b5@al.dev', 'bbb5');
    await A.agent.post('/friends/request').send({ tag: B.tag });
    await B.agent.post('/friends/accept').send({ tag: A.tag });

    await A.agent.delete('/friends').send({ tag: B.tag }).expect(200);
    const aFriends = await A.agent.get('/friends');
    expect(aFriends.body.friends.length).toBe(0);
  });

  it('blocking removes the friendship AND suppresses future requests', async () => {
    const A = await makeUser('a6@al.dev', 'aaa6');
    const B = await makeUser('b6@al.dev', 'bbb6');
    await A.agent.post('/friends/request').send({ tag: B.tag });
    await B.agent.post('/friends/accept').send({ tag: A.tag });

    // A blocks B
    await A.agent.post('/blocks').send({ tag: B.tag }).expect(200);
    // friendship gone
    const rows = await db.select().from(friendships);
    expect(rows.length).toBe(0);
    // B can no longer request A (blocked)
    const blocked = await B.agent.post('/friends/request').send({ tag: A.tag });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('blocked');

    // A unblocks → B can request again
    await A.agent.delete('/blocks').send({ tag: B.tag }).expect(200);
    const ok = await B.agent.post('/friends/request').send({ tag: A.tag });
    expect(ok.status).toBe(200);
  });

  it('cannot friend-request yourself', async () => {
    const A = await makeUser('a7@al.dev', 'aaa7');
    const r = await A.agent.post('/friends/request').send({ tag: A.tag });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('self');
  });

  it('404 for a tag that does not exist', async () => {
    const A = await makeUser('a8@al.dev', 'aaa8');
    const r = await A.agent.post('/friends/request').send({ tag: 'ghost#0000' });
    expect(r.status).toBe(404);
  });
});
