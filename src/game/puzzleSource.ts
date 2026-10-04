// Where new puzzles come from: the bundled bank first (instant), then
// on-device generation once a difficulty's bank has been played through.

import bank from '../data/puzzleBank.json';
import { generateMinimal } from '../engine/generator';
import { Grid } from '../engine/grid';
import { DIFFICULTY_TIER, Difficulty, grade } from '../engine/logic';
import { makeRng } from '../engine/rng';
import { solve } from '../engine/solver';
import { loadJSON, saveJSON } from '../storage';

const BANK = bank as Record<Difficulty, string[]>;

type PlayedMap = Record<Difficulty, number[]>;
const EMPTY_PLAYED: PlayedMap = { medium: [], hard: [], extraHard: [], extreme: [] };

export interface PuzzleChoice {
  id: string;
  givens: Grid;
  solution: Grid;
}

const parse = (s: string): Grid => [...s].map(Number);

/** Yield to the UI thread between generation attempts. */
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function nextPuzzle(difficulty: Difficulty, onProgress?: (attempts: number) => void): Promise<PuzzleChoice> {
  const played = await loadJSON<PlayedMap>('played', EMPTY_PLAYED);
  const used = new Set(played[difficulty] ?? []);
  const list = BANK[difficulty];
  const unplayed = list.map((_, i) => i).filter((i) => !used.has(i));

  if (unplayed.length) {
    const idx = unplayed[Math.floor(Math.random() * unplayed.length)];
    await saveJSON('played', { ...played, [difficulty]: [...used, idx] });
    const givens = parse(list[idx]);
    return { id: `bank-${difficulty}-${idx}`, givens, solution: solve(givens).solution! };
  }

  // Bank exhausted: generate on the device.
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  const rng = makeRng(seed);
  const tier = DIFFICULTY_TIER[difficulty];
  for (let attempts = 1; ; attempts++) {
    const p = generateMinimal(rng);
    const g = grade(p.puzzle);
    if (g.solved && g.maxTier === tier) return { id: `gen-${seed}-${attempts}`, givens: p.puzzle, solution: p.solution };
    if (attempts % 3 === 0) {
      onProgress?.(attempts);
      await nextTick();
    }
  }
}

export const bankSize = (d: Difficulty) => BANK[d].length;
