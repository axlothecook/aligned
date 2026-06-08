// Friends routes. Requests target a user by their tag (username#1234). Thin layer
// over friends/service.ts.
import { Router } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { friendships, users, blocks } from '../db/schema';
import { requireAuth } from '../auth/session';
import { findByTag } from '../users/lookup';
import {
  sendRequest,
  acceptRequest,
  declineRequest,
  unfriend,
  blockUser,
  unblockUser,
} from './service';

export const friendsRouter = Router();

// Resolve `req.body.tag` → target user; respond + return null on problems.
async function resolveTarget(req: any, res: any) {
  const tag = typeof req.body?.tag === 'string' ? req.body.tag : '';
  const target = await findByTag(tag);
  if (!target) {
    res.status(404).json({ error: 'No user with that tag.' });
    return null;
  }
  return target;
}

// ── POST /friends/request { tag } ─────────────────────────────────────────────
friendsRouter.post('/friends/request', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const result = await sendRequest(req.session.userId!, target.id);
  if (result.ok) {
    res.json({ ok: true, status: result.status });
    return;
  }
  const code = result.reason === 'cooldown' ? 429 : 400;
  res.status(code).json({ error: result.reason, retryAfterMs: result.retryAfterMs });
});

// ── POST /friends/accept { tag } / decline ────────────────────────────────────
friendsRouter.post('/friends/accept', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const r = await acceptRequest(req.session.userId!, target.id);
  if (!r.ok) {
    res.status(400).json({ error: r.reason });
    return;
  }
  res.json({ ok: true });
});

friendsRouter.post('/friends/decline', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const r = await declineRequest(req.session.userId!, target.id);
  if (!r.ok) {
    res.status(400).json({ error: r.reason });
    return;
  }
  res.json({ ok: true });
});

// ── DELETE /friends { tag } (unfriend) ────────────────────────────────────────
friendsRouter.delete('/friends', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  await unfriend(req.session.userId!, target.id);
  res.json({ ok: true });
});

// ── POST /blocks { tag } / DELETE /blocks { tag } ─────────────────────────────
friendsRouter.post('/blocks', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const r = await blockUser(req.session.userId!, target.id);
  if (!r.ok) {
    res.status(400).json({ error: r.reason });
    return;
  }
  res.json({ ok: true });
});

friendsRouter.delete('/blocks', requireAuth, async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  await unblockUser(req.session.userId!, target.id);
  res.json({ ok: true });
});

// ── GET /friends (accepted friends) + GET /friends/requests (incoming pending) ─
function publicLite(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    tag: `${u.username}#${u.discriminator}`,
    displayName: u.displayName,
    imageUrl: u.imageUrl,
  };
}

friendsRouter.get('/friends', requireAuth, async (req, res) => {
  const me = req.session.userId!;
  // Accepted rows where I'm either side; join the OTHER user.
  const rows = await db
    .select({ u: users })
    .from(friendships)
    .innerJoin(
      users,
      or(
        and(eq(friendships.userLow, me), eq(users.id, friendships.userHigh)),
        and(eq(friendships.userHigh, me), eq(users.id, friendships.userLow)),
      ),
    )
    .where(eq(friendships.status, 'accepted'));
  res.json({ friends: rows.map((r) => publicLite(r.u)) });
});

friendsRouter.get('/friends/requests', requireAuth, async (req, res) => {
  const me = req.session.userId!;
  // Incoming = pending rows where I'm a member AND someone ELSE is the requester.
  // The requester IS the "other" user, so join users on requester_id.
  const rows = await db
    .select({ u: users })
    .from(friendships)
    .innerJoin(users, eq(users.id, friendships.requesterId))
    .where(
      and(
        eq(friendships.status, 'pending'),
        or(eq(friendships.userLow, me), eq(friendships.userHigh, me)),
        // not requested by me
        // (requesterId is the other user, enforced by the != me check below)
      ),
    );
  res.json({
    requests: rows
      .filter((r) => r.u.id !== me)
      .map((r) => publicLite(r.u)),
  });
});
