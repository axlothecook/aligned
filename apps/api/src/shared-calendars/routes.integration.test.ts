// Integration tests for the shared-calendar model: create with friend members,
// membership/colour/ready, sleep/recurring/events, and the GREEN free-for-all.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = (await import('../app')).createApp();
});

async function makeUser(email: string, username: string) {
  const agent = request.agent(app);
  const s = await agent.post('/auth/signup').send({ email, username, displayName: 'N', password: 'supersecret123' });
  await agent.post('/auth/login').send({ email, password: 'supersecret123' });
  return { agent, ...(s.body.user as { id: string; tag: string }) };
}
async function befriend(a: any, b: any) {
  await a.agent.post('/friends/request').send({ tag: b.tag });
  await b.agent.post('/friends/accept').send({ tag: a.tag });
}

describe('create + membership', () => {
  it('creates a shared calendar with friend members; both see it', async () => {
    const A = await makeUser('s-a@al.dev', 'sca');
    const B = await makeUser('s-b@al.dev', 'scb');
    await befriend(A, B);

    const create = await A.agent
      .post('/shared-calendars')
      .send({ name: 'Hangout', startDate: '2026-06-01', memberTags: [B.tag] });
    expect(create.status).toBe(201);
    const calId = create.body.calendar.id;

    // both A and B list it
    expect((await A.agent.get('/shared-calendars')).body.calendars.map((c: any) => c.id)).toContain(calId);
    expect((await B.agent.get('/shared-calendars')).body.calendars.map((c: any) => c.id)).toContain(calId);

    // members shown with colours
    const detail = await A.agent.get(`/shared-calendars/${calId}`);
    expect(detail.body.members.length).toBe(2);
    expect(detail.body.members.every((m: any) => /^#[0-9a-fA-F]{6}$/.test(m.color))).toBe(true);
  });

  it('cannot add a NON-friend as a member (403)', async () => {
    const A = await makeUser('s-c@al.dev', 'scc');
    const stranger = await makeUser('s-d@al.dev', 'scd');
    const res = await A.agent
      .post('/shared-calendars')
      .send({ startDate: '2026-06-01', memberTags: [stranger.tag] });
    expect(res.status).toBe(403);
  });

  it('a non-member cannot view the calendar (403)', async () => {
    const A = await makeUser('s-e@al.dev', 'sce');
    const outsider = await makeUser('s-f@al.dev', 'scf');
    const cal = (await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01' })).body.calendar;
    expect((await outsider.agent.get(`/shared-calendars/${cal.id}`)).status).toBe(403);
  });

  it('member can change their colour + ready flag', async () => {
    const A = await makeUser('s-g@al.dev', 'scg');
    const cal = (await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01' })).body.calendar;
    const res = await A.agent.patch(`/shared-calendars/${cal.id}/me`).send({ color: '#abcdef', isReady: true });
    expect(res.body.color).toBe('#abcdef');
    expect(res.body.isReady).toBe(true);
  });
});

describe('the GREEN free-for-all overlap', () => {
  it('an event that one member is busy in is NOT free-for-all', async () => {
    const A = await makeUser('s-h@al.dev', 'sch');
    const B = await makeUser('s-i@al.dev', 'sci');
    await befriend(A, B);
    const cal = (
      await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01', memberTags: [B.tag] })
    ).body.calendar;

    // B is busy 09:00–10:00 UTC on June 10
    await B.agent.post(`/shared-calendars/${cal.id}/events`).send({
      title: 'Busy', start: '2026-06-10T09:00:00Z', end: '2026-06-10T10:00:00Z', timezone: 'UTC',
    });

    // free over a 08:00–12:00 window → should EXCLUDE 09:00–10:00
    const free = await A.agent.get(
      `/shared-calendars/${cal.id}/free?from=2026-06-10T08:00:00Z&to=2026-06-10T12:00:00Z`,
    );
    expect(free.status).toBe(200);
    const slots = free.body.free;
    // there must be a gap that ends at 09:00 and one that starts at 10:00
    expect(slots.some((s: any) => s.end === '2026-06-10T09:00:00.000Z')).toBe(true);
    expect(slots.some((s: any) => s.start === '2026-06-10T10:00:00.000Z')).toBe(true);
    // 09:00–10:00 itself is NOT in any free slot
    const busyCovered = slots.some(
      (s: any) => new Date(s.start) <= new Date('2026-06-10T09:30:00Z') && new Date(s.end) > new Date('2026-06-10T09:30:00Z'),
    );
    expect(busyCovered).toBe(false);
  });

  it('with nobody busy, the whole window is free', async () => {
    const A = await makeUser('s-j@al.dev', 'scj');
    const cal = (await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01' })).body.calendar;
    const free = await A.agent.get(
      `/shared-calendars/${cal.id}/free?from=2026-06-10T08:00:00Z&to=2026-06-10T12:00:00Z`,
    );
    expect(free.body.free).toEqual([
      { start: '2026-06-10T08:00:00.000Z', end: '2026-06-10T12:00:00.000Z' },
    ]);
  });

  it('sleep block makes the nightly hours busy', async () => {
    const A = await makeUser('s-k@al.dev', 'sck');
    const cal = (await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01' })).body.calendar;
    // sleep 23:00–07:00 UTC (1380 → 420, crosses midnight)
    await A.agent.put(`/shared-calendars/${cal.id}/sleep`).send({
      startMinute: 23 * 60, endMinute: 7 * 60, timezone: 'UTC',
    });
    // free over the night of June 10 22:00 → June 11 09:00 → should exclude 23:00–07:00
    const free = await A.agent.get(
      `/shared-calendars/${cal.id}/free?from=2026-06-10T22:00:00Z&to=2026-06-11T09:00:00Z`,
    );
    const slots = free.body.free;
    // 22:00–23:00 free, then 07:00–09:00 free; 23:00–07:00 busy
    expect(slots.some((s: any) => s.start === '2026-06-10T22:00:00.000Z' && s.end === '2026-06-10T23:00:00.000Z')).toBe(true);
    expect(slots.some((s: any) => s.start === '2026-06-11T07:00:00.000Z')).toBe(true);
  });

  it('allReady reflects whether all members clicked Add my schedule', async () => {
    const A = await makeUser('s-l@al.dev', 'scl');
    const B = await makeUser('s-m@al.dev', 'scm');
    await befriend(A, B);
    const cal = (
      await A.agent.post('/shared-calendars').send({ startDate: '2026-06-01', memberTags: [B.tag] })
    ).body.calendar;
    const before = await A.agent.get(`/shared-calendars/${cal.id}/free?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`);
    expect(before.body.allReady).toBe(false);
    await A.agent.patch(`/shared-calendars/${cal.id}/me`).send({ isReady: true });
    await B.agent.patch(`/shared-calendars/${cal.id}/me`).send({ isReady: true });
    const after = await A.agent.get(`/shared-calendars/${cal.id}/free?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`);
    expect(after.body.allReady).toBe(true);
  });
});
