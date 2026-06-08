// Shared user-lookup helpers (used by profile + friends routes).
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';

export function parseTag(tag: string): { username: string; discriminator: string } | null {
  const m = /^(.+)#(\d{4})$/.exec(tag);
  if (!m) return null;
  return { username: m[1], discriminator: m[2] };
}

// Find a user by their full username#discriminator tag. Returns the row or null.
export async function findByTag(tag: string) {
  const parsed = parseTag(tag);
  if (!parsed) return null;
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, parsed.username), eq(users.discriminator, parsed.discriminator)))
    .limit(1);
  return u ?? null;
}
