import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, bit, popcount } from '../../common';
import { makeRng } from '../../rng';
import { LEVELS, makeUnique } from '../generator';
import { DIFFICULTY_INFO, KakuroPuzzle, clues, combinations, findHint, generate, grade, rulesFor, singlesFinish, solve } from '../index';
import { applyStep, initialState } from '../logic';
import { State, TECHNIQUES, findStep } from '../techniques';
import { ctxOf, layoutRuns } from '../types';

/** 3×3 grid, interior 2×2: [1 3 / 2 4]. */
function tiny(): KakuroPuzzle {
  const white = [false, false, false, false, true, true, false, true, true];
  const solution = [0, 0, 0, 0, 1, 3, 0, 2, 4];
  const runs = layoutRuns(3, 3, white).map((r) => ({ ...r, sum: r.cells.reduce((s, c) => s + solution[c], 0) }));
  return { rows: 3, cols: 3, white, runs, solution };
}

describe('combinations', () => {
  it('lists unique and multiple digit sets', () => {
    expect(combinations(3, 2)).toEqual([[1, 2]]);
    expect(combinations(16, 2)).toEqual([[7, 9]]);
    expect(combinations(45, 9)).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(combinations(10, 4)).toEqual([[1, 2, 3, 4]]);
    expect(combinations(10, 2)).toEqual([
      [1, 9],
      [2, 8],
      [3, 7],
      [4, 6],
    ]);
    expect(combinations(2, 2)).toEqual([]);
    expect(combinations(10, 2)).toBe(combinations(10, 2)); // cached
  });
});

describe('solver', () => {
  it('solves a tiny unique puzzle', () => {
    const p = tiny();
    const r = solve(p, 2);
    expect(r.count).toBe(1);
    expect(r.solution).toEqual(p.solution);
  });

  it('detects multiple solutions', () => {
    const p = tiny();
    const runs = p.runs.map((r) => ({ ...r, sum: 10 }));
    expect(solve({ ...p, runs }, 2).count).toBe(2);
  });

  it('detects no solution', () => {
    const p = tiny();
    const runs = p.runs.map((r, i) => ({ ...r, sum: i === 0 ? 2 : r.sum }));
    expect(solve({ ...p, runs }, 2).count).toBe(0);
  });
});

describe('clues and rules', () => {
  it('maps clue cells to across/down sums', () => {
    const p = tiny();
    const m = clues(p);
    expect(m.get(1)).toEqual({ down: 3 });
    expect(m.get(3)).toEqual({ across: 4 });
    expect(m.get(2)).toEqual({ down: 7 });
    expect(m.get(6)).toEqual({ across: 6 });
    expect(m.has(0)).toBe(false);
  });

  it('computes peers and legal candidates', () => {
    const p = tiny();
    const rules = rulesFor(p);
    expect(rules.maxDigit).toBe(9);
    expect(rules.playable).toEqual(p.white);
    expect(rules.peers[4]).toEqual([5, 7]);
    const empty = new Array(9).fill(0);
    const legal = rules.legalCandidates(empty);
    // R2C2: across 4 in 2 = {1,3}; down 3 in 2 = {1,2} → {1}
    expect(legal[4]).toBe(bit(1));
    // R2C3: across {1,3}; down 7 in 2 = {1..6} minus... {1,6},{2,5},{3,4} → {1,3}
    expect(legal[5]).toBe(bit(1) | bit(3));
    expect(legal[0]).toBe(0);
    // Placing 3 at R2C2 (wrong, but legal-candidate logic only looks at placed digits):
    const v = empty.slice();
    v[4] = 3;
    const l2 = rules.legalCandidates(v);
    expect(l2[4]).toBe(0);
    expect(l2[5]).toBe(bit(1)); // across now needs exactly 1 more
  });

  it('excludes digits already used in a run and impossible completions', () => {
    const p = generate('medium', makeRng(3))!;
    const ctx = ctxOf(p);
    const rules = rulesFor(p);
    const v = new Array(p.rows * p.cols).fill(0);
    const run = p.runs.find((r) => r.cells.length >= 3)!;
    v[run.cells[0]] = p.solution[run.cells[0]];
    const legal = rules.legalCandidates(v);
    for (const c of run.cells.slice(1)) expect(legal[c] & bit(v[run.cells[0]])).toBe(0);
    // every solution digit is still legal
    for (const c of ctx.whiteCells) if (!v[c]) expect(legal[c] & bit(p.solution[c])).not.toBe(0);
  });
});

