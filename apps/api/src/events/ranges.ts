// Helpers to build/parse Postgres range LITERALS for events. Pure → unit-testable.
//
//   tstzrange (timed): half-open '[<utc-start>,<utc-end>)' of absolute instants.
//   daterange (all-day): half-open '[<start-date>,<end-end-exclusive>)' of floating dates.
//
// Half-open [start, end) is the Postgres + iCalendar convention: the end is
// EXCLUSIVE, so back-to-back events (10:00–11:00 and 11:00–12:00) don't "overlap".

// Build a tstzrange literal from two absolute instants (UTC). Inputs are Dates.
export function tstzrangeLiteral(startUtc: Date, endUtc: Date): string {
  return `[${startUtc.toISOString()},${endUtc.toISOString()})`;
}

// Build a daterange literal from two YYYY-MM-DD strings. `endDate` is the LAST
// day the event covers (inclusive in user terms); Postgres daterange is
// [start, end) exclusive, so we pass end+1day... but to keep it simple and
// explicit we accept an already-exclusive end. Callers pass the exclusive end.
export function daterangeLiteral(startDate: string, endExclusive: string): string {
  return `[${startDate},${endExclusive})`;
}

// Add N days to a YYYY-MM-DD date string (UTC-safe, no timezone drift).
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Parse a tstzrange literal back to { start, end } ISO strings (for API output).
export function parseTstzrange(literal: string): { start: string; end: string } | null {
  const m = /^[\[(]([^,]+),([^)\]]+)[)\]]$/.exec(literal);
  if (!m) return null;
  return {
    start: new Date(m[1].trim().replace(/"/g, '')).toISOString(),
    end: new Date(m[2].trim().replace(/"/g, '')).toISOString(),
  };
}

// Parse a daterange literal back to { start, end } YYYY-MM-DD (end is exclusive).
export function parseDaterange(literal: string): { start: string; endExclusive: string } | null {
  const m = /^[\[(]([^,]+),([^)\]]+)[)\]]$/.exec(literal);
  if (!m) return null;
  return { start: m[1].trim(), endExclusive: m[2].trim() };
}
