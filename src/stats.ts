import { DIFFICULTIES, Difficulty } from './engine/logic';
import { loadJSON, saveJSON } from './storage';

export interface LevelStats {
  completed: number;
  bestMs: number | null;
  totalMs: number;
}

export type Stats = Record<Difficulty, LevelStats>;

const empty = (): LevelStats => ({ completed: 0, bestMs: null, totalMs: 0 });
export const EMPTY_STATS = Object.fromEntries(DIFFICULTIES.map((d) => [d, empty()])) as Stats;

export const loadStats = () => loadJSON<Stats>('stats', EMPTY_STATS);

/** Records a completion and returns { stats, isBest }. */
export async function recordCompletion(d: Difficulty, ms: number): Promise<{ stats: Stats; isBest: boolean }> {
  const stats = await loadStats();
  const cur = stats[d] ?? empty();
  const isBest = cur.bestMs == null || ms < cur.bestMs;
  const next: Stats = {
    ...stats,
    [d]: { completed: cur.completed + 1, totalMs: cur.totalMs + ms, bestMs: isBest ? ms : cur.bestMs },
  };
  await saveJSON('stats', next);
  return { stats: next, isBest };
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}
