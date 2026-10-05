// Tents (Tents and Trees) puzzle engine: generation, solving, grading and hints.
//
// Board: rows×cols cells indexed r*cols+c. Some cells hold trees. The player
// places tents so that trees and tents pair up one-to-one along orthogonal
// adjacency, no two tents touch (even diagonally), and each row/column holds
// the number of tents given beside it.
//
// Player marks: marks[i] = 0 unknown, 1 tent, 2 grass (ignored on tree cells).

import { CellDigit, Difficulty, DifficultyInfo, PuzzleHint } from '../common';
import { Rng, shuffle } from '../rng';
import { GRASS as G_GRASS, TENT as G_TENT, UNK, Frame, blankCells, cellName, cellsFromMarks, geo, listNames, makeFrame } from './board';
import { RULES, TIER0, TStep, applyStep, contradiction, findStep, makeCtx, stripBrief } from './rules';
import { solveShape } from './solver';

export const EMPTY = 0;
export const TENT = 1;
export const GRASS = 2;

export interface TentsPuzzle {
  rows: number;
  cols: number;
  trees: number[]; // tree cell indices, ascending
  rowCounts: number[];
  colCounts: number[];
  solution: number[]; // 1 = tent, 0 = no tent (trees are 0)
}

interface Level {
  rows: number;
  cols: number;
  trees: number;
  minTier: number;
  maxTier: number;
}

export const LEVELS: Record<Difficulty, Level> = {
  medium: { rows: 8, cols: 8, trees: 12, minTier: 0, maxTier: 1 },
  hard: { rows: 10, cols: 10, trees: 19, minTier: 1, maxTier: 2 },
  extraHard: { rows: 12, cols: 12, trees: 26, minTier: 2, maxTier: 3 },
  extreme: { rows: 15, cols: 15, trees: 40, minTier: 3, maxTier: 4 },
};

export const DIFFICULTY_INFO: Record<Difficulty, DifficultyInfo> = {
  medium: { label: 'Medium', description: `8×8 grid, about ${LEVELS.medium.trees} trees` },
  hard: { label: 'Hard', description: `10×10 grid, about ${LEVELS.hard.trees} trees` },
  extraHard: { label: 'Extra Hard', description: `12×12 grid, about ${LEVELS.extraHard.trees} trees` },
  extreme: { label: 'Extreme', description: `15×15 grid, about ${LEVELS.extreme.trees} trees` },
};

// ---------- solving ----------

/** Counts solutions (distinct tent layouts) up to `limit`, respecting the one-to-one tree/tent pairing. */
export function solve(p: Omit<TentsPuzzle, 'solution'>, limit = 2): { count: number; solution: number[] | null } {
  return solveShape(p, limit);
}

/** Runs the logical rules (up to maxTier) from `cells`; mutates `cells`. */
function logicSolve(f: Frame, cells: number[], maxTier = 4, onStep?: (st: TStep) => void): boolean {
  for (let guard = 0; guard < f.g.n * 2; guard++) {
    if (!cells.includes(UNK)) return true;
    const st = findStep(f, cells, maxTier);
    if (!st) return false;
    applyStep(cells, st);
    onStep?.(st);
  }
  return !cells.includes(UNK);
}

export function grade(p: TentsPuzzle): { solved: boolean; maxTier: number; steps: number; counts: Record<string, number> } {
  const f = makeFrame(p);
  const cells = blankCells(f);
  const counts: Record<string, number> = {};
  let maxTier = 0;
  let steps = 0;
  const solved = logicSolve(f, cells, 4, (st) => {
    steps++;
    maxTier = Math.max(maxTier, st.tier);
    counts[st.technique] = (counts[st.technique] ?? 0) + 1;
  });
  return { solved, maxTier, steps, counts };
}

// ---------- generation ----------

/** Random tent layout with no two tents touching, then one tree per tent. */
function randomLayout(level: Level, rng: Rng): { trees: number[]; tents: number[] } | null {
  const { rows, cols, trees: k } = level;
  const g = geo(rows, cols);
  const blocked = new Array<boolean>(g.n).fill(false);
  const tents: number[] = [];
  for (const i of shuffle(Array.from({ length: g.n }, (_, i) => i), rng)) {
    if (blocked[i]) continue;
    tents.push(i);
    blocked[i] = true;
    for (const j of g.adj8[i]) blocked[j] = true;
    if (tents.length === k) break;
  }
  if (tents.length < k) return null;
  const isTent = new Array<boolean>(g.n).fill(false);
  for (const t of tents) isTent[t] = true;
  const isTree = new Array<boolean>(g.n).fill(false);
  const trees: number[] = [];
  for (const t of shuffle(tents.slice(), rng)) {
    const free = g.orth[t].filter((j) => !isTent[j] && !isTree[j]);
    if (!free.length) return null;
    const tr = free[Math.floor(rng() * free.length)];
    isTree[tr] = true;
    trees.push(tr);
  }
  return { trees: trees.sort((a, b) => a - b), tents };
}

function puzzleFrom(rows: number, cols: number, trees: number[], tents: number[]): TentsPuzzle {
  const solution = new Array<number>(rows * cols).fill(0);
  for (const t of tents) solution[t] = 1;
  const rowCounts = new Array<number>(rows).fill(0);
  const colCounts = new Array<number>(cols).fill(0);
  for (const t of tents) {
    rowCounts[Math.floor(t / cols)]++;
    colCounts[t % cols]++;
  }
  return { rows, cols, trees, rowCounts, colCounts, solution };
}

