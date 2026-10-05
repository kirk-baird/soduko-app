import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, applyCompletion } from '../stats';

describe('best times', () => {
  it('sets a best time on a hint-free solve', () => {
    const r = applyCompletion(EMPTY_STATS, 'hard', 300_000, 0);
    expect(r.isBest).toBe(true);
    expect(r.stats.hard).toEqual({ completed: 1, bestMs: 300_000, totalMs: 300_000 });
  });

  it('never sets a best time when hints were used, but still counts the solve', () => {
    const first = applyCompletion(EMPTY_STATS, 'hard', 300_000, 2);
    expect(first.isBest).toBe(false);
    expect(first.stats.hard.bestMs).toBeNull();
    expect(first.stats.hard.completed).toBe(1);

    const withBest = applyCompletion(EMPTY_STATS, 'hard', 300_000, 0).stats;
    const faster = applyCompletion(withBest, 'hard', 100_000, 1);
    expect(faster.isBest).toBe(false);
    expect(faster.stats.hard.bestMs).toBe(300_000);
    expect(faster.stats.hard.completed).toBe(2);
  });

  it('only beats the best with a faster hint-free time', () => {
    const s = applyCompletion(EMPTY_STATS, 'medium', 200_000, 0).stats;
    expect(applyCompletion(s, 'medium', 250_000, 0).isBest).toBe(false);
    expect(applyCompletion(s, 'medium', 150_000, 0).isBest).toBe(true);
  });
});
