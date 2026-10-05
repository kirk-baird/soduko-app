import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, Difficulty } from '../../common';
import { makeRng } from '../../rng';
import { blankCells, geo, makeFrame } from '../board';
import {
  DIFFICULTY_INFO,
  EMPTY,
  GRASS,
  LEVELS,
  TENT,
  TentsPuzzle,
  autoGrass,
  finishable,
  findHint,
  generate,
  grade,
  isSolved,
  solve,
} from '../index';
import { RULES, applyStep, findStep, makeCtx } from '../rules';

// A small hand-checked puzzle (6×6):
//   . T . . . .      T = tree, ^ = tent in the solution
//   . ^ . . ^ .
//   . . . . T .
//   ^ T . . . .
//   . . . ^ T .
//   . . . . . .
function smallPuzzle(): TentsPuzzle {
  const cols = 6;
  const at = (r: number, c: number) => r * cols + c;
  const trees = [at(0, 1), at(2, 4), at(3, 1), at(4, 4)].sort((a, b) => a - b);
  const tents = [at(1, 1), at(1, 4), at(3, 0), at(4, 3)];
  const solution = new Array(36).fill(0);
  for (const t of tents) solution[t] = 1;
  const rowCounts = [0, 2, 0, 1, 1, 0];
  const colCounts = [1, 1, 0, 1, 1, 0];
  return { rows: 6, cols, trees, rowCounts, colCounts, solution };
}

/** Brute force that only checks adjacency (every tree has a tent beside it and vice versa) — deliberately too weak. */
function adjacencyOnlyCount(p: Omit<TentsPuzzle, 'solution'>): number {
  const g = geo(p.rows, p.cols);
  const isTree = new Set(p.trees);
  const free = Array.from({ length: g.n }, (_, i) => i).filter((i) => !isTree.has(i));
  const k = p.trees.length;
  let count = 0;
  const chosen: number[] = [];
  const rec = (start: number) => {
    if (chosen.length === k) {
      const set = new Set(chosen);
      const rows = new Array(p.rows).fill(0);
      const cols = new Array(p.cols).fill(0);
      for (const t of chosen) {
        rows[Math.floor(t / p.cols)]++;
        cols[t % p.cols]++;
      }
      if (rows.some((v, r) => v !== p.rowCounts[r]) || cols.some((v, c) => v !== p.colCounts[c])) return;
      if (chosen.some((t) => g.adj8[t].some((j) => set.has(j)))) return;
      if (p.trees.some((tr) => !g.orth[tr].some((j) => set.has(j)))) return;
      if (chosen.some((t) => !g.orth[t].some((j) => isTree.has(j)))) return;
      count++;
      return;
    }
    for (let i = start; i < free.length; i++) {
      chosen.push(free[i]);
      rec(i + 1);
      chosen.pop();
    }
  };
  rec(0);
  return count;
}

const marksFromSolution = (p: TentsPuzzle, keep: (i: number) => boolean) =>
  p.solution.map((v, i) => (p.trees.includes(i) || !keep(i) ? EMPTY : v ? TENT : GRASS));

describe('solver', () => {
  it('solves a small hand-made puzzle uniquely', () => {
    const p = smallPuzzle();
    const r = solve(p, 5);
    expect(r.count).toBe(1);
    expect(r.solution).toEqual(p.solution);
  });

  it('respects the one-to-one tree/tent pairing (not just adjacency)', () => {
    // 3×7: tree A at R2C3 with candidate tents above and below it; trees B, C at
    // R1C6 and R3C6 share the single spot R2C6. Column 3 needs 2 tents, both of
    // which can only attach to tree A. Adjacency-only counting accepts the layout
    // {R1C3, R3C3, R2C6}; with one-to-one pairing there is no solution.
    const cols = 7;
    const at = (r: number, c: number) => r * cols + c;
    const p = {
      rows: 3,
      cols,
      trees: [at(0, 5), at(1, 2), at(2, 5)].sort((a, b) => a - b),
      rowCounts: [1, 1, 1],
      colCounts: [0, 0, 2, 0, 0, 1, 0],
    };
    expect(adjacencyOnlyCount(p)).toBe(1);
    expect(solve(p, 2).count).toBe(0);
  });

  it('detects multiple solutions', () => {
    // One tree in the middle of a 3×3 with symmetric counts: a tent above or below.
    const p = { rows: 3, cols: 3, trees: [4], rowCounts: [1, 0, 0], colCounts: [0, 1, 0] };
    expect(solve(p, 2).count).toBe(1);
    const q = { rows: 3, cols: 3, trees: [3, 5], rowCounts: [1, 0, 1], colCounts: [1, 0, 1] };
    // Tents at R1C1+R3C3 or R1C3+R3C1.
    expect(solve(q, 5).count).toBe(2);
  });

  it('rejects counts that do not add up to the number of trees', () => {
    const p = smallPuzzle();
    expect(solve({ ...p, rowCounts: [1, 2, 0, 1, 1, 0] }, 2).count).toBe(0);
  });
});

