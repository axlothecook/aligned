// Event routes (on a calendar the user owns):
//   POST   /calendars/:id/events            — create (timed OR all-day)
//   GET    /calendars/:id/events?from&to    — list events overlapping [from,to)
//   PATCH  /events/:eventId                  — edit
//   DELETE /events/:eventId                  — delete
//
// TIMED events: client sends start/end as absolute ISO instants + an IANA timezone
// (Google Calendar model). We store the UTC tstzrange + the IANA name.
// ALL-DAY events: client sends startDate/endDate (YYYY-MM-DD, end inclusive). We
// store a FLOATING daterange (no timezone) so the day doesn't shift across zones.
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { events, calendars } from '../db/schema';
import { requireAuth } from '../auth/session';
import {
  tstzrangeLiteral,
  daterangeLiteral,
  addDays,
  parseTstzrange,
  parseDaterange,
} from './ranges';

export const eventsRouter = Router();

// ── validation ────────────────────────────────────────────────────────────────
const timedEvent = z.object({
  title: z.string().min(1).max(120),
  isAllDay: z.literal(false).optional(),
  start: z.string().datetime({ offset: true }), // ISO instant, e.g. 2026-06-10T09:00:00-07:00
  end: z.string().datetime({ offset: true }),
  timezone: z.string().min(1).max(64), // IANA name, e.g. America/Los_Angeles
  visibility: z.enum(['visible', 'busy_hidden', 'private']).optional(),
});
const allDayEvent = z.object({
  title: z.string().min(1).max(120),
  isAllDay: z.literal(true),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // inclusive last day
  visibility: z.enum(['visible', 'busy_hidden', 'private']).optional(),
});
const createSchema = z.union([allDayEvent, timedEvent]);

// Assert the calendar exists + is owned by the logged-in user.
async function ownedCalendar(req: any, res: any, calendarId: string) {
  const [cal] = await db.select().from(calendars).where(eq(calendars.id, calendarId)).limit(1);
  if (!cal) {
    res.status(404).json({ error: 'Calendar not found.' });
    return null;
  }
  if (cal.ownerId !== req.session.userId) {
    res.status(403).json({ error: 'Not your calendar.' });
    return null;
  }
  return cal;
}

// Shape an event row for API output (parse the range back to friendly fields).
function publicEvent(e: typeof events.$inferSelect) {
  const base = {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    isAllDay: e.isAllDay,
    visibility: e.visibility,
  };
  if (e.isAllDay && e.duringDate) {
    const r = parseDaterange(e.duringDate);
    return { ...base, startDate: r?.start, endExclusive: r?.endExclusive };
  }
  const r = e.during ? parseTstzrange(e.during) : null;
  return { ...base, start: r?.start, end: r?.end, timezone: e.timezone };
}

// ── POST /calendars/:id/events ────────────────────────────────────────────────
eventsRouter.post('/calendars/:id/events', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res, req.params.id);
  if (!cal) return;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  let values: typeof events.$inferInsert;
  if (data.isAllDay === true) {
    if (data.endDate < data.startDate) {
      res.status(400).json({ error: 'endDate is before startDate.' });
      return;
    }
    // daterange end is EXCLUSIVE → endDate + 1 day
    values = {
      calendarId: cal.id,
      title: data.title,
      isAllDay: true,
      duringDate: daterangeLiteral(data.startDate, addDays(data.endDate, 1)),
      visibility: data.visibility ?? 'visible',
    };
  } else {
    const start = new Date(data.start);
    const end = new Date(data.end);
    if (end <= start) {
      res.status(400).json({ error: 'end must be after start.' });
      return;
    }
    values = {
      calendarId: cal.id,
      title: data.title,
      isAllDay: false,
      during: tstzrangeLiteral(start, end),
      timezone: data.timezone,
      visibility: data.visibility ?? 'visible',
    };
  }

  const [created] = await db.insert(events).values(values).returning();
  res.status(201).json({ event: publicEvent(created) });
});

// ── GET /calendars/:id/events?from&to ─────────────────────────────────────────
// Returns events overlapping the [from, to) window. TIMED events use the UTC
// `during && window` (GiST-indexed). All-day events overlap on their date range.
eventsRouter.get('/calendars/:id/events', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res, req.params.id);
  if (!cal) return;
  const from = z.string().datetime({ offset: true }).safeParse(req.query.from);
  const to = z.string().datetime({ offset: true }).safeParse(req.query.to);
  if (!from.success || !to.success) {
    res.status(400).json({ error: 'from & to (ISO instants) are required.' });
    return;
  }
  const windowLit = tstzrangeLiteral(new Date(from.data), new Date(to.data));
  // Date window for the all-day overlap (just the date portion of from/to).
  const dFrom = from.data.slice(0, 10);
  const dTo = addDays(to.data.slice(0, 10), 1); // exclusive

  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.calendarId, cal.id),
        sql`(
          (${events.during} IS NOT NULL AND ${events.during} && ${windowLit}::tstzrange)
          OR
          (${events.duringDate} IS NOT NULL AND ${events.duringDate} && ${daterangeLiteral(dFrom, dTo)}::daterange)
        )`,
      ),
    );
  res.json({ events: rows.map(publicEvent) });
});

// ── PATCH /events/:eventId ─────────────────────────────────────────────────────
const editSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  visibility: z.enum(['visible', 'busy_hidden', 'private']).optional(),
  // time edits: timed events may move start/end/timezone
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

// Load an event + assert the user owns its calendar.
async function ownedEvent(req: any, res: any) {
  const [ev] = await db.select().from(events).where(eq(events.id, req.params.eventId)).limit(1);
  if (!ev) {
    res.status(404).json({ error: 'Event not found.' });
    return null;
  }
  const [cal] = await db.select().from(calendars).where(eq(calendars.id, ev.calendarId)).limit(1);
  if (!cal || cal.ownerId !== req.session.userId) {
    res.status(403).json({ error: 'Not your event.' });
    return null;
  }
  return ev;
}

eventsRouter.patch('/events/:eventId', requireAuth, async (req, res) => {
  const ev = await ownedEvent(req, res);
  if (!ev) return;
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: 'Invalid or empty update.' });
    return;
  }
  const d = parsed.data;
  const set: Partial<typeof events.$inferInsert> = { updatedAt: new Date() };
  if (d.title !== undefined) set.title = d.title;
  if (d.visibility !== undefined) set.visibility = d.visibility;
  if (d.timezone !== undefined) set.timezone = d.timezone;
  // Moving a timed event's time: need both start+end (the range is one value).
  if (d.start !== undefined || d.end !== undefined) {
    if (ev.isAllDay) {
      res.status(400).json({ error: 'Cannot set start/end on an all-day event.' });
      return;
    }
    const cur = ev.during ? parseTstzrange(ev.during) : null;
    const start = new Date(d.start ?? cur!.start);
    const end = new Date(d.end ?? cur!.end);
    if (end <= start) {
      res.status(400).json({ error: 'end must be after start.' });
      return;
    }
    set.during = tstzrangeLiteral(start, end);
  }
  const [updated] = await db.update(events).set(set).where(eq(events.id, ev.id)).returning();
  res.json({ event: publicEvent(updated) });
});

// ── DELETE /events/:eventId ────────────────────────────────────────────────────
eventsRouter.delete('/events/:eventId', requireAuth, async (req, res) => {
  const ev = await ownedEvent(req, res);
  if (!ev) return;
  await db.delete(events).where(eq(events.id, ev.id));
  res.json({ ok: true });
});
