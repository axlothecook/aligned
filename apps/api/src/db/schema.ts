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
import { daterange } from './daterange';

// ── Enums ────────────────────────────────────────────────────────────────────
export const friendshipStatus = pgEnum('friendship_status', [
  'pending',
  'accepted',
  'declined',
]);

// (The old event_visibility enum was removed in the shared-calendar remodel — in the
// new model busy is busy; there's no per-event public-visibility gating.)

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

// ════════════════════════════════════════════════════════════════════════════
// SHARED-CALENDAR MODEL (revised 2026-06-08). A calendar IS a group meetup; there
// are no personal calendars. Each MEMBER fills in their own busy times; the app
// paints hours nobody is busy GREEN = everyone's free. See DESIGN.md.
// ════════════════════════════════════════════════════════════════════════════

// ── shared_calendars ──────────────────────────────────────────────────────────
// A meetup calendar. `start_date` anchors the rolling 12-month window (window =
// month-containing-start-date → same month next year; rolls forward over time).
export const sharedCalendars = pgTable('shared_calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'), // optional label
  startDate: text('start_date').notNull(), // YYYY-MM-DD; anchors the rolling window
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'set null' as any }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── calendar_members ──────────────────────────────────────────────────────────
// Who is in a shared calendar + their colour (changeable; a default is assigned) +
// their "Add my schedule" ready flag. Green free-for-all shows when ALL are ready.
export const calendarMembers = pgTable(
  'calendar_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => sharedCalendars.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    color: text('color').notNull(), // hex; system default, user-changeable
    isReady: boolean('is_ready').notNull().default(false), // "Add my schedule"
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_member').on(t.calendarId, t.userId)],
);

// ── sleep_blocks ──────────────────────────────────────────────────────────────
// Built-in Sleep per (calendar, user): a nightly local hour range (may cross
// midnight, e.g. 23:00–07:00) applied EVERY day across all 12 months. One per member.
export const sleepBlocks = pgTable(
  'sleep_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => sharedCalendars.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startMinute: integer('start_minute').notNull(), // 0–1439 (minutes from midnight, local)
    endMinute: integer('end_minute').notNull(), // 0–1439; if <= start → crosses midnight
    timezone: text('timezone').notNull(), // IANA zone the local times are in
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('uq_sleep').on(t.calendarId, t.userId)],
);

// ── recurring_blocks ──────────────────────────────────────────────────────────
// User-created "always unavailable" repeats per (calendar, user). v1 shape: a set of
// weekdays + a local time range (e.g. "Tue,Thu 14:00–16:00"). Future: full RRULE.
export const recurringBlocks = pgTable('recurring_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => sharedCalendars.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(), // user's name for it, e.g. "Gym"
  weekdays: text('weekdays').notNull(), // CSV of 0–6 (Sun=0), e.g. "2,4"
  startMinute: integer('start_minute').notNull(), // local minutes from midnight
  endMinute: integer('end_minute').notNull(),
  timezone: text('timezone').notNull(), // IANA zone
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── busy_events ───────────────────────────────────────────────────────────────
// One-off busy slots per (calendar, user). TIMED = UTC tstzrange + IANA timezone;
// ALL-DAY = floating daterange (no zone drift). (Reuses the timezone work already done.)
export const busyEvents = pgTable(
  'busy_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => sharedCalendars.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    isAllDay: boolean('is_all_day').notNull().default(false),
    during: tstzrange('during'), // timed: UTC instant range (the && overlap column)
    timezone: text('timezone'), // timed: IANA zone
    duringDate: daterange('during_date'), // all-day: floating date span
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_busy_during').using('gist', t.during),
    index('ix_busy_cal_user').on(t.calendarId, t.userId),
  ],
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