const fired = new Set<string>();

/** Every placement of every rule must agree with the solution. */
function checkAllRules(p: TentsPuzzle, cells: number[], rules = RULES) {
  const f = makeFrame(p);
  for (const r of rules) {
    const st = r.find(makeCtx(f, cells.slice()));
    if (!st) continue;
    fired.add(r.id);
    expect(st.placements.length, `${r.id} returned an empty step`).toBeGreaterThan(0);
    for (const pl of st.placements) {
      expect(cells[pl.cell], `${r.id} placed on a decided cell`).toBe(0);
      const want = p.solution[pl.cell] === 1 ? TENT : GRASS;
      if (pl.digit !== want) throw new Error(`${r.id} unsound at ${pl.cell}: ${st.explanation}`);
    }
    expect(st.explanation).toMatch(/R\d+C\d+|row|column/);
  }
}

describe('rule soundness', () => {
  const rng = makeRng(99);
  const cheap = RULES.filter((r) => r.tier <= 2);
  const plan: [Difficulty, number, boolean][] = [
    ['medium', 60, true],
    ['hard', 25, true],
    ['extraHard', 10, false],
    ['extreme', 4, false],
  ];
  for (const [d, count, allRules] of plan) {
    it(`never contradicts the solution on ${count} ${d} puzzles`, () => {
      for (let n = 0; n < count; n++) {
        const p = generate(d, rng, 400)!;
        expect(p).not.toBeNull();
        const f = makeFrame(p);
        const cells = blankCells(f);
        for (let guard = 0; guard < 500 && cells.includes(0); guard++) {
          checkAllRules(p, cells, allRules ? RULES : cheap);
          const st = findStep(f, cells)!;
          expect(st).not.toBeNull();
          for (const pl of st.placements) expect(pl.digit).toBe(p.solution[pl.cell] ? TENT : GRASS);
          applyStep(cells, st);
        }
        expect(cells.includes(0)).toBe(false);
        // Off-path states, like a player who has guessed some cells correctly.
        for (let k = 0; k < 4; k++) {
          const frac = 0.15 + 0.15 * k;
          const known = p.solution.map(() => rng() < frac);
          const marks = marksFromSolution(p, (i) => known[i]);
          const st = f.isTree.map((t, i) => (t ? 3 : marks[i]));
          checkAllRules(p, st, allRules ? RULES : cheap);
        }
      }
    });
  }
});

describe('rule coverage', () => {
  it('exercised every rule during the soundness walk', () => {
    const missing = RULES.map((r) => r.id).filter((id) => !fired.has(id));
    // deepLookahead is rare; everything else must have fired.
    expect(missing.filter((id) => id !== 'deepLookahead')).toEqual([]);
  });
});

describe('findHint', () => {
  const p = smallPuzzle();
  const blank = new Array(36).fill(EMPTY);

  it('flags a misplaced tent and a tent cell marked as grass', () => {
    const m = blank.slice();
    m[0] = TENT; // R1C1 has no tent in the solution
    const h = findHint(p, m);
    expect(h.kind).toBe('wrongValue');
    if (h.kind === 'wrongValue') {
      expect(h.cells).toEqual([0]);
      expect(h.message).toContain('R1C1');
    }
    const m2 = blank.slice();
    m2[7] = GRASS; // R2C2 is a tent
    const h2 = findHint(p, m2);
    expect(h2.kind === 'wrongValue' && h2.cells).toEqual([7]);
  });

  it('gives a sound step on a fresh board and reports solved', () => {
    const h = findHint(p, blank);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.placements.length).toBeGreaterThan(0);
      expect(h.step.eliminations).toEqual([]);
      for (const pl of h.step.placements) expect(pl.digit).toBe(p.solution[pl.cell] ? TENT : GRASS);
      expect('brief' in h.step).toBe(false);
    }
    const solvedMarks = p.solution.map((v) => (v ? TENT : EMPTY));
    expect(findHint(p, solvedMarks).kind).toBe('solved');
  });

  it('a step can mark a whole row as grass', () => {
    // Row 1's count is 0, so the first hint grasses the whole row (except the tree).
    const h = findHint(p, blank);
    expect(h.kind === 'step' && h.step.technique).toBe('lineFull');
    if (h.kind === 'step') {
      expect(h.step.placements.map((x) => x.cell)).toEqual([0, 2, 3, 4, 5]);
      expect(h.step.placements.every((x) => x.digit === GRASS)).toBe(true);
      expect(h.step.explanation).toContain('row 1');
    }
  });

  it('walks a generated puzzle to the end using only hints', () => {
    const q = generate('hard', makeRng(5), 400)!;
    const m = new Array(q.rows * q.cols).fill(EMPTY);
    for (let guard = 0; guard < 400; guard++) {
      const h = findHint(q, m);
      if (h.kind === 'solved') break;
      expect(h.kind).toBe('step');
      if (h.kind !== 'step') return;
      for (const pl of h.step.placements) m[pl.cell] = pl.digit;
    }
    expect(isSolved(q, m)).toBe(true);
  });
});

