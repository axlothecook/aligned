# Aligned — Design Notes

**Aligned** — a social shared-calendar app for friends/family to find their
**free overlapping time** and plan meetups. Web + native mobile.

---

## 📍 STATUS & WHAT'S NEXT

**Where we are (2026-06-08):** Building Phase 1 features. ✅ **Design complete**,
✅ **data model complete** (7 tables), ✅ **scaffold complete** (monorepo + Postgres
+ Drizzle, migrated), ✅ **AUTH complete** (signup / login / logout / me /
email-verification — sessions + bcrypt + Brevo-mock, tested + committed).

**The repo:** `c:\Users\Gebruiker\Desktop\general\aligned\` (monorepo) — see its
`README.md` for how to run. Code lives there; this file is the design/planning note.
Run: `pnpm db:up` → `pnpm dev:api` (:4000) + `pnpm dev:web` (:3000).

**▶ NEXT feature: PROFILES** — edit display name / bio / profile image; view a user
by their `username#tag`. Then: friends → calendars → events → the free-slot merge.
(Feature order: auth✅ → profiles → friends → calendars → events → merge.)

**Learning note:** `c:\Users\Gebruiker\Desktop\learning-notes\ALIGNED_NOTES.md`
(new things learned on this project — Next.js, pnpm monorepo, Drizzle, Postgres).

**Still parked (do before publishing, not now):** design the logo + app icon;
name clearance (trademark / domain / store-name check).

---

## The idea (in one line)

Connected people (friends/family) each keep calendars; when they mutually share
view-access, the app **overlaps their calendars and shows which time slots are
free for everyone**, so the group can plan hangouts. Plus profiles, friends, and
chat — FB/Instagram-like, on web **and** native mobile.

**Purpose for the dev:** this is the **deliberate project for learning Next.js**
(and React Native too). Create_Resume intentionally stays Vite+Express so Next.js
gets learned here instead.

---

## Core features (the product)

- **Profiles** — image + personal info; login; password recovery; username
  recovery; edit personal data. Uniqueness guard: cannot switch to an email (or
  username) already in use by another account.
- **Friends** — add each other (FB/IG-style). Friendship is the basis for calendar
  sharing and chat.
- **Calendars** — a user creates a calendar and adds events (manual entry, or
  imported). When creating/editing a calendar, the owner **chooses which friends
  can VIEW it**.
- **Events** — anything planned. Data window = **today → exactly one year out**.
- **The headline feature — free-slot merge** — takes the calendars friends have
  mutually granted view-access to, **overlaps them, and shows which time slots are
  free vs busy for everyone**, so friends can spot when they can all meet.
- **Chat** — friends message each other (real-time). **Messages retained max 2
  weeks**, rolling deletion.
- **Platforms** — website **and** native apps on **Android** (Play Store) + **iOS**
  (App Store).

---

## Build phases (web MVP first, then grow)

Ship something working at each phase; learn incrementally (piece-by-piece).

- **Phase 1 — Next.js web MVP (the core magic).** Auth + profiles + friends +
  create calendar + manual events + the **free-slot merge view**. A usable,
  demoable product, and where most Next.js learning happens. *(Step order below.)*
- **Phase 2 — Sharing + import.** Per-calendar view permissions + `.ics` import.
- **Phase 3 — Chat.** Separate Socket.IO server (learn WebSockets) + 2-week
  retention.
- **Phase 4 — Mobile apps.** Expo / React Native (iOS + Android) consuming the
  shared TS core + the API. Publish to the stores.
- **Phase 5 — Push notifications.** Expo push (APNs/FCM) so chat/invites reach
  backgrounded apps.
- **Later / optional:** Google OAuth calendar import (with verification).

### Phase 1 — step order

Design the data BEFORE building features — every feature reads/writes these
shapes, so modeling first avoids constant reshaping later.

