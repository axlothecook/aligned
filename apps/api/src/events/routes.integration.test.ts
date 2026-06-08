// Integration tests for events: create timed + all-day, the windowed overlap
// list, edit, delete, ownership guards, and a cross-timezone sanity check.
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  app = (await import('../app')).createApp();
});

async function makeUser(email: string, username: string) {
  const agent = request.agent(app);
  await agent.post('/auth/signup').send({ email, username, displayName: 'N', password: 'supersecret123' });
  await agent.post('/auth/login').send({ email, password: 'supersecret123' });
  // their default calendar
  const cals = await agent.get('/calendars');
  return { agent, calendarId: cals.body.calendars[0].id as string };
}

describe('timed events', () => {
  it('creates a timed event (UTC stored) and lists it in an overlapping window', async () => {
    const A = await makeUser('e-a@al.dev', 'evta');
    const create = await A.agent.post(`/calendars/${A.calendarId}/events`).send({
      title: 'Gym',
      start: '2026-06-10T09:00:00Z',
      end: '2026-06-10T10:00:00Z',
      timezone: 'Europe/Zagreb',
    });
    expect(create.status).toBe(201);
    expect(create.body.event.start).toBe('2026-06-10T09:00:00.000Z');
    expect(create.body.event.timezone).toBe('Europe/Zagreb');

    // overlapping window → found
    const inWin = await A.agent.get(
      `/calendars/${A.calendarId}/events?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`,
    );
    expect(inWin.body.events.map((e: any) => e.title)).toContain('Gym');

    // non-overlapping window → not found
    const outWin = await A.agent.get(
      `/calendars/${A.calendarId}/events?from=2026-06-12T00:00:00Z&to=2026-06-13T00:00:00Z`,
    );
    expect(outWin.body.events.length).toBe(0);
  });

  it('rejects end <= start (400)', async () => {
    const A = await makeUser('e-b@al.dev', 'evtb');
    const res = await A.agent.post(`/calendars/${A.calendarId}/events`).send({
      title: 'Bad',
      start: '2026-06-10T10:00:00Z',
      end: '2026-06-10T09:00:00Z',
      timezone: 'UTC',
    });
    expect(res.status).toBe(400);
  });

  it('cross-timezone instants overlap correctly (the UTC payoff)', async () => {
    const A = await makeUser('e-c@al.dev', 'evtc');
    // 09:00 in Los Angeles (-07:00 in summer) == 16:00 UTC
    await A.agent.post(`/calendars/${A.calendarId}/events`).send({
      title: 'LA morning',
      start: '2026-06-10T09:00:00-07:00',
      end: '2026-06-10T10:00:00-07:00',
      timezone: 'America/Los_Angeles',
    });
    // a window expressed in UTC around 16:00 should catch it
    const win = await A.agent.get(
      `/calendars/${A.calendarId}/events?from=2026-06-10T15:00:00Z&to=2026-06-10T17:00:00Z`,
    );
    expect(win.body.events.map((e: any) => e.title)).toContain('LA morning');
  });
});

describe('all-day events', () => {
  it('creates an all-day event as a floating date range', async () => {
    const A = await makeUser('e-d@al.dev', 'evtd');
    const res = await A.agent.post(`/calendars/${A.calendarId}/events`).send({
      title: 'Holiday',
      isAllDay: true,
      startDate: '2026-06-10',
      endDate: '2026-06-10', // single day
    });
    expect(res.status).toBe(201);
    expect(res.body.event.isAllDay).toBe(true);
    expect(res.body.event.startDate).toBe('2026-06-10');
    expect(res.body.event.endExclusive).toBe('2026-06-11'); // end+1 (exclusive)

    // shows up in a window covering that day
    const win = await A.agent.get(
      `/calendars/${A.calendarId}/events?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`,
    );
    expect(win.body.events.map((e: any) => e.title)).toContain('Holiday');
  });
});

describe('edit + delete + ownership', () => {
  it('edits a timed event (title + move time)', async () => {
    const A = await makeUser('e-e@al.dev', 'evte');
    const ev = (
      await A.agent.post(`/calendars/${A.calendarId}/events`).send({
        title: 'Old',
        start: '2026-06-10T09:00:00Z',
        end: '2026-06-10T10:00:00Z',
        timezone: 'UTC',
      })
    ).body.event;

    const patch = await A.agent.patch(`/events/${ev.id}`).send({
      title: 'New',
      start: '2026-06-10T11:00:00Z',
      end: '2026-06-10T12:00:00Z',
    });
    expect(patch.body.event.title).toBe('New');
    expect(patch.body.event.start).toBe('2026-06-10T11:00:00.000Z');
  });

  it('deletes an event', async () => {
    const A = await makeUser('e-f@al.dev', 'evtf');
    const ev = (
      await A.agent.post(`/calendars/${A.calendarId}/events`).send({
        title: 'X',
        start: '2026-06-10T09:00:00Z',
        end: '2026-06-10T10:00:00Z',
        timezone: 'UTC',
      })
    ).body.event;
    await A.agent.delete(`/events/${ev.id}`).expect(200);
    const win = await A.agent.get(
      `/calendars/${A.calendarId}/events?from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z`,
    );
    expect(win.body.events.length).toBe(0);
  });

  it("cannot create/edit on someone ELSE's calendar (403)", async () => {
    const A = await makeUser('e-g@al.dev', 'evtg');
    const B = await makeUser('e-h@al.dev', 'evth');
    const res = await B.agent.post(`/calendars/${A.calendarId}/events`).send({
      title: 'Hax',
      start: '2026-06-10T09:00:00Z',
      end: '2026-06-10T10:00:00Z',
      timezone: 'UTC',
    });
    expect(res.status).toBe(403);
  });

  it('requires from & to on the list endpoint (400)', async () => {
    const A = await makeUser('e-i@al.dev', 'evti');
    const res = await A.agent.get(`/calendars/${A.calendarId}/events`);
    expect(res.status).toBe(400);
  });
});
