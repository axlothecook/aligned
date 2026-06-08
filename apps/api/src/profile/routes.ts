// Profile routes:
//   PATCH /profile        — edit your own display name / bio / image
//   GET   /users/:tag     — look up a user by their username#discriminator tag.
//                           Returns public basics + your friendship status with them;
//                           bio is shown ONLY if you're friends (Discord-style).
import { Router } from 'express';
import { z } from 'zod';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { users, friendships } from '../db/schema';
import { requireAuth } from '../auth/session';

export const profileRouter = Router();

// ── PATCH /profile (edit own profile) ─────────────────────────────────────────
const editSchema = z
  .object({
    displayName: z.string().min(1).max(40).optional(),
    bio: z.string().max(300).nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update.' });

profileRouter.patch('/profile', requireAuth, async (req, res) => {
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten() });
    return;
  }
  const [updated] = await db
    .update(users)
    .set(parsed.data)
    .where(eq(users.id, req.session.userId!))
    .returning();

  res.json({
    user: {
      id: updated.id,
      tag: `${updated.username}#${updated.discriminator}`,
      displayName: updated.displayName,
      bio: updated.bio,
      imageUrl: updated.imageUrl,
    },
  });
});

// ── GET /users/:tag (lookup by tag) ───────────────────────────────────────────
// :tag is "username#discriminator" — the # is URL-encoded as %23 by the client.
function parseTag(tag: string): { username: string; discriminator: string } | null {
  const m = /^(.+)#(\d{4})$/.exec(tag);
  if (!m) return null;
  return { username: m[1], discriminator: m[2] };
}

// Returns the friendship status between the viewer and target: one of
// 'self' | 'friends' | 'pending' | 'none'.
async function friendshipStatus(viewerId: string, targetId: string) {
  if (viewerId === targetId) return 'self' as const;
  const [low, high] = viewerId < targetId ? [viewerId, targetId] : [targetId, viewerId];
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
    .limit(1);
  if (!row) return 'none' as const;
  if (row.status === 'accepted') return 'friends' as const;
  if (row.status === 'pending') return 'pending' as const;
  return 'none' as const; // declined reads as 'none' to the viewer
}

profileRouter.get('/users/:tag', requireAuth, async (req, res) => {
  const parsed = parseTag(req.params.tag);
  if (!parsed) {
    res.status(400).json({ error: 'Invalid tag (expected username#1234).' });
    return;
  }
  const [target] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.username, parsed.username),
        eq(users.discriminator, parsed.discriminator),
      ),
    )
    .limit(1);
  if (!target) {
    res.status(404).json({ error: 'No user with that tag.' });
    return;
  }

  const status = await friendshipStatus(req.session.userId!, target.id);
  const areFriends = status === 'friends' || status === 'self';

  res.json({
    user: {
      id: target.id,
      tag: `${target.username}#${target.discriminator}`,
      displayName: target.displayName,
      imageUrl: target.imageUrl,
      // Discord-style: bio only visible to friends (and yourself).
      bio: areFriends ? target.bio : null,
      friendshipStatus: status,
    },
  });
});