1. **Data modeling (FIRST — no code needed).** Design every data shape and how
   they relate. The core "things" (each becomes a table):
   - **User** (id, email, username, passwordHash, profile info, image URL)
   - **Friendship** (links two Users)
   - **Calendar** (id, owner → User, name)
   - **Event** (id, calendar → Calendar, start/end time in **UTC** — likely a
     `tstzrange`, title, recurrence rule)
   - **CalendarShare** (which friend may VIEW which calendar — the permission link)
   - **Message** (chat: sender, recipient, text, timestamp; 2-week TTL)

   Plus the relationships (User *has many* Calendars; Calendar *has many* Events;
   etc.). Model with the headline free-slot query in mind — shape the Event time
   so the overlap query is easy/fast.
2. **Scaffold** the `aligned` monorepo (pnpm workspaces) + an empty Next.js web
   app + Postgres running locally (Docker).
3. **Drizzle schema + migrations** — turn the data shapes from step 1 into Drizzle
   table definitions, generate + run migrations to create the real tables.
4. **Build features on top**, in order: auth → profiles → friends → create
   calendar → manual events → the free-slot merge view.

---

## DATA MODEL (in progress — Phase 1 step 1)

Designing tables + fields + relationships. UUID primary keys. All timestamps
`timestamptz` (UTC). *(Status: modeling started 2026-06-08.)*

### Table: `users` ✅
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | internal id |
| `email` | text, **unique** | login + recovery; the "already in use" guard |
| `email_verified` | boolean, default `false` | verify ONCE at account creation (not per login); flips true after confirming the emailed code |
| `username` | text | the word part of the tag — **NOT unique alone** |
| `discriminator` | char(4) | 4-digit number, e.g. `0427`; **auto-random** free value assigned by the app at signup |
| `display_name` | text | shown to everyone (can differ from username) |
| `bio` | text, nullable | small bio |
| `image_url` | text, nullable | profile picture (Cloudflare R2) |
| `password_hash` | text | bcrypt hash (never the raw password) |
| `created_at` | timestamptz | signup time (UTC) |

- **Discord-style tag:** full handle = `username#discriminator` (e.g. `archer#0427`).
  Friend requests are sent by typing someone's full tag → they approve/ignore.
- **Uniqueness:** composite unique on (`username`, `discriminator`) — so `archer#0427`
  and `archer#1188` can coexist. (Known cap: 10,000 discriminators per username —
  fine at friends/family scale; Discord later dropped it at massive scale.)

### Table: `friendships` ✅
One row per user-pair (NOT two). Powers the Discord-tag friend requests.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | |
| `user_low` | uuid → users.id | the pair's **smaller** id (stored smaller-first so (A,B)=(B,A)) |
| `user_high` | uuid → users.id | the pair's **larger** id |
| `requester_id` | uuid → users.id | who SENT the request (low/high loses direction, so we keep this) |
| `status` | enum: `pending` / `accepted` / `declined` | request state |
| `declined_count` | int, default 0 | bumped per decline → harsher cooldown for repeat spammers |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | **drives the re-request cooldown** |
| *constraints* | `CHECK(user_low < user_high)` + `UNIQUE(user_low, user_high)` | the UNIQUE constraint makes row-pileup spam **physically impossible** |

- **Anti-spam design (researched):** row-pileup and re-request spam are TWO problems
  with TWO fixes — (1) the `UNIQUE(user_low,user_high)` constraint means a re-send can
  only ever UPDATE the single pair-row (never insert) → pileup impossible; (2) a
  cooldown check against `updated_at` in app code throttles re-requests (Steam/Discord
  pattern; repeated sends extend the cooldown via `declined_count`).
- **Decline = keep ONE row** marked `declined` + stamp `updated_at` (do NOT delete, do
  NOT insert a 2nd row). Declining is **silent** (no notification to sender, like FB).
- **Unfriend = delete the row** (consensual, not a spam vector).
- Send/re-send flow: normalize to (low, high) → reject if a `blocks` row exists either
  way → cooldown check → UPSERT the pair-row to `pending`.

### Table: `blocks` ✅
Directional (one-way): "A blocks B" ≠ "B blocks A". Separate from friendships because
blocking is directional while friendship is mutual.

