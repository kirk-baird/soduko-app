import { DIFFICULTIES, Difficulty } from './engine/logic';
import { GameType } from './games/types';
import { loadJSON, saveJSON } from './storage';

export interface LevelStats {
  completed: number;
  bestMs: number | null;
  totalMs: number;
}

export type Stats = Record<Difficulty, LevelStats>;

const empty = (): LevelStats => ({ completed: 0, bestMs: null, totalMs: 0 });
export const EMPTY_STATS = Object.fromEntries(DIFFICULTIES.map((d) => [d, empty()])) as Stats;

export const loadStats = (type: GameType) => loadJSON<Stats>(`stats.${type}`, EMPTY_STATS);

/**
 * Pure stats update. Every solve counts toward `completed`, but only a solve
 * with no hints can set a new best time.
 */
export function applyCompletion(
  stats: Stats,
  d: Difficulty,
  ms: number,
  hintsUsed: number,
): { stats: Stats; isBest: boolean } {
  const cur = stats[d] ?? empty();
  const isBest = hintsUsed === 0 && (cur.bestMs == null || ms < cur.bestMs);
  const next: Stats = {
    ...stats,
    [d]: { completed: cur.completed + 1, totalMs: cur.totalMs + ms, bestMs: isBest ? ms : cur.bestMs },
  };
  return { stats: next, isBest };
}

/** Records a completion and returns { stats, isBest }. */
export async function recordCompletion(
  type: GameType,
  d: Difficulty,
  ms: number,
  hintsUsed: number,
): Promise<{ stats: Stats; isBest: boolean }> {
  const result = applyCompletion(await loadStats(type), d, ms, hintsUsed);
  await saveJSON(`stats.${type}`, result.stats);
  return result;
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}