describe('technique soundness', () => {
  const fired = new Set<string>();
  it('never contradicts the solution on generated puzzles', () => {
    const rng = makeRng(2024);
    const plan: [keyof typeof LEVELS, number][] = [
      ['medium', 40],
      ['hard', 30],
      ['extraHard', 20],
      ['extreme', 15],
    ];
    for (const [lvl, count] of plan) {
      let made = 0;
      while (made < count) {
        const r = makeUnique(LEVELS[lvl], rng);
        if (!r) continue;
        made++;
        const p = r.puzzle;
        const ctx = ctxOf(p);
        let s: State = initialState(ctx);
        for (let guard = 0; guard < 500; guard++) {
          if (ctx.whiteCells.every((c) => s.values[c])) break;
          for (const t of TECHNIQUES) {
            const st = t.find(ctx, s);
            if (!st) continue;
            fired.add(t.id);
            for (const pl of st.placements) {
              if (p.solution[pl.cell] !== pl.digit) {
                throw new Error(`${t.id} placed ${pl.digit} at ${pl.cell} (solution ${p.solution[pl.cell]})\n${st.explanation}`);
              }
            }
            for (const e of st.eliminations) {
              if (p.solution[e.cell] === e.digit) {
                throw new Error(`${t.id} eliminated the solution ${e.digit} at ${e.cell}\n${st.explanation}`);
              }
              if (!(s.cands[e.cell] & bit(e.digit))) throw new Error(`${t.id} eliminated a non-candidate`);
            }
            expect(st.placements.length + st.eliminations.length).toBeGreaterThan(0);
            expect(st.explanation.length).toBeGreaterThan(20);
            expect(st.tier).toBe(t.tier);
          }
          const st = findStep(ctx, s);
          if (!st) break;
          s = applyStep(ctx, s, st);
        }
      }
    }
  });

  it('exercises every technique', () => {
    expect(TECHNIQUES.map((t) => t.id).filter((id) => !fired.has(id))).toEqual([]);
  });
});

function checkLayout(p: KakuroPuzzle) {
  const { rows, cols, white } = p;
  for (let c = 0; c < cols; c++) expect(white[c]).toBe(false);
  for (let r = 0; r < rows; r++) expect(white[r * cols]).toBe(false);
  for (let r = 1; r < rows; r++)
    for (let c = 1; c < cols; c++) expect(white[r * cols + c]).toBe(white[(rows - r) * cols + (cols - c)]);
  const ctx = ctxOf(p);
  for (const c of ctx.whiteCells) {
    expect(ctx.cellRuns[c].length).toBe(2);
    expect(p.solution[c]).toBeGreaterThanOrEqual(1);
    expect(p.solution[c]).toBeLessThanOrEqual(9);
  }
  for (const run of p.runs) {
    expect(run.cells.length).toBeGreaterThanOrEqual(2);
    expect(run.cells.length).toBeLessThanOrEqual(9);
    expect(white[run.clueCell]).toBe(false);
    const ds = run.cells.map((c) => p.solution[c]);
    expect(new Set(ds).size).toBe(ds.length);
    expect(ds.reduce((a, b) => a + b, 0)).toBe(run.sum);
  }
  expect(p.solution.every((v, i) => (white[i] ? v > 0 : v === 0))).toBe(true);
  expect(JSON.parse(JSON.stringify(p))).toEqual(p);
}

describe('generation', () => {
  it('generates a unique, gradeable puzzle for every difficulty', () => {
    const rng = makeRng(77);
    for (const d of DIFFICULTY_ORDER) {
      const cfg = LEVELS[d];
      for (let i = 0; i < 3; i++) {
        const p = generate(d, rng);
        expect(p, d).not.toBeNull();
        expect(p!.rows).toBe(cfg.rows);
        expect(p!.cols).toBe(cfg.cols);
        checkLayout(p!);
        expect(solve(p!, 2).count).toBe(1);
        const g = grade(p!);
        expect(g.solved).toBe(true);
        expect(g.maxTier).toBeGreaterThanOrEqual(cfg.minTier);
        expect(g.maxTier).toBeLessThanOrEqual(cfg.maxTier);
      }
      expect(DIFFICULTY_INFO[d].label.length).toBeGreaterThan(0);
    }
  });
});

describe('singlesFinish', () => {
  const rng = makeRng(5);
  const pool: KakuroPuzzle[] = [];
  while (pool.length < 40) {
    const r = makeUnique(LEVELS.medium, rng);
    if (r) pool.push(r.puzzle);
  }

  it('finishes a singles-only puzzle and a nearly finished one', () => {
    const easy = pool.find((p) => grade(p).maxTier === 0)!;
    expect(easy).toBeDefined();
    const empty = new Array(easy.rows * easy.cols).fill(0);
    const pl = singlesFinish(easy, empty);
    expect(pl).not.toBeNull();
    const v = empty.slice();
    for (const x of pl!) v[x.cell] = x.digit;
    expect(v).toEqual(easy.solution);

    const hard = pool.find((p) => grade(p).maxTier >= 2)!;
    const almost = hard.solution.slice();
    const c = hard.runs[0].cells[0];
    almost[c] = 0;
    expect(singlesFinish(hard, almost)).toEqual([{ cell: c, digit: hard.solution[c] }]);
  });

  it('returns null when more than singles are needed', () => {
    const hard = pool.find((p) => grade(p).maxTier >= 2)!;
    expect(singlesFinish(hard, new Array(hard.rows * hard.cols).fill(0))).toBeNull();
  });
});