| Field | Type | Notes |
|-------|------|-------|
| `blocker_id` | uuid → users.id | who blocked |
| `blocked_id` | uuid → users.id | who got blocked |
| `created_at` | timestamptz | |
| *PK* | (`blocker_id`, `blocked_id`) | allows mutual blocks; `CHECK(blocker_id <> blocked_id)` |

- A block **suppresses** friend requests/messages between the two (checked in app code).

### Table: `calendars` ✅
A lightweight container owned by a user; a user has many.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | |
| `owner_id` | uuid → users.id | ON DELETE CASCADE (delete user → delete their calendars) |
| `name` | text | e.g. "Work", "Personal", "Gym" |
| `color` | text, nullable | optional hex color for the UI |
| `created_at` | timestamptz | |

- **Auto-create a default calendar on signup** (e.g. "My Calendar") so a new user can
  add events immediately. (App logic, not a schema field.)
- Name + color is enough for v1 (no description field yet).

### Table: `events` ✅ (v1 = one-off only; recurrence reserved + future-proof)
The centerpiece — the free-slot overlap query reads this. v1 ships ONE-OFF events
only, but the schema is forward-compatible so adding recurrence later is ADDITIVE
(no reshape of existing rows).

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | |
| `calendar_id` | uuid → calendars.id | ON DELETE CASCADE |
| `title` | text | "Gym", "Dinner with Ana" |
| `during` | **tstzrange** (UTC) | start+end as ONE timezone-aware range — the field the `&&` overlap query + GiST index use. (One range beats two start/end columns: it's what GiST indexes for fast overlap.) |
| `timezone` | text (IANA) | the zone it was created in, e.g. `Europe/Zagreb` — needed for local display + DST-correct recurrence later |
| `is_all_day` | boolean, default false | all-day = the flag + a full-day `during` range (works with the same overlap query) |
| `visibility` | enum: `visible` / `busy_hidden` / `private`, default `visible` | per-event public visibility (see below) |
| `recurrence_rule` | text, **nullable** | RRULE string if it repeats; **NULL = one-off**. ✅ ADD NOW (near-zero cost, future-proofs — v1 always leaves it NULL) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

- **Per-event actions:** Edit (UPDATE the row), Delete (DELETE the row), Hide publicly /
  Show (set `visibility`). Only Hide/Show needs a stored field; Edit/Delete are plain ops.
- **`visibility` (3 states) — only affects what FRIENDS see; the owner always sees their
  own events in full:**
  - `visible` (default) → friends see the full event (title + busy).
  - `busy_hidden` → friends see a **busy block with NO details** (time blocked, title hidden).
  - `private` → friends see **nothing**; that time shows as **FREE** to them.
  - "Hide publicly" lets the user pick `busy_hidden` or `private`; "Show" returns to `visible`.
  - **Free-slot merge rule:** `private` = treated as FREE (event invisible); `busy_hidden`
    + `visible` = treated as BUSY.

- **Indexes:** GiST on `during` for the `&&` overlap. (Per decision #5/#6: store UTC,
  display local; `during` + `timezone` are IDENTICAL for one-offs and future recurring
  masters → no reshape later.)
- **🚨 Recurrence is DEFERRED but the schema is ready (researched 2026-06-08):**
  - Standard model = ONE master row + an RRULE string, occurrences **expanded at
    read-time** (never store one row per occurrence — a weekly event = thousands of
    rows; open-ended = infinite).
  - **v1 one-off = `during` + `timezone` + `recurrence_rule = NULL`.** This row shape is
    UNCHANGED when recurrence ships (a recurring master is the SAME row with
    `recurrence_rule` populated) → recurrence is purely additive.
  - **ADD LATER (recurrence phase), all additive — do NOT build in v1:**
    (a) an `occurrences` derived/materialized table — pre-expand recurring events into
    real `tstzrange` rows for the today→1yr window, so the cross-user overlap query
    stays ONE uniform GiST `&&` over real rows (this is what Google Calendar does; the
    bounded 1-yr window makes it clean). (b) an `event_overrides` table (master_event_id
    + original_start + deleted/new-time) for "edit just THIS occurrence". (c) RRULE
    expansion via `rrule.js` (`between(start,end)` window API; lightly maintained —
    `rrule-temporal` is the newer DST-correct successor to watch).

### Table: `calendar_shares` ✅
The permission link: which friend may VIEW which calendar. Basis for the free-slot merge.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | |
| `calendar_id` | uuid → calendars.id | the shared calendar (ON DELETE CASCADE) |
| `shared_with_id` | uuid → users.id | the friend granted VIEW access (ON DELETE CASCADE) |
| `created_at` | timestamptz | when access was granted |
| *constraint* | `UNIQUE(calendar_id, shared_with_id)` | no duplicate share to the same person |

- **Per-friend sharing** (owner picks individual friends per calendar — matches the spec).
- **View-only** → existence of a row = "can view"; no permission-level field needed.
- The merge is **mutual** (overlap calendars where friends granted EACH OTHER access);
  the mutual check happens in the query, the data is per-direction (one row per grant).
- ("Share with all friends" convenience = a possible later add-on atop this per-friend model.)

### Table: `messages` ✅
1:1 chat between friends. 2-week rolling retention.

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid (PK) | |
| `sender_id` | uuid → users.id | ON DELETE CASCADE |
| `recipient_id` | uuid → users.id | ON DELETE CASCADE |
| `body` | text | the message text |
| `read_at` | timestamptz, nullable | when read (null = unread) → read receipts / unread counts |
| `created_at` | timestamptz | **drives the 14-day TTL** |

- **2-week retention** = a `pg_cron` daily `DELETE FROM messages WHERE created_at < now()
  - interval '14 days'` (decision #8). Index `created_at` so the delete is cheap.
- 1:1 only (sender → recipient); no group chat in scope.
- Same Postgres as everything else (decision #5: don't split chat into a separate store).

### Data model — DONE ✅ (7 tables)
`users` · `friendships` · `blocks` · `calendars` · `events` · `calendar_shares` ·
`messages`. All UUID PKs, all timestamps `timestamptz` (UTC). Plus a `session` table
(owned by connect-pg-simple). Built as Drizzle schema → migrated → live in Postgres.

### IMPLEMENTATION PROGRESS (what's actually built in `aligned/`)
- ✅ **Scaffold** — pnpm monorepo (`apps/web` Next.js 16, `apps/api` Express+Drizzle,
  `packages/core` shared TS), Postgres 17 via Docker (`docker-compose.yml`, port 5433).
- ✅ **Drizzle schema + migrations** — `apps/api/src/db/schema.ts` = all 7 tables +
  `session`; `tstzrange` customType; GiST index on `events.during`; enums
  (`friendship_status`, `event_visibility`); all constraints. 2 migrations applied.
- ✅ **AUTH** (`apps/api/src/auth/`) — signup (bcrypt hash + auto-random
  discriminator + auto default calendar + verify email), login (session cookie),
  logout, `GET /me`, `POST /verify-email` (JWT code). DB-backed sessions
  (connect-pg-simple). Email via ported Brevo module (`src/email/`, mock-when-no-key
  → logs code to console in dev). Tested end-to-end incl. edge cases.
  - Env: `apps/api/.env` (DATABASE_URL, SESSION_SECRET, JWT_SECRET, WEB_BASE_URL;
    Brevo unset in dev).
- ✅ **TESTING** — Vitest + supertest. Unit (`*.test.ts`) + integration
  (`*.integration.test.ts`) configs; separate `aligned_test` DB (global-setup
  migrates, per-test TRUNCATE). `app.ts` (exported app) split from `index.ts`
  (listen) for testability. **Rule: tests as we go, per feature.**
- ✅ **PROFILES** (`apps/api/src/profile/`) — `PATCH /profile` (edit display
  name/bio/image), `GET /users/:tag` (lookup by `username#discriminator` →
  public basics + friendship status; **bio shown ONLY to friends/self**,
  Discord-style). Profile-image FILE upload (→ R2) deferred; `image_url` is a
  string for now.
- ✅ **FRIENDS** (`apps/api/src/friends/`) — `POST /friends/request|accept|decline`
  (by tag), `DELETE /friends` (unfriend), `POST|DELETE /blocks`, `GET /friends` +
  `/friends/requests`. Service layer (`service.ts`) implements the anti-spam design:
  ONE row per pair (UNIQUE → no pileup), escalating cooldown (1h × declined_count →
  429), block REMOVES the friendship + suppresses requests. Shared
  `users/lookup.ts` (findByTag).
- ✅ **CALENDARS** (`apps/api/src/calendars/`) — CRUD (`GET/POST/PATCH/DELETE
  /calendars`, owner-guarded, events cascade on delete) + **friend-gated sharing**
  (`POST/DELETE /calendars/:id/share` — only ACCEPTED friends; `GET
  /calendars/:id/shares`; `GET /shared-with-me`). Delete-anything allowed (can hit
  zero calendars). This is the bridge to the free-slot merge.
- 🧪 **48 tests green** (13 unit + 35 integration). GitHub:
  https://github.com/axlothecook/aligned (branch-per-feature → merge to main → push).
- ⏳ **NEXT: events** (create/edit/delete on a calendar, `tstzrange` UTC + timezone,
  visibility, all-day) → then the **free-slot MERGE** (the headline feature).

---

## LOCKED DECISIONS

*(All decided in the 2026-06-07 idea + research session unless noted.)*

### 1. Name: Aligned
Captures the core idea (schedules aligning). The calendar/social category is very
crowded — most literal names (Overlap/Gather/Linkup/Syncly) are taken — so a
cleaner/coined name was the safe bet; research found no obvious collision.
⚠️ Do a USPTO/EUIPO + `.com`/`.app` + app-store name check before publishing.

### 2. Cross-platform: Next.js web + Expo mobile
- **Next.js alone CANNOT produce native iOS/Android apps** — the key correction to
  the original "React + Next.js" plan.
- Architecture: a monorepo with a Next.js web app, an Expo/React Native mobile app,
  and a shared TypeScript `core` (types, API client, domain logic like the merge).
- Reality check: only **~20–40%** of code is shared (the TS core). The two UIs are
  separate (Next.js renders DOM; React Native renders native views). Share *logic*,
  not screens.
- Rejected: pure **PWA** (Apple rejects under Guideline 4.2 — can't reach iPhone);
  **Capacitor-wrapping Next.js** (forces `output: 'export'` → strips SSR / API
  routes / Server Components → a crippled Next.js).
- **Publishing costs:** Apple Developer Program **$99/yr**; Google Play **$25
  one-time**.

### 3. Repo structure: hybrid monorepo + separate deploy repo
- **One monorepo** (`aligned`) for everything that shares source, **+ a SEPARATE
  deploy repo** (`aligned-deploy`) like Gaming Shop. Rule: *co-locate by
  code-sharing, separate by deployment concern.*

  ```text
  aligned/                  ← monorepo (pnpm workspaces)
    apps/
      web/    (Next.js)
      mobile/ (Expo / React Native)
      api/    (Node + Drizzle + Postgres backend)
    packages/
      core/   (shared TS: types, API client, free-slot algorithm)
  aligned-deploy/           ← SEPARATE repo (Docker Compose, Cloudflare Tunnel, Pi)
  ```

- **Why monorepo for the apps:** web + mobile + api import the shared `core`
  **directly, no publishing**. Separate repos would force publishing `core` as a
  package + re-installing it in each app on every change (constant publish→install
  tax) — pure cost for a solo dev whose apps change together. Backend is IN the
  monorepo so API types are single-source across web/mobile/api. (A monorepo does
  NOT force joint deploys — each app still ships independently from its folder; the
  deploy repo stays separate.)
- **Tooling:** **pnpm workspaces** now (the sharing layer). Add **Turborepo** later
  when builds feel slow (caching/orchestration; optional). Use a **recent Expo SDK
  (54+/55)** so Metro auto-config + monorepo autolinking are handled and the
  pnpm-hoisting/native-build gotchas are avoided. Keep React/RN versions aligned.

### 4. Backend: a separate API service (NOT just Next.js route handlers)
All three clients (web + 2 native) need a stable HTTP API. Treat the backend as
its own service (lives at `apps/api`). Same pattern as Gaming Shop. Next.js route
handlers may serve the web app, but mobile calls the shared API over HTTP.

### 5. Database: PostgreSQL
- **One Postgres for everything**, chat included. Best fit by far for this app's
  data shape, and it serves the hard query (free-slot overlap) *outstandingly*.
- **Why it fits the core feature:** store each event's span as a **`tstzrange`**
  (timezone-aware time range); the **`&&` overlap operator** + a **GiST index**
  answers "do these events overlap?" fast and index-backed — the textbook
  calendar/scheduling use case.
- **Friends-graph** is a small slice → a simple edge table + recursive CTEs cover
  it; no graph DB needed.
- **Chat + 2-week TTL** → a `pg_cron` daily delete (or partition-drop later). Do
  NOT split chat into a separate store; write volume is tiny at Pi scale.
- **Recurring events** → store one root row + a recurrence rule (RRULE), expand
  occurrences at read-time for the queried window. Never materialize every
  occurrence. (The actual hard part of any calendar app; DB-agnostic.)
- **Learning angle:** the dev has only used Postgres through basic Prisma. The
  high-value NEW learning = Postgres's advanced toolbox (range types, GiST
  exclusion constraints, recursive CTEs, partitioning, `pg_cron`). Learn it as we
  build.
- Rejected: Neo4j (weak at range scans — wrong tool for the core query), SurrealDB
  (too young / AI-pivot risk), SQLite (single-writer, no range machinery), Gel/
  EdgeDB (best learn-and-fit option but weak Pi self-host + unverified range
  support → early-adopter risk).

### 6. DB access layer: Drizzle ORM
- **Drizzle** — an ORM (typed query API, schema, built-in migrations), so the dev
  mostly does NOT write raw SQL (the reason they learned Prisma). Chosen over
  Prisma because it handles this app's Postgres-specific core feature far better.
- For the **free-slot overlap query**: define `tstzrange` once as a Drizzle
  **`customType`**; write the `&&` overlap via Drizzle's inline `sql` helper (a
  small typed snippet inside an otherwise-typed query). So ~90% = clean ORM, the
  one hard query = a small typed-SQL snippet (also where the good Postgres learning
  is).
- Why not Prisma: it can't model `tstzrange` / GiST / `EXCLUDE` (treats ranges as
  strings) → you'd hand-write that whole query as raw SQL; and it hides SQL,
  working against the learn-Postgres goal. ("ORM is better" wasn't simply true —
  but Drizzle, a SQL-shaped ORM, gives ORM comfort AND fits this app.)

### 7. The free-slot merge algorithm (the core magic)
- Standard **interval / sweep-line** approach:
  1. Per user: collect events as busy `[start, end)` intervals → sort → merge
     overlaps into a disjoint busy set.
  2. Per user: **invert** within the window → that user's free intervals.
  3. **Intersect** free sets across the N friends (sweep-line counter: any
     sub-interval where "free count == N" is free for everyone). Apply a
     minimum-duration filter for usable slots.
- Complexity ~**O(M log M)** (M = total intervals). Scales fine for friend groups.
- **🚨 Store ALL event times in UTC.** Convert to each user's local timezone only
  for display. Cross-timezone wall-clock comparison silently breaks the merge.
  Store the IANA zone id (not a fixed offset — DST). Pin all-day/floating events
  to a defined zone.

### 8. Chat / realtime: separate Node + Socket.IO server
- **Next.js route handlers (even App Router, 2026) cannot hold WebSocket
  connections** → realtime needs a **separate long-running Node process** (its own
  port on the Pi, behind the same Cloudflare Tunnel).
- **Cloudflare Tunnel DOES carry WebSockets** — but closes idle connections (~100s
  on free/pro). Fix: a **heartbeat ping every ~30–60s** (Socket.IO does this by
  default). Build the heartbeat regardless; then the exact timeout stops mattering.
- Learning detour: build one small feature with plain `ws` first to see the
  protocol nakedly, then switch to Socket.IO for the real chat.
- **Push notifications are a SECOND, separate channel.** A WebSocket only lives
  while the app is open; for "new message" when the app is backgrounded/closed you
  also need push (Expo → APNs for iOS / FCM for Android). Server logic: if the
  recipient's socket is offline, send a push to their stored device token.
- **2-week retention:** messages live in the same Postgres; expire at 14 days via
  `pg_cron` daily delete (or partition-drop later).

### 9. Google Calendar import: `.ics` URL for v1 (OAuth deferred)
- v1 = import via the user's **secret `.ics` URL** (Google/Apple/Outlook all expose
  one) + manual entry. **No OAuth, no Google verification gauntlet, RFC-5545
  standard, read-only** — a perfect fit for import. Tradeoff: poll-based (refreshes
  slowly), and the user copy-pastes a URL.
