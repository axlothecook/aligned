// Aligned database schema — the 7 tables from docs/DESIGN.md "DATA MODEL".
// UUID primary keys; all timestamps timestamptz (UTC).
//
// Tables: users · friendships · blocks · calendars · events · calendar_shares · messages
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  char,
  json,
  varchar,
  unique,
  primaryKey,
  check,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tstzrange } from './tstzrange';

// ── Enums ────────────────────────────────────────────────────────────────────
export const friendshipStatus = pgEnum('friendship_status', [
  'pending',
  'accepted',
  'declined',
]);

export const eventVisibility = pgEnum('event_visibility', [
  'visible', // friends see the full event
  'busy_hidden', // friends see a busy block, no details
  'private', // friends see nothing (time shows FREE to them)
]);

// ── users ────────────────────────────────────────────────────────────────────
// Discord-style tag: username#discriminator. Unique on the PAIR, not username alone.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    username: text('username').notNull(),
    discriminator: char('discriminator', { length: 4 }).notNull(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    imageUrl: text('image_url'),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_user_tag').on(t.username, t.discriminator)],
);

// ── friendships ──────────────────────────────────────────────────────────────
// ONE row per user-pair. user_low < user_high normalizes the pair so (A,B)=(B,A).
// The UNIQUE(user_low,user_high) makes re-request row-pileup impossible; a cooldown
// on updated_at (in app code) throttles re-request spam (DESIGN.md friendships).
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userLow: uuid('user_low')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: friendshipStatus('status').notNull().default('pending'),
    declinedCount: integer('declined_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('user_order', sql`${t.userLow} < ${t.userHigh}`),
    unique('uq_pair').on(t.userLow, t.userHigh),
    index('ix_friend_high').on(t.userHigh),
  ],
);

// ── blocks ───────────────────────────────────────────────────────────────────
// Directional: "A blocks B" ≠ "B blocks A". Ordered pair = allows mutual blocks.
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    check('no_self_block', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

// ── calendars ────────────────────────────────────────────────────────────────
export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── events ───────────────────────────────────────────────────────────────────
// The centerpiece. v1 = one-off events (recurrence_rule stays NULL); the schema is
// forward-compatible so recurrence is purely additive later (DESIGN.md events).
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    during: tstzrange('during').notNull(), // UTC start+end; the && overlap column
    timezone: text('timezone').notNull(), // IANA zone, e.g. 'Europe/Zagreb'
    isAllDay: boolean('is_all_day').notNull().default(false),
    visibility: eventVisibility('visibility').notNull().default('visible'),
    recurrenceRule: text('recurrence_rule'), // RRULE if it repeats; NULL = one-off
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // GiST index on the range powers the fast `during && window` overlap query.
    index('ix_events_during').using('gist', t.during),
    index('ix_events_calendar').on(t.calendarId),
  ],
);

// ── calendar_shares ──────────────────────────────────────────────────────────
// Which friend may VIEW which calendar (per-friend, view-only). Powers the merge.
export const calendarShares = pgTable(
  'calendar_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    sharedWithId: uuid('shared_with_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_share').on(t.calendarId, t.sharedWithId)],
);

// ── messages ─────────────────────────────────────────────────────────────────
// 1:1 chat. 2-week retention via pg_cron in PRODUCTION (created_at drives the TTL).
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }), // null = unread
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_messages_created').on(t.createdAt)], // cheap TTL deletes
);

// ── session ──────────────────────────────────────────────────────────────────
// Owned by `connect-pg-simple` (express-session's Postgres store). It reads/writes
// this table itself; we define it only so our migration creates it. Shape must
// match connect-pg-simple's expected table (sid PK, sess json, expire timestamp).
export const session = pgTable(
  'session',
  {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6, withTimezone: true }).notNull(),
  },
  (t) => [index('ix_session_expire').on(t.expire)],
);
