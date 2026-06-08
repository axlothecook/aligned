// Unit tests for the pure friends helpers (no DB).
import { describe, it, expect } from 'vitest';
import { normalizePair, cooldownMsFor, COOLDOWN_BASE_MS } from './service';

describe('normalizePair', () => {
  it('orders the pair the same regardless of argument order', () => {
    const a = normalizePair('aaa', 'bbb');
    const b = normalizePair('bbb', 'aaa');
    expect(a).toEqual(b);
    expect(a.low < a.high).toBe(true);
  });
});

describe('cooldownMsFor', () => {
  it('is the base for a fresh (0 or 1) decline', () => {
    expect(cooldownMsFor(0)).toBe(COOLDOWN_BASE_MS);
    expect(cooldownMsFor(1)).toBe(COOLDOWN_BASE_MS);
  });
  it('escalates with the decline count', () => {
    expect(cooldownMsFor(3)).toBe(COOLDOWN_BASE_MS * 3);
    expect(cooldownMsFor(5)).toBe(COOLDOWN_BASE_MS * 5);
  });
});