- **Deferred:** the polished "Connect Google Calendar" OAuth button (real-time
  sync). Needs Google **sensitive-scope verification** (demo video, domain
  ownership, 100-user cap + "unverified app" warning until approved). Worth it
  later; too much friction for v1. (Calendar is "sensitive," NOT "restricted" → no
  CASA security assessment needed.)

### 10. Auth: session cookies + short-lived JWTs for codes
- **Session cookies** for normal login (Gaming Shop / Small-Google-Drive pattern:
  bcrypt + a session store).
- **JWT used ONLY for codes** — password-reset / email-verification tokens, short
  expiry (~1 min to 1 day). Not for the main login session.

### 11. Styling: Sass/SCSS Modules — NO css-in-js
- **Use Sass/SCSS Modules** (`.module.scss`) on the Next.js web app, reusing the
  dev's own `axlothecook-sass-library` (variables/mixins via
  `sassOptions.additionalData`). Next.js has built-in, **zero-runtime,
  RSC-compatible** Sass support → components stay Server Components.
- Optionally **Tailwind** for layout/spacing utilities (composes alongside Sass
  Modules; mobile-first by default).
- **🚫 NOT using runtime css-in-js / MUI / Emotion / styled-components.** MUI
  components **cannot be React Server Components** in 2026 (they run Emotion at
  runtime under `'use client'`), fighting the whole point of Next.js RSC. MUI's
  zero-runtime fix (Pigment CSS) is **paused in early alpha** — don't bet on it.
  (Mobile/React Native uses its own StyleSheet anyway — no shared CSS.)

