import { describe, it, expect } from 'vitest';
import {
  tstzrangeLiteral,
  daterangeLiteral,
  addDays,
  parseTstzrange,
  parseDaterange,
} from './ranges';

describe('tstzrange literal', () => {
  it('builds a half-open [start,end) of UTC instants', () => {
    const s = new Date('2026-06-10T09:00:00Z');
    const e = new Date('2026-06-10T10:00:00Z');
    const lit = tstzrangeLiteral(s, e);
    expect(lit).toBe('[2026-06-10T09:00:00.000Z,2026-06-10T10:00:00.000Z)');
  });

  it('round-trips through parseTstzrange', () => {
    const lit = tstzrangeLiteral(new Date('2026-06-10T09:00:00Z'), new Date('2026-06-10T10:30:00Z'));
    const parsed = parseTstzrange(lit);
    expect(parsed?.start).toBe('2026-06-10T09:00:00.000Z');
    expect(parsed?.end).toBe('2026-06-10T10:30:00.000Z');
  });
});

describe('addDays (UTC-safe, no tz drift)', () => {
  it('adds days without timezone drift', () => {
    expect(addDays('2026-06-10', 1)).toBe('2026-06-11');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('daterange literal', () => {
  it('builds a half-open [start,endExclusive)', () => {
    expect(daterangeLiteral('2026-06-10', '2026-06-11')).toBe('[2026-06-10,2026-06-11)');
  });
  it('round-trips through parseDaterange', () => {
    const parsed = parseDaterange('[2026-06-10,2026-06-12)');
    expect(parsed?.start).toBe('2026-06-10');
    expect(parsed?.endExclusive).toBe('2026-06-12');
  });
});
