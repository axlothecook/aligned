// Expand a member's recurring rules (sleep + recurring blocks) into concrete UTC
// busy intervals across a window. One-off events are already absolute and handled
// separately. Pure + unit-testable.
//
// Local-time → UTC: we use Intl to find a zone's offset on a given date, so DST is
// handled (the offset is looked up per-day, not fixed). For each day in the window
// we place the local [startMinute, endMinute) range and convert to absolute UTC.
import type { Interval } from '@aligned/core';

const DAY_MS = 24 * 60 * 60 * 1000;

// Offset (ms) to ADD to a UTC instant to get wall-clock time in `timeZone`, at the
// given instant. Derived via Intl (handles DST). Returns e.g. -7h for LA in summer.
function zoneOffsetMs(instant: Date, timeZone: string): number {
  // Format the instant AS IF in the zone, parse back as if UTC → difference = offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asUtc - instant.getTime();
}

// Convert a local wall-clock (Y/M/D + minutes-from-midnight) in `timeZone` to a UTC
// instant (ms). Iterates once to settle DST (offset depends on the instant).
function localToUtcMs(y: number, m: number, d: number, minutes: number, timeZone: string): number {
  const naiveUtc = Date.UTC(y, m, d) + minutes * 60_000;
  let offset = zoneOffsetMs(new Date(naiveUtc), timeZone);
  let utc = naiveUtc - offset;
  // re-check offset at the resolved instant (handles the DST boundary)
  const offset2 = zoneOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset) utc = naiveUtc - offset2;
  return utc;
}

export type DailyBlock = { startMinute: number; endMinute: number; timezone: string };
export type WeeklyBlock = DailyBlock & { weekdays: number[] }; // 0=Sun..6=Sat

// Expand a DAILY block (sleep) into UTC intervals across [windowStart, windowEnd).
// If endMinute <= startMinute it crosses midnight (e.g. 23:00–07:00).
export function expandDaily(block: DailyBlock, windowStart: number, windowEnd: number): Interval[] {
  return expandWeekly({ ...block, weekdays: [0, 1, 2, 3, 4, 5, 6] }, windowStart, windowEnd);
}

// Expand a WEEKLY block (recurring) into UTC intervals across the window.
export function expandWeekly(block: WeeklyBlock, windowStart: number, windowEnd: number): Interval[] {
  const out: Interval[] = [];
  const crossesMidnight = block.endMinute <= block.startMinute;
  // Walk each calendar day from a day before the window (a crossing block can spill in)
  // to the window end, in the block's timezone.
  const startDay = new Date(windowStart - DAY_MS);
  for (let t = Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate());
       t < windowEnd + DAY_MS; t += DAY_MS) {
    const day = new Date(t);
    const localWd = localWeekday(day, block.timezone); // 0=Sun..6=Sat in the block's zone
    if (!block.weekdays.includes(localWd)) continue;
    const start = localToUtcMs(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), block.startMinute, block.timezone);
    const endDayOffset = crossesMidnight ? DAY_MS : 0;
    const endBase = new Date(t + endDayOffset);
    const end = localToUtcMs(endBase.getUTCFullYear(), endBase.getUTCMonth(), endBase.getUTCDate(), block.endMinute, block.timezone);
    // clip to window
    const s = Math.max(start, windowStart);
    const e = Math.min(end, windowEnd);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

// Local weekday (0=Sun..6=Sat) of a UTC day-date as seen in `timeZone`.
function localWeekday(dayUtc: Date, timeZone: string): number {
  const wdName = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(dayUtc);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wdName);
}