describe('autoGrass', () => {
  const p = smallPuzzle();
  it('marks cells with no tree beside them', () => {
    const cells = autoGrass(p, new Array(36).fill(EMPTY));
    expect(cells).toContain(35); // R6C6: no tree beside it
    expect(cells).not.toContain(7); // R2C2 is beside a tree
    expect(cells).not.toContain(p.trees[0]);
  });
  it('marks cells touching a placed tent and rows/columns whose count is met', () => {
    const m = new Array(36).fill(EMPTY);
    m[18] = TENT; // R4C1 — column 1 needs 1 tent
    const cells = autoGrass(p, m);
    expect(cells).toContain(12); // R3C1 touches it (and column 1 is full)
    expect(cells).toContain(25); // R5C2 touches diagonally
    expect(cells).toContain(0); // R1C1, column 1 full
    expect(cells).not.toContain(18);
    expect(cells.every((i) => m[i] === EMPTY)).toBe(true);
  });
  it('never marks a solution tent when the placed tents are correct', () => {
    const q = generate('medium', makeRng(11), 400)!;
    const m = q.solution.map((v, i) => (v && i % 3 === 0 ? TENT : EMPTY));
    for (const i of autoGrass(q, m)) expect(q.solution[i]).toBe(0);
  });
});

describe('finishable and isSolved', () => {
  it('returns the missing tents when only basic steps remain', () => {
    const p = generate('medium', makeRng(3), 400)!;
    const tents = p.solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const marks = p.solution.map((v) => (v ? TENT : EMPTY));
    marks[tents[0]] = EMPTY;
    marks[tents[1]] = EMPTY;
    const out = finishable(p, marks);
    expect(out).not.toBeNull();
    expect(out!.map((x) => x.cell).sort((a, b) => a - b)).toEqual([tents[0], tents[1]].sort((a, b) => a - b));
    expect(out!.every((x) => x.digit === TENT)).toBe(true);
    expect(isSolved(p, marks)).toBe(false);
    for (const x of out!) marks[x.cell] = TENT;
    expect(isSolved(p, marks)).toBe(true);
    expect(finishable(p, marks)).toEqual([]);
  });

  it('returns null when harder reasoning is still needed', () => {
    const rng = makeRng(8);
    let checked = 0;
    for (let k = 0; k < 20 && checked < 3; k++) {
      const p = generate('extraHard', rng, 400)!;
      if (grade(p).maxTier >= 2) {
        expect(finishable(p, new Array(p.rows * p.cols).fill(EMPTY))).toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('isSolved ignores grass marks and tree cells', () => {
    const p = smallPuzzle();
    const m = p.solution.map((v) => (v ? TENT : GRASS));
    for (const t of p.trees) m[t] = TENT; // marks on trees are ignored
    expect(isSolved(p, m)).toBe(true);
  });
});

describe('generation', () => {
  for (const d of DIFFICULTY_ORDER) {
    it(`generates unique, gradeable ${d} puzzles`, () => {
      const rng = makeRng(1234);
      const level = LEVELS[d];
      for (let k = 0; k < 3; k++) {
        const t0 = Date.now();
        const p = generate(d, rng, 400);
        expect(p, `${d} generation failed`).not.toBeNull();
        if (!p) return;
        expect(Date.now() - t0).toBeLessThan(30_000);
        expect(p.rows).toBe(level.rows);
        expect(p.cols).toBe(level.cols);
        expect(p.trees.length).toBe(level.trees);
        expect(p.rowCounts.reduce((a, b) => a + b, 0)).toBe(p.trees.length);
        expect(solve(p, 2).count).toBe(1);
        const g = grade(p);
        expect(g.solved).toBe(true);
        expect(g.maxTier).toBeGreaterThanOrEqual(level.minTier);
        expect(g.maxTier).toBeLessThanOrEqual(level.maxTier);
        expect(JSON.parse(JSON.stringify(p))).toEqual(p);
      }
      expect(DIFFICULTY_INFO[d].description).toContain(`${level.rows}×${level.cols}`);
    });
  }

  it('is reproducible for a seed', () => {
    expect(generate('medium', makeRng(42))).toEqual(generate('medium', makeRng(42)));
  });

  it('places trees with no two tents touching', () => {
    const p = generate('hard', makeRng(77), 400)!;
    const g = geo(p.rows, p.cols);
    const tents = p.solution.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    for (const t of tents) for (const j of g.adj8[t]) expect(p.solution[j]).toBe(0);
    for (const t of p.trees) expect(p.solution[t]).toBe(0);
  });
});
