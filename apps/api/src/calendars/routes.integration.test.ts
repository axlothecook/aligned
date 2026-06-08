// Integration tests for calendars: CRUD, ownership guards, friend-gated sharing.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = (await import('../app')).createApp();
});

async function makeUser(email: string, username: string) {
  const agent = request.agent(app);
  const signup = await agent
    .post('/auth/signup')
    .send({ email, username, displayName: 'N', password: 'supersecret123' });
  await agent.post('/auth/login').send({ email, password: 'supersecret123' });
  return { agent, ...(signup.body.user as { id: string; tag: string }) };
}

// Make two users accepted friends via the real API.
async function befriend(a: any, b: any) {
  await a.agent.post('/friends/request').send({ tag: b.tag });
  await b.agent.post('/friends/accept').send({ tag: a.tag });
}

describe('calendar CRUD', () => {
  it('new user starts with the auto-created default calendar', async () => {
    const A = await makeUser('c-a@al.dev', 'cala');
    const res = await A.agent.get('/calendars');
    expect(res.status).toBe(200);
    expect(res.body.calendars.length).toBe(1);
    expect(res.body.calendars[0].name).toBe('My Calendar');
  });

  it('create, rename, recolor, then delete a calendar', async () => {
    const A = await makeUser('c-b@al.dev', 'calb');
    const create = await A.agent.post('/calendars').send({ name: 'Work', color: '#f00' });
    expect(create.status).toBe(201);
    const id = create.body.calendar.id;

    const patch = await A.agent.patch(`/calendars/${id}`).send({ name: 'Job', color: '#0f0' });
    expect(patch.body.calendar.name).toBe('Job');
    expect(patch.body.calendar.color).toBe('#0f0');

    await A.agent.delete(`/calendars/${id}`).expect(200);
    const list = await A.agent.get('/calendars');
    expect(list.body.calendars.find((c: any) => c.id === id)).toBeUndefined();
  });

  it('rejects creating with no name (400)', async () => {
    const A = await makeUser('c-c@al.dev', 'calc');
    const res = await A.agent.post('/calendars').send({ color: '#f00' });
    expect(res.status).toBe(400);
  });

  it("cannot edit/delete someone ELSE's calendar (403)", async () => {
    const A = await makeUser('c-d@al.dev', 'cald');
    const B = await makeUser('c-e@al.dev', 'cale');
    const cal = (await A.agent.post('/calendars').send({ name: 'Mine' })).body.calendar;

    expect((await B.agent.patch(`/calendars/${cal.id}`).send({ name: 'Hax' })).status).toBe(403);
    expect((await B.agent.delete(`/calendars/${cal.id}`)).status).toBe(403);
  });

  it('requires auth (401)', async () => {
    expect((await request(app).get('/calendars')).status).toBe(401);
  });
});

describe('calendar sharing (friend-gated)', () => {
  it('can share with a FRIEND; they see it in /shared-with-me', async () => {
    const owner = await makeUser('c-f@al.dev', 'calf');
    const friend = await makeUser('c-g@al.dev', 'calg');
    await befriend(owner, friend);

    const cal = (await owner.agent.post('/calendars').send({ name: 'Shared' })).body.calendar;
    const share = await owner.agent.post(`/calendars/${cal.id}/share`).send({ tag: friend.tag });
    expect(share.status).toBe(200);

    // friend sees it
    const shared = await friend.agent.get('/shared-with-me');
    const got = shared.body.calendars.find((c: any) => c.id === cal.id);
    expect(got).toBeDefined();
    expect(got.owner.tag).toBe(owner.tag);

    // owner sees the share list
    const shares = await owner.agent.get(`/calendars/${cal.id}/shares`);
    expect(shares.body.sharedWith.map((u: any) => u.tag)).toContain(friend.tag);
  });

  it('CANNOT share with a non-friend (403)', async () => {
    const owner = await makeUser('c-h@al.dev', 'calh');
    const stranger = await makeUser('c-i@al.dev', 'cali');
    const cal = (await owner.agent.post('/calendars').send({ name: 'Private' })).body.calendar;

    const res = await owner.agent.post(`/calendars/${cal.id}/share`).send({ tag: stranger.tag });
    expect(res.status).toBe(403);
  });

  it('unshare removes access', async () => {
    const owner = await makeUser('c-j@al.dev', 'calj');
    const friend = await makeUser('c-k@al.dev', 'calk');
    await befriend(owner, friend);
    const cal = (await owner.agent.post('/calendars').send({ name: 'X' })).body.calendar;
    await owner.agent.post(`/calendars/${cal.id}/share`).send({ tag: friend.tag });

    await owner.agent.delete(`/calendars/${cal.id}/share`).send({ tag: friend.tag }).expect(200);
    const shared = await friend.agent.get('/shared-with-me');
    expect(shared.body.calendars.find((c: any) => c.id === cal.id)).toBeUndefined();
  });

  it('cannot share with yourself (400)', async () => {
    const owner = await makeUser('c-l@al.dev', 'call');
    const cal = (await owner.agent.post('/calendars').send({ name: 'X' })).body.calendar;
    const res = await owner.agent.post(`/calendars/${cal.id}/share`).send({ tag: owner.tag });
    expect(res.status).toBe(400);
  });
});
