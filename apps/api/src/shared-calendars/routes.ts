// Shared-calendar routes (the revised model). A calendar is a group meetup; each
// member fills in their own busy times; GET /free returns the green = everyone-free.
import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  sharedCalendars,
  calendarMembers,
  sleepBlocks,
  recurringBlocks,
  busyEvents,
  users,
} from '../db/schema';
import { requireAuth } from '../auth/session';
import { findByTag } from '../users/lookup';
import { freeForEveryone, type Interval } from '@aligned/core';
import { expandDaily, expandWeekly } from '../time/expand';
import { tstzrangeLiteral, daterangeLiteral, addDays, parseTstzrange, parseDaterange } from '../time/ranges';

export const sharedCalendarsRouter = Router();

// Default member colours (system-assigned; user-changeable).
const DEFAULT_COLORS = ['#e6194B', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45'];

// Assert the user is a member of the calendar; returns the member row or responds.
async function requireMember(req: any, res: any, calendarId: string) {
  const [m] = await db
    .select()
    .from(calendarMembers)
    .where(and(eq(calendarMembers.calendarId, calendarId), eq(calendarMembers.userId, req.session.userId)))
    .limit(1);
  if (!m) {
    res.status(403).json({ error: 'Not a member of this calendar.' });
    return null;
  }
  return m;
}

async function areFriends(a: string, b: string): Promise<boolean> {
  const { friendships } = await import('../db/schema');
  const [low, high] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
    .limit(1);
  return row?.status === 'accepted';
}

// ── POST /shared-calendars { name?, startDate, memberTags[] } ──────────────────
const createSchema = z.object({
  name: z.string().max(80).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memberTags: z.array(z.string()).max(20).optional().default([]),
});

sharedCalendarsRouter.post('/shared-calendars', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const me = req.session.userId!;
  // resolve member tags → users (must all be accepted friends)
  const memberIds = new Set<string>([me]);
  for (const tag of parsed.data.memberTags) {
    const u = await findByTag(tag);
    if (!u) {
      res.status(404).json({ error: `No user with tag ${tag}.` });
      return;
    }
    if (u.id !== me && !(await areFriends(me, u.id))) {
      res.status(403).json({ error: `You can only add friends (${tag} is not a friend).` });
      return;
    }
    memberIds.add(u.id);
  }

  const [cal] = await db
    .insert(sharedCalendars)
    .values({ name: parsed.data.name ?? null, startDate: parsed.data.startDate, createdBy: me })
    .returning();

  // add members with default colours
  const ids = [...memberIds];
  await db.insert(calendarMembers).values(
    ids.map((userId, i) => ({ calendarId: cal.id, userId, color: DEFAULT_COLORS[i % DEFAULT_COLORS.length] })),
  );

  res.status(201).json({ calendar: { id: cal.id, name: cal.name, startDate: cal.startDate } });
});

// ── GET /shared-calendars (calendars I'm a member of) ──────────────────────────
sharedCalendarsRouter.get('/shared-calendars', requireAuth, async (req, res) => {
  const rows = await db
    .select({ cal: sharedCalendars })
    .from(calendarMembers)
    .innerJoin(sharedCalendars, eq(sharedCalendars.id, calendarMembers.calendarId))
    .where(eq(calendarMembers.userId, req.session.userId!));
  res.json({ calendars: rows.map((r) => ({ id: r.cal.id, name: r.cal.name, startDate: r.cal.startDate })) });
});

// ── GET /shared-calendars/:id (members + their colours + ready) ────────────────
sharedCalendarsRouter.get('/shared-calendars/:id', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const [cal] = await db.select().from(sharedCalendars).where(eq(sharedCalendars.id, req.params.id)).limit(1);
  const members = await db
    .select({ m: calendarMembers, u: users })
    .from(calendarMembers)
    .innerJoin(users, eq(users.id, calendarMembers.userId))
    .where(eq(calendarMembers.calendarId, req.params.id));
  res.json({
    calendar: { id: cal.id, name: cal.name, startDate: cal.startDate },
    members: members.map((r) => ({
      userId: r.u.id,
      tag: `${r.u.username}#${r.u.discriminator}`,
      displayName: r.u.displayName,
      color: r.m.color,
      isReady: r.m.isReady,
    })),
  });
});

