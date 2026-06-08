// Calendar routes: CRUD on your own calendars + friend-gated sharing.
//   GET    /calendars               — my calendars
//   POST   /calendars               — create
//   PATCH  /calendars/:id           — rename / recolor (owner only)
//   DELETE /calendars/:id           — delete (owner only; events cascade)
//   POST   /calendars/:id/share     — share with a friend (by tag)
//   DELETE /calendars/:id/share     — unshare (by tag)
//   GET    /calendars/:id/shares    — who I've shared this calendar with
//   GET    /shared-with-me          — calendars friends have shared with me
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { calendars, calendarShares, friendships, users } from '../db/schema';
import { requireAuth } from '../auth/session';
import { findByTag } from '../users/lookup';

export const calendarsRouter = Router();

// Load a calendar and assert the logged-in user owns it. Responds + returns null otherwise.
async function ownedCalendar(req: any, res: any) {
  const id = req.params.id;
  const [cal] = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
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

// Are these two users accepted friends?
async function areFriends(a: string, b: string): Promise<boolean> {
  const [low, high] = a < b ? [a, b] : [b, a];
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
    .limit(1);
  return row?.status === 'accepted';
}

function publicCal(c: typeof calendars.$inferSelect) {
  return { id: c.id, name: c.name, color: c.color, ownerId: c.ownerId };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullable().optional(),
});
const updateSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    color: z.string().max(20).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update.' });

calendarsRouter.get('/calendars', requireAuth, async (req, res) => {
  const mine = await db
    .select()
    .from(calendars)
    .where(eq(calendars.ownerId, req.session.userId!));
  res.json({ calendars: mine.map(publicCal) });
});

calendarsRouter.post('/calendars', requireAuth, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const [cal] = await db
    .insert(calendars)
    .values({ ownerId: req.session.userId!, name: parsed.data.name, color: parsed.data.color ?? null })
    .returning();
  res.status(201).json({ calendar: publicCal(cal) });
});

calendarsRouter.patch('/calendars/:id', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res);
  if (!cal) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const [updated] = await db
    .update(calendars)
    .set(parsed.data)
    .where(eq(calendars.id, cal.id))
    .returning();
  res.json({ calendar: publicCal(updated) });
});

calendarsRouter.delete('/calendars/:id', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res);
  if (!cal) return;
  await db.delete(calendars).where(eq(calendars.id, cal.id)); // events + shares cascade
  res.json({ ok: true });
});

// ── Sharing (friend-gated) ────────────────────────────────────────────────────
calendarsRouter.post('/calendars/:id/share', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res);
  if (!cal) return;
  const friend = await findByTag(typeof req.body?.tag === 'string' ? req.body.tag : '');
  if (!friend) {
    res.status(404).json({ error: 'No user with that tag.' });
    return;
  }
  if (friend.id === req.session.userId) {
    res.status(400).json({ error: 'Cannot share with yourself.' });
    return;
  }
  if (!(await areFriends(req.session.userId!, friend.id))) {
    res.status(403).json({ error: 'You can only share with friends.' });
    return;
  }
  await db
    .insert(calendarShares)
    .values({ calendarId: cal.id, sharedWithId: friend.id })
    .onConflictDoNothing(); // idempotent (UNIQUE calendar+friend)
  res.json({ ok: true });
});

calendarsRouter.delete('/calendars/:id/share', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res);
  if (!cal) return;
  const friend = await findByTag(typeof req.body?.tag === 'string' ? req.body.tag : '');
  if (!friend) {
    res.status(404).json({ error: 'No user with that tag.' });
    return;
  }
  await db
    .delete(calendarShares)
    .where(and(eq(calendarShares.calendarId, cal.id), eq(calendarShares.sharedWithId, friend.id)));
  res.json({ ok: true });
});

calendarsRouter.get('/calendars/:id/shares', requireAuth, async (req, res) => {
  const cal = await ownedCalendar(req, res);
  if (!cal) return;
  const rows = await db
    .select({ u: users })
    .from(calendarShares)
    .innerJoin(users, eq(users.id, calendarShares.sharedWithId))
    .where(eq(calendarShares.calendarId, cal.id));
  res.json({
    sharedWith: rows.map((r) => ({
      id: r.u.id,
      tag: `${r.u.username}#${r.u.discriminator}`,
      displayName: r.u.displayName,
    })),
  });
});

// Calendars OTHER people have shared with me.
calendarsRouter.get('/shared-with-me', requireAuth, async (req, res) => {
  const rows = await db
    .select({ cal: calendars, owner: users })
    .from(calendarShares)
    .innerJoin(calendars, eq(calendars.id, calendarShares.calendarId))
    .innerJoin(users, eq(users.id, calendars.ownerId))
    .where(eq(calendarShares.sharedWithId, req.session.userId!));
  res.json({
    calendars: rows.map((r) => ({
      ...publicCal(r.cal),
      owner: { id: r.owner.id, tag: `${r.owner.username}#${r.owner.discriminator}`, displayName: r.owner.displayName },
    })),
  });
});
