// Friends domain logic (kept out of the routes so it's testable + reusable).
// Implements the anti-spam design (DESIGN.md friendships): ONE row per pair
// (UNIQUE on user_low/user_high → no row pileup), an escalating cooldown after a
// decline (base 1h × declined_count), and a directional `blocks` table.
import { and, eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { friendships, blocks } from '../db/schema';

export const COOLDOWN_BASE_MS = 60 * 60 * 1000; // 1 hour

// Order a pair so (A,B) and (B,A) map to the same (low, high). Pure → unit-testable.
export function normalizePair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

// How long the cooldown is for a given decline count (escalating). Pure.
export function cooldownMsFor(declinedCount: number): number {
  return COOLDOWN_BASE_MS * Math.max(1, declinedCount);
}

export type SendResult =
  | { ok: true; status: 'pending' | 'accepted' }
  | { ok: false; reason: 'self' | 'blocked' | 'cooldown' | 'already-friends'; retryAfterMs?: number };

// Is there a block in EITHER direction between a and b?
async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blocker: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function getPair(low: string, high: string) {
  const [row] = await db
    .select()
    .from(friendships)
    .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
    .limit(1);
  return row ?? null;
}

// Send (or re-send) a friend request from `requesterId` to `targetId`.
export async function sendRequest(
  requesterId: string,
  targetId: string,
  now: Date = new Date(),
): Promise<SendResult> {
  if (requesterId === targetId) return { ok: false, reason: 'self' };
  if (await isBlockedEitherWay(requesterId, targetId)) return { ok: false, reason: 'blocked' };

  const { low, high } = normalizePair(requesterId, targetId);
  const existing = await getPair(low, high);

  if (existing) {
    if (existing.status === 'accepted') return { ok: false, reason: 'already-friends' };
    if (existing.status === 'pending') return { ok: true, status: 'pending' }; // idempotent
    // declined → enforce the escalating cooldown before allowing a re-request
    if (existing.status === 'declined') {
      const waited = now.getTime() - existing.updatedAt.getTime();
      const need = cooldownMsFor(existing.declinedCount);
      if (waited < need) return { ok: false, reason: 'cooldown', retryAfterMs: need - waited };
      await db
        .update(friendships)
        .set({ status: 'pending', requesterId, updatedAt: now })
        .where(eq(friendships.id, existing.id));
      return { ok: true, status: 'pending' };
    }
  }

  // No row yet → create the pending request.
  await db.insert(friendships).values({ userLow: low, userHigh: high, requesterId, status: 'pending' });
  return { ok: true, status: 'pending' };
}

// Accept a pending request. Only the ADDRESSEE (not the requester) may accept.
export async function acceptRequest(
  accepterId: string,
  otherId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const { low, high } = normalizePair(accepterId, otherId);
  const row = await getPair(low, high);
  if (!row || row.status !== 'pending') return { ok: false, reason: 'no-pending-request' };
  if (row.requesterId === accepterId) return { ok: false, reason: 'cannot-accept-own-request' };
  await db.update(friendships).set({ status: 'accepted', updatedAt: now }).where(eq(friendships.id, row.id));
  return { ok: true };
}

// Decline a pending request: status → declined, bump declined_count (escalates cooldown).
export async function declineRequest(
  declinerId: string,
  otherId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const { low, high } = normalizePair(declinerId, otherId);
  const row = await getPair(low, high);
  if (!row || row.status !== 'pending') return { ok: false, reason: 'no-pending-request' };
  if (row.requesterId === declinerId) return { ok: false, reason: 'cannot-decline-own-request' };
  await db
    .update(friendships)
    .set({ status: 'declined', declinedCount: row.declinedCount + 1, updatedAt: now })
    .where(eq(friendships.id, row.id));
  return { ok: true };
}

// Remove an accepted friendship (consensual → hard delete).
export async function unfriend(a: string, b: string): Promise<{ ok: boolean }> {
  const { low, high } = normalizePair(a, b);
  await db
    .delete(friendships)
    .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high), eq(friendships.status, 'accepted')));
  return { ok: true };
}

// Block: insert a directional block AND remove any friendship/request between the pair.
export async function blockUser(blockerId: string, blockedId: string): Promise<{ ok: boolean; reason?: string }> {
  if (blockerId === blockedId) return { ok: false, reason: 'self' };
  const { low, high } = normalizePair(blockerId, blockedId);
  // Remove any existing friendship/request (block removes it, per the design choice).
  await db.delete(friendships).where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)));
  // Insert the block (idempotent via the composite PK; ignore duplicate).
  await db.insert(blocks).values({ blockerId, blockedId }).onConflictDoNothing();
  return { ok: true };
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<{ ok: boolean }> {
  await db.delete(blocks).where(and(eq(blocks.blockerId, blockerId), eq(blocks.blockedId, blockedId)));
  return { ok: true };
}
