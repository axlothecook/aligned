// Assigns a random free 4-digit discriminator for a username (Discord-style tag
// username#1234). The (username, discriminator) pair is UNIQUE in the DB, so we
// pick a random candidate and retry on collision. Caps at 10,000 per username
// (DESIGN.md users) — fine at friends/family scale.
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';

function randomDiscriminator(): string {
  // 0000–9999, zero-padded.
  return Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
}

export class UsernameFullError extends Error {
  constructor(username: string) {
    super(`No free discriminator left for username "${username}".`);
  }
}

// Try random candidates; on the rare collision, retry. After many failures the
// username is (near) full — surface a clear error.
export async function assignDiscriminator(username: string): Promise<string> {
  const MAX_TRIES = 50;
  for (let i = 0; i < MAX_TRIES; i++) {
    const candidate = randomDiscriminator();
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, username), eq(users.discriminator, candidate)))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  throw new UsernameFullError(username);
}