/**
 * Generates a unique puzzle whose logical solve needs rules within the
 * difficulty's tier range. Returns null if none was found in `maxAttempts`
 * random layouts (each attempt is bounded: one uniqueness check plus one grade).
 */
export function generate(difficulty: Difficulty, rng: Rng, maxAttempts = 200): TentsPuzzle | null {
  const level = LEVELS[difficulty];
  for (let a = 0; a < maxAttempts; a++) {
    const lay = randomLayout(level, rng);
    if (!lay) continue;
    const p = puzzleFrom(level.rows, level.cols, lay.trees, lay.tents);
    if (solve(p, 2).count !== 1) continue;
    const gr = grade(p);
    if (!gr.solved || gr.maxTier < level.minTier || gr.maxTier > level.maxTier) continue;
    return p;
  }
  return null;
}

// ---------- player support ----------

export function isSolved(p: TentsPuzzle, marks: number[]): boolean {
  const isTree = new Set(p.trees);
  for (let i = 0; i < p.rows * p.cols; i++) {
    if (isTree.has(i)) continue;
    if ((marks[i] === TENT) !== (p.solution[i] === 1)) return false;
  }
  return true;
}

/**
 * Undecided cells that are trivially grass: no tree beside them (orthogonally),
 * touching a placed tent (including diagonally), or in a row/column whose tent
 * count is already reached.
 */
export function autoGrass(p: TentsPuzzle, marks: number[]): number[] {
  const f = makeFrame(p);
  const { g } = f;
  const cells = cellsFromMarks(f, marks);
  const rowT = new Array<number>(p.rows).fill(0);
  const colT = new Array<number>(p.cols).fill(0);
  for (let i = 0; i < g.n; i++) {
    if (cells[i] === G_TENT) {
      rowT[Math.floor(i / p.cols)]++;
      colT[i % p.cols]++;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < g.n; i++) {
    if (cells[i] !== UNK) continue;
    const r = Math.floor(i / p.cols);
    const c = i % p.cols;
    if (
      f.treeNbrs[i].length === 0 ||
      g.adj8[i].some((j) => cells[j] === G_TENT) ||
      rowT[r] >= p.rowCounts[r] ||
      colT[c] >= p.colCounts[c]
    )
      out.push(i);
  }
  return out;
}

export function findHint(p: TentsPuzzle, marks: number[]): PuzzleHint {
  const f = makeFrame(p);
  const cols = p.cols;
  const cells = cellsFromMarks(f, marks);
  const badTent: number[] = [];
  const badGrass: number[] = [];
  for (let i = 0; i < f.g.n; i++) {
    if (cells[i] === G_TENT && p.solution[i] !== 1) badTent.push(i);
    if (cells[i] === G_GRASS && p.solution[i] === 1) badGrass.push(i);
  }
  if (badTent.length || badGrass.length) {
    const parts: string[] = [];
    if (badTent.length) parts.push(`${listNames(badTent, cols)} ${badTent.length === 1 ? "shouldn't have a tent" : "shouldn't have tents"}`);
    if (badGrass.length) parts.push(`${listNames(badGrass, cols)} ${badGrass.length === 1 ? 'is marked as grass but needs a tent' : 'are marked as grass but need tents'}`);
    return {
      kind: 'wrongValue',
      cells: [...badTent, ...badGrass].sort((a, b) => a - b),
      message: `${parts.join(', and ')}. Fix ${badTent.length + badGrass.length === 1 ? 'that' : 'those'} first — logic built on a mistake will go astray.`,
    };
  }
  if (isSolved(p, marks)) return { kind: 'solved', message: 'The puzzle is solved!' };
  const st = findStep(f, cells);
  if (st) return { kind: 'step', step: stripBrief(st) };
  // Beyond the rules' reach (shouldn't happen for generated puzzles): reveal a tent.
  let cell = -1;
  for (let i = 0; i < f.g.n; i++) if (cells[i] === UNK && p.solution[i] === 1) { cell = i; break; }
  if (cell < 0) cell = cells.indexOf(UNK);
  const digit = p.solution[cell] === 1 ? TENT : GRASS;
  return {
    kind: 'reveal',
    cell,
    digit,
    message: `No logical step found with the rules I know. ${cellName(cell, cols)} is ${digit === TENT ? 'a tent' : 'grass'}.`,
  };
}

/**
 * If the rest of the puzzle follows from the basic (tier-0) rules alone, the
 * tents still to place, in deduction order; otherwise null. Uses the player's
 * tents (assumed correct) and ignores their grass marks.
 */
export function finishable(p: TentsPuzzle, marks: number[]): CellDigit[] | null {
  const f = makeFrame(p);
  const cells = f.isTree.map((t, i) => (t ? 3 : marks[i] === TENT ? G_TENT : UNK));
  const out: CellDigit[] = [];
  for (let guard = 0; guard < f.g.n * 2 && cells.includes(UNK); guard++) {
    if (contradiction(makeCtx(f, cells), false)) return null;
    let st: TStep | null = null;
    const ctx = makeCtx(f, cells);
    for (const r of TIER0) if ((st = r.find(ctx))) break;
    if (!st) return null;
    applyStep(cells, st);
    for (const pl of st.placements) if (pl.digit === TENT) out.push({ cell: pl.cell, digit: TENT });
  }
  if (cells.includes(UNK)) return null;
  for (let i = 0; i < f.g.n; i++) if ((cells[i] === G_TENT) !== (p.solution[i] === 1)) return null;
  return out;
}

/** Ids, names and tiers of every rule (for docs / settings screens). */
export const TECHNIQUES = RULES.map(({ id, name, tier }) => ({ id, name, tier }));