// ── POST /shared-calendars/:id/members { tag } (add a friend later) ────────────
sharedCalendarsRouter.post('/shared-calendars/:id/members', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const friend = await findByTag(typeof req.body?.tag === 'string' ? req.body.tag : '');
  if (!friend) {
    res.status(404).json({ error: 'No user with that tag.' });
    return;
  }
  if (!(await areFriends(req.session.userId!, friend.id))) {
    res.status(403).json({ error: 'You can only add friends.' });
    return;
  }
  const count = (await db.select().from(calendarMembers).where(eq(calendarMembers.calendarId, req.params.id))).length;
  await db
    .insert(calendarMembers)
    .values({ calendarId: req.params.id, userId: friend.id, color: DEFAULT_COLORS[count % DEFAULT_COLORS.length] })
    .onConflictDoNothing();
  res.json({ ok: true });
});

// ── PATCH /shared-calendars/:id/me { color?, isReady? } ────────────────────────
const memberPatch = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isReady: z.boolean().optional(),
});
sharedCalendarsRouter.patch('/shared-calendars/:id/me', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const parsed = memberPatch.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Invalid or empty update.' });
    return;
  }
  const [updated] = await db
    .update(calendarMembers)
    .set(parsed.data)
    .where(eq(calendarMembers.id, m.id))
    .returning();
  res.json({ color: updated.color, isReady: updated.isReady });
});

// ── Sleep (one per member) — PUT /shared-calendars/:id/sleep ───────────────────
const sleepSchema = z.object({
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  timezone: z.string().min(1).max(64),
});
sharedCalendarsRouter.put('/shared-calendars/:id/sleep', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const parsed = sleepSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  await db
    .insert(sleepBlocks)
    .values({ calendarId: req.params.id, userId: req.session.userId!, ...parsed.data })
    .onConflictDoUpdate({
      target: [sleepBlocks.calendarId, sleepBlocks.userId],
      set: parsed.data,
    });
  res.json({ ok: true });
});

// ── Recurring blocks — POST / DELETE ───────────────────────────────────────────
const recurringSchema = z.object({
  label: z.string().min(1).max(60),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  timezone: z.string().min(1).max(64),
});
sharedCalendarsRouter.post('/shared-calendars/:id/recurring', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const parsed = recurringSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const [row] = await db
    .insert(recurringBlocks)
    .values({
      calendarId: req.params.id,
      userId: req.session.userId!,
      label: parsed.data.label,
      weekdays: parsed.data.weekdays.join(','),
      startMinute: parsed.data.startMinute,
      endMinute: parsed.data.endMinute,
      timezone: parsed.data.timezone,
    })
    .returning();
  res.status(201).json({ id: row.id });
});
sharedCalendarsRouter.delete('/shared-calendars/:id/recurring/:blockId', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  await db
    .delete(recurringBlocks)
    .where(
      and(
        eq(recurringBlocks.id, req.params.blockId),
        eq(recurringBlocks.userId, req.session.userId!), // only your own
      ),
    );
  res.json({ ok: true });
});