describe('hints', () => {
  const p = generate('hard', makeRng(9))!;
  const ctx = ctxOf(p);
  const n = p.rows * p.cols;
  const empty = new Array(n).fill(0);
  const cellA = ctx.whiteCells[0];

  it('reports solved', () => {
    expect(findHint(p, p.solution, empty).kind).toBe('solved');
  });

  it('flags wrong placed digits first', () => {
    const v = empty.slice();
    v[cellA] = (p.solution[cellA] % 9) + 1;
    const h = findHint(p, v, empty);
    expect(h.kind).toBe('wrongValue');
    if (h.kind === 'wrongValue') expect(h.cells).toEqual([cellA]);
  });

  it('flags pencil marks where the correct digit was removed', () => {
    const pencil = empty.slice();
    pencil[cellA] = 0x3fe & ~bit(p.solution[cellA]);
    const h = findHint(p, empty, pencil, [cellA]);
    expect(h.kind).toBe('missingCandidate');
    if (h.kind === 'missingCandidate') expect(h.cells).toEqual([cellA]);
  });

  it('treats incomplete (never-removed) pencil marks as unmarked', () => {
    const pencil = empty.slice();
    pencil[cellA] = 0x3fe & ~bit(p.solution[cellA]);
    const h = findHint(p, empty, pencil);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      for (const e of h.step.eliminations) expect(p.solution[e.cell]).not.toBe(e.digit);
      for (const pl of h.step.placements) expect(p.solution[pl.cell]).toBe(pl.digit);
      expect(h.cands![cellA] & bit(p.solution[cellA])).not.toBe(0);
    }
  });

  it('suggests clean-up of pencil marks clashing with a placed digit', () => {
    const run = p.runs[0];
    const [a, b] = run.cells;
    const v = empty.slice();
    v[a] = p.solution[a];
    const pencil = empty.slice();
    pencil[b] = bit(p.solution[a]) | bit(p.solution[b]);
    const h = findHint(p, v, pencil);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.technique).toBe('cleanup');
      expect(h.step.eliminations).toEqual([{ cell: b, digit: p.solution[a] }]);
    }
  });

  it('gives a sound technique step with no pencil marks', () => {
    const h = findHint(p, empty, empty);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.placements.length + h.step.eliminations.length).toBeGreaterThan(0);
      expect(h.step.explanation).toMatch(/R\d+C\d+/);
    }
  });

  it('uses the player candidates: a naked single from pencil marks', () => {
    // Fill pencil marks with legal candidates, but reduce one cell to its solution digit.
    const legal = rulesFor(p).legalCandidates(empty);
    const target = ctx.whiteCells.find((c) => popcount(legal[c]) > 2)!;
    const pencil = legal.slice();
    pencil[target] = bit(p.solution[target]);
    const h = findHint(p, empty, pencil);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') for (const pl of h.step.placements) expect(p.solution[pl.cell]).toBe(pl.digit);
  });

  it('can walk a whole puzzle by hints alone', () => {
    let v = empty.slice();
    let pencil = empty.slice();
    for (let guard = 0; guard < 2000; guard++) {
      const h = findHint(p, v, pencil);
      if (h.kind === 'solved') return;
      expect(h.kind).toBe('step');
      if (h.kind !== 'step') return;
      pencil = h.cands!.slice();
      const s = applyStep(ctx, { values: v, cands: pencil }, h.step);
      v = s.values;
      pencil = s.cands;
    }
    throw new Error('did not finish');
  });
});

describe('bank', () => {
  it('holds valid, unique, correctly graded puzzles for every difficulty', async () => {
    const bank = (await import('../../../data/kakuroBank.json')).default as unknown as Record<string, KakuroPuzzle[]>;
    for (const d of DIFFICULTY_ORDER) {
      const list = bank[d];
      expect(list.length, d).toBe(60);
      const cfg = LEVELS[d];
      for (const p of list) {
        expect(p.rows).toBe(cfg.rows);
        checkLayout(p);
        expect(solve(p, 2).count).toBe(1);
        const g = grade(p);
        expect(g.solved).toBe(true);
        expect(g.maxTier).toBeGreaterThanOrEqual(cfg.minTier);
        expect(g.maxTier).toBeLessThanOrEqual(cfg.maxTier);
      }
    }
  });
});
