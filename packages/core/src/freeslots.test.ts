import { describe, it, expect } from 'vitest';
import { mergeIntervals, freeWithinWindow, freeForEveryone, type Interval } from './freeslots';

// Use small integer "ms" for readability.
const iv = (start: number, end: number): Interval => ({ start, end });

describe('mergeIntervals', () => {
  it('merges overlapping + touching intervals', () => {
    expect(mergeIntervals([iv(0, 5), iv(4, 8), iv(8, 10)])).toEqual([iv(0, 10)]);
  });
  it('keeps disjoint intervals separate + sorted', () => {
    expect(mergeIntervals([iv(10, 12), iv(0, 2)])).toEqual([iv(0, 2), iv(10, 12)]);
  });
  it('handles empty input', () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe('freeWithinWindow', () => {
  it('returns the whole window when nobody is busy', () => {
    expect(freeWithinWindow(iv(0, 100), [])).toEqual([iv(0, 100)]);
  });
  it('returns gaps between busy blocks', () => {
    // busy 10-20 and 30-40 → free 0-10, 20-30, 40-100
    expect(freeWithinWindow(iv(0, 100), [iv(10, 20), iv(30, 40)])).toEqual([
      iv(0, 10),
      iv(20, 30),
      iv(40, 100),
    ]);
  });
  it('returns nothing when busy covers the whole window', () => {
    expect(freeWithinWindow(iv(0, 100), [iv(-10, 200)])).toEqual([]);
  });
  it('clips busy intervals to the window', () => {
    expect(freeWithinWindow(iv(50, 100), [iv(0, 60)])).toEqual([iv(60, 100)]);
  });
});

describe('freeForEveryone', () => {
  it('only counts time free for ALL members (union of busy)', () => {
    // A busy 10-30, B busy 20-40 → union busy 10-40 → free 0-10, 40-100
    const free = freeForEveryone(iv(0, 100), [[iv(10, 30)], [iv(20, 40)]]);
    expect(free).toEqual([iv(0, 10), iv(40, 100)]);
  });
  it('a slot one person has free but another is busy is NOT free-for-all', () => {
    // A free all window, B busy 0-100 → nothing free for everyone
    const free = freeForEveryone(iv(0, 100), [[], [iv(0, 100)]]);
    expect(free).toEqual([]);
  });
  it('all members free → whole window green', () => {
    expect(freeForEveryone(iv(0, 100), [[], [], []])).toEqual([iv(0, 100)]);
  });
});
