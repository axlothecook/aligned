// The free-slot ("green") computation — the heart of Aligned. Pure functions, no
// DB/UI deps, shared by web + mobile. Given each member's BUSY intervals (already
// reduced to absolute UTC ms), compute the spans where NOBODY is busy within a
// window = everyone's free time.
//
// Everything here is in absolute UTC milliseconds (epoch). Callers convert their
// sleep/recurring/events into UTC intervals first (timezone handled at the edges).

export type Interval = { start: number; end: number }; // [start, end) in epoch ms

// Merge overlapping/adjacent intervals into a disjoint, sorted set.
export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end); // overlap/touch → extend
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

// Given a window and a set of BUSY intervals, return the FREE gaps within the window.
export function freeWithinWindow(window: Interval, busy: Interval[]): Interval[] {
  const merged = mergeIntervals(
    busy
      // clip to the window
      .map((b) => ({ start: Math.max(b.start, window.start), end: Math.min(b.end, window.end) }))
      .filter((b) => b.end > b.start),
  );
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

// The green = free-for-ALL-members: within the window, the spans where every member
// is free = the window minus the UNION of all members' busy intervals.
// (Union of busy = anybody busy; its complement in the window = nobody busy.)
export function freeForEveryone(window: Interval, perMemberBusy: Interval[][]): Interval[] {
  const allBusy = perMemberBusy.flat();
  return freeWithinWindow(window, allBusy);
}