### 12. Mobile-first responsive design (confirmed industry-standard 2026)
- **Build UI mobile-first**: small-screen layout first, enhance UP via `min-width`
  media queries. Confirmed the 2026 default (MDN, Tailwind/Bootstrap defaults).
  A phone-heavy social app → exactly the mobile-first use case. Nuance (Ahmad
  Shadeed / A List Apart): don't be dogmatic — an occasional `max-width` or
  container query on one component is fine; mobile-first is the *baseline*.

### 13. Deploy: Raspberry Pi + Cloudflare (the Gaming Shop pattern)
- Self-host on the Pi, exposed via **Cloudflare Tunnel** on a subdomain, like
  Gaming Shop. Docker Compose stack. Images on **Cloudflare R2**
  (`images.axlothecook.com`, shared bucket, own project prefix). Postgres on the
  Pi for accounts + messages. CI auto-deploy like Gaming Shop. Copy the proven
  pattern from the `gaming-shop-deploy` repo.

---

## OPEN / PARKED (revisit before publishing — not blocking the build)

- **Logo** — design a logo for "Aligned" + app icon for the stores. Concept
  directions: overlapping shapes, aligned bars/lines, a shared-slot mark.
- **Name clearance** — USPTO/EUIPO trademark check + secure `.com`/`.app` domain +
  confirm the App Store / Google Play listing name is free.

---

## How to teach me (dev's preference)

I'm learning Postgres (and the rest) **as we go.** Explain things **simple and
short** by default — don't over-explain. I'll say **"expand"** when I want a deeper
dive on a specific point.

---

## Related context

- Deploy pattern to copy: the **gaming-shop-deploy** repo (Pi + Cloudflare Tunnel +
  Docker + CI). Storage pattern: shared Cloudflare R2.
- Distinct from the archery site's events/competition **calendar feature** — that
  is a feature of that app, not this project.