// ── Busy events (one-off) — POST / DELETE ──────────────────────────────────────
const timedBusy = z.object({
  title: z.string().min(1).max(120),
  isAllDay: z.literal(false).optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(64),
});
const allDayBusy = z.object({
  title: z.string().min(1).max(120),
  isAllDay: z.literal(true),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
sharedCalendarsRouter.post('/shared-calendars/:id/events', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const parsed = z.union([allDayBusy, timedBusy]).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const base = { calendarId: req.params.id, userId: req.session.userId! };
  let values;
  if (parsed.data.isAllDay === true) {
    if (parsed.data.endDate < parsed.data.startDate) {
      res.status(400).json({ error: 'endDate before startDate.' });
      return;
    }
    values = { ...base, title: parsed.data.title, isAllDay: true, duringDate: daterangeLiteral(parsed.data.startDate, addDays(parsed.data.endDate, 1)) };
  } else {
    const s = new Date(parsed.data.start);
    const e = new Date(parsed.data.end);
    if (e <= s) {
      res.status(400).json({ error: 'end must be after start.' });
      return;
    }
    values = { ...base, title: parsed.data.title, isAllDay: false, during: tstzrangeLiteral(s, e), timezone: parsed.data.timezone };
  }
  const [row] = await db.insert(busyEvents).values(values).returning();
  res.status(201).json({ id: row.id });
});
sharedCalendarsRouter.delete('/shared-calendars/:id/events/:eventId', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  await db
    .delete(busyEvents)
    .where(and(eq(busyEvents.id, req.params.eventId), eq(busyEvents.userId, req.session.userId!)));
  res.json({ ok: true });
});

// ── GET /shared-calendars/:id/free?from&to (the GREEN = everyone-free) ─────────
sharedCalendarsRouter.get('/shared-calendars/:id/free', requireAuth, async (req, res) => {
  const m = await requireMember(req, res, req.params.id);
  if (!m) return;
  const from = z.string().datetime({ offset: true }).safeParse(req.query.from);
  const to = z.string().datetime({ offset: true }).safeParse(req.query.to);
  if (!from.success || !to.success) {
    res.status(400).json({ error: 'from & to (ISO instants) required.' });
    return;
  }
  const windowStart = new Date(from.data).getTime();
  const windowEnd = new Date(to.data).getTime();
  const window: Interval = { start: windowStart, end: windowEnd };

  const members = await db.select().from(calendarMembers).where(eq(calendarMembers.calendarId, req.params.id));
  const memberIds = members.map((m) => m.userId);

  // Gather everyone's busy intervals (sleep + recurring expanded + one-off events).
  const sleeps = await db.select().from(sleepBlocks).where(eq(sleepBlocks.calendarId, req.params.id));
  const recurrings = await db.select().from(recurringBlocks).where(eq(recurringBlocks.calendarId, req.params.id));
  const events = await db.select().from(busyEvents).where(eq(busyEvents.calendarId, req.params.id));

  const perMemberBusy: Interval[][] = memberIds.map((uid) => {
    const busy: Interval[] = [];
    for (const s of sleeps.filter((x) => x.userId === uid)) {
      busy.push(...expandDaily({ startMinute: s.startMinute, endMinute: s.endMinute, timezone: s.timezone }, windowStart, windowEnd));
    }
    for (const r of recurrings.filter((x) => x.userId === uid)) {
      busy.push(...expandWeekly({ startMinute: r.startMinute, endMinute: r.endMinute, timezone: r.timezone, weekdays: r.weekdays.split(',').map(Number) }, windowStart, windowEnd));
    }
    for (const ev of events.filter((x) => x.userId === uid)) {
      if (ev.during) {
        const r = parseTstzrange(ev.during);
        if (r) busy.push({ start: new Date(r.start).getTime(), end: new Date(r.end).getTime() });
      } else if (ev.duringDate) {
        const r = parseDaterange(ev.duringDate);
        if (r) busy.push({ start: new Date(`${r.start}T00:00:00Z`).getTime(), end: new Date(`${r.endExclusive}T00:00:00Z`).getTime() });
      }
    }
    return busy;
  });

  const allReady = members.every((m) => m.isReady);
  const free = freeForEveryone(window, perMemberBusy);
  res.json({
    allReady,
    free: free.map((f) => ({ start: new Date(f.start).toISOString(), end: new Date(f.end).toISOString() })),
  });
});
