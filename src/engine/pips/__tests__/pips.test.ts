import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, Difficulty } from '../../common';
import { makeRng } from '../../rng';
import {
  DIFFICULTY_INFO,
  LEVELS,
  PipsPuzzle,
  Placement,
  Spot,
  findHint,
  finishable,
  generate,
  grade,
  hintMove,
  isSolved,
  regionStatus,
  cellValues,
  solve,
  wrongDominoes,
} from '../index';
import { makeFrame, placeFor, regionLabel, regionOk } from '../model';
import { RULES, State, applyStep, emptyState, findStep, makeCtx, putDown } from '../rules';

// A small hand-checked puzzle on a 2×4 board:
//   R1: 6 6 | 1 2      dominoes 6|6 (R1C1–R1C2), 1|2 (R1C3–R1C4),
//   R2: 0 3 | 4 5      0|3 (R2C1–R2C2), 4|5 (R2C3–R2C4)
// Regions: R1C1–R1C2 sum 12; R2C1 = 0; R1C3 < 2; R2C3–R2C4 sum 9; R1C4, R2C2 blank.
function smallPuzzle(): PipsPuzzle {
  return {
    rows: 2,
    cols: 4,
    cells: [0, 1, 2, 3, 4, 5, 6, 7],
    regions: [
      { cells: [0, 1], kind: 'sum', target: 12 },
      { cells: [2], kind: 'less', target: 2 },
      { cells: [4], kind: 'sum', target: 0 },
      { cells: [6, 7], kind: 'sum', target: 9 },
    ],
    dominoes: [
      [0, 3],
      [1, 2],
      [4, 5],
      [6, 6],
    ],
    solution: [
      [4, 5],
      [2, 3],
      [6, 7],
      [0, 1],
    ],
  };
}

const empty = (p: PipsPuzzle): Placement => p.dominoes.map(() => null);

describe('region arithmetic', () => {
  const b = (...vs: number[]) => vs.reduce((m, v) => m | (1 << v), 0);
  it('checks each rule against value masks', () => {
    expect(regionOk('sum', 12, [b(6), b(5, 6)])).toBe(true);
    expect(regionOk('sum', 12, [b(5), b(5, 6)])).toBe(false);
    expect(regionOk('less', 3, [b(1, 4), b(1)])).toBe(true);
    expect(regionOk('less', 2, [b(1, 4), b(1)])).toBe(false);
    expect(regionOk('greater', 10, [b(5), b(6)])).toBe(true);
    expect(regionOk('greater', 11, [b(5), b(6)])).toBe(false);
    expect(regionOk('equal', 0, [b(2, 3), b(3, 4)])).toBe(true);
    expect(regionOk('equal', 0, [b(2), b(3, 4)])).toBe(false);
    expect(regionOk('unequal', 0, [b(1, 2), b(1, 2), b(1, 2, 3)])).toBe(true);
    expect(regionOk('unequal', 0, [b(1, 2), b(1, 2), b(1, 2)])).toBe(false);
  });
  it('labels regions the way the board shows them', () => {
    expect(regionLabel({ kind: 'sum', target: 7 })).toBe('7');
    expect(regionLabel({ kind: 'less', target: 3 })).toBe('<3');
    expect(regionLabel({ kind: 'greater', target: 9 })).toBe('>9');
    expect(regionLabel({ kind: 'equal' })).toBe('=');
    expect(regionLabel({ kind: 'unequal' })).toBe('≠');
  });
});

describe('solver', () => {
  it('solves a small hand-made puzzle uniquely', () => {
    const p = smallPuzzle();
    const r = solve(p, 5);
    expect(r.count).toBe(1);
    expect(isSolved(p, r.solution!)).toBe(true);
    expect(wrongDominoes(p, r.solution!)).toEqual([]);
  });

  it('counts a flip inside one region as the same solution', () => {
    // The 4|5 sits wholly in the "sum 9" region, so 5|4 is just as good.
    const p = smallPuzzle();
    const flipped = p.solution.map((s) => s.slice() as Spot);
    flipped[2] = [7, 6];
    expect(isSolved(p, flipped)).toBe(true);
    expect(wrongDominoes(p, flipped)).toEqual([]);
    expect(solve(p, 5).count).toBe(1);
  });

  it('detects multiple solutions and none', () => {
    const p = smallPuzzle();
    // With R1C3 < 3 instead of < 2, 1|2 and 2|1 both work there.
    const loose = { ...p, regions: p.regions.map((r) => (r.kind === 'less' ? { ...r, target: 3 } : r)) };
    expect(solve(loose, 5).count).toBe(2);
    const broken = { ...p, regions: [...p.regions.slice(0, 3), { cells: [6, 7], kind: 'sum' as const, target: 13 }] };
    expect(solve(broken, 5).count).toBe(0);
  });
});

const fired = new Set<string>();

/** Every placement and elimination of every rule must agree with the solution. */
function checkAllRules(p: PipsPuzzle, s: State, rules = RULES) {
  const f = makeFrame(p);
  const truth = new Set(p.solution.map((spot, k) => placeFor(f, k, spot)));
  for (const r of rules) {
    const st = r.find(makeCtx(f, s));
    if (!st) continue;
    fired.add(r.id);
    expect(st.kills.length + (st.place >= 0 ? 1 : 0), `${r.id} returned an empty step`).toBeGreaterThan(0);
    for (const q of st.kills) {
      if (truth.has(q)) throw new Error(`${r.id} ruled out a solution placement: ${st.explanation}`);
      expect(s.alive[q], `${r.id} killed a dead placement`).toBe(1);
    }
    if (st.place >= 0 && !truth.has(st.place)) throw new Error(`${r.id} placed a wrong domino: ${st.explanation}`);
    expect(st.explanation).toMatch(/R\d+C\d+|\d\|\d/);
  }
}

describe('rule soundness', () => {
  const rng = makeRng(99);
  const cheap = RULES.filter((r) => r.tier <= 2);
  const plan: [Difficulty, number, boolean][] = [
    ['medium', 40, true],
    ['hard', 25, true],
    ['extraHard', 10, true],
    ['extreme', 3, false],
  ];
  for (const [d, count, allRules] of plan) {
    it(`never contradicts the solution on ${count} ${d} puzzles`, () => {
      for (let n = 0; n < count; n++) {
        const p = generate(d, rng)!;
        expect(p).not.toBeNull();
        const f = makeFrame(p);
        const s = emptyState(f);
        for (let guard = 0; guard < 2000 && !s.domAt.every((x) => x >= 0); guard++) {
          checkAllRules(p, s, allRules ? RULES : cheap);
          const st = findStep(f, s)!;
          expect(st).not.toBeNull();
          applyStep(f, s, st);
        }
        expect(isSolved(p, p.dominoes.map((_, k) => p.solution[k]))).toBe(true);
        // Off-path states, like a player who has put some dominoes down correctly.
        for (let k = 0; k < 3; k++) {
          const t = emptyState(f);
          p.solution.forEach((spot, i) => rng() < 0.2 + 0.2 * k && putDown(f, t, placeFor(f, i, spot)));
          checkAllRules(p, t, allRules ? RULES : cheap);
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

  it('flags a misplaced domino', () => {
    const m = empty(p);
    m[3] = [4, 5]; // 6|6 on R2C1–R2C2
    const h = findHint(p, m);
    expect(h.kind).toBe('wrongValue');
    if (h.kind === 'wrongValue') {
      expect(h.cells).toEqual([4, 5]);
      expect(h.message).toContain('6|6');
    }
  });

  it('gives a sound placement on a fresh board and reports solved', () => {
    const h = findHint(p, empty(p));
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.placements.length).toBe(2);
      const mv = hintMove(p, h.step)!;
      expect(mv).not.toBeNull();
      expect(wrongDominoes(p, p.dominoes.map((_, k) => (k === mv.k ? mv.spot : null)))).toEqual([]);
      expect(h.step.explanation.length).toBeGreaterThan(10);
    }
    expect(findHint(p, p.solution).kind).toBe('solved');
  });

  it('a 12 over two cells gives the 6|6 straight away', () => {
    const h = findHint(p, empty(p));
    expect(h.kind === 'step' && h.step.placements.map((x) => x.digit)).toEqual([6, 6]);
    if (h.kind === 'step') expect(h.step.explanation).toContain('12');
  });

  it('walks generated puzzles to the end using only hints', () => {
    const rng = makeRng(5);
    for (const d of ['hard', 'extraHard', 'extreme'] as const) {
      const q = generate(d, rng)!;
      const m = empty(q);
      for (let guard = 0; guard < 40; guard++) {
        const h = findHint(q, m);
        if (h.kind === 'solved') break;
        expect(h.kind).toBe('step');
        if (h.kind !== 'step') return;
        expect(h.step.technique).not.toBe('reveal');
        const mv = hintMove(q, h.step)!;
        m[mv.k] = mv.spot;
      }
      expect(isSolved(q, m)).toBe(true);
    }
  });
});

describe('finishable and status', () => {
  it('returns the missing dominoes when only basic steps remain', () => {
    const p = generate('hard', makeRng(3))!;
    const m: Placement = p.solution.map((s) => s);
    m[0] = null;
    m[1] = null;
    const out = finishable(p, m);
    expect(out).not.toBeNull();
    expect(out!.map((x) => x.k).sort()).toEqual([0, 1]);
    expect(isSolved(p, m)).toBe(false);
    for (const x of out!) m[x.k] = x.spot;
    expect(isSolved(p, m)).toBe(true);
    expect(finishable(p, m)).toEqual([]);
  });

  it('returns null when harder reasoning is still needed', () => {
    const rng = makeRng(8);
    const p = generate('extraHard', rng)!;
    expect(grade(p).maxTier).toBeGreaterThanOrEqual(3);
    expect(finishable(p, empty(p))).toBeNull();
  });

  it('reports regions as open, met or broken', () => {
    const p = smallPuzzle();
    const m = empty(p);
    expect(regionStatus(p.regions[0], cellValues(p, m))).toBe('open');
    m[3] = [0, 1];
    expect(regionStatus(p.regions[0], cellValues(p, m))).toBe('ok');
    m[3] = null;
    m[2] = [0, 1]; // 4|5 there: 9, not 12
    expect(regionStatus(p.regions[0], cellValues(p, m))).toBe('broken');
  });
});

describe('generation', () => {
  for (const d of DIFFICULTY_ORDER) {
    it(`generates unique, gradeable ${d} puzzles`, () => {
      const rng = makeRng(1234);
      const level = LEVELS[d];
      for (let k = 0; k < (d === 'extreme' ? 2 : 3); k++) {
        const p = generate(d, rng);
        expect(p, `${d} generation failed`).not.toBeNull();
        if (!p) return;
        expect(p.dominoes.length).toBe(level.dominoes);
        expect(p.cells.length).toBe(2 * level.dominoes);
        expect(new Set(p.dominoes.map((x) => x.join())).size).toBe(level.dominoes);
        for (const [a, b] of p.dominoes) expect(a).toBeLessThanOrEqual(b);
        expect(p.rows).toBeLessThanOrEqual(level.rows);
        expect(p.cols).toBeLessThanOrEqual(level.cols);
        expect(solve(p, 2).count).toBe(1);
        expect(isSolved(p, p.solution)).toBe(true);
        const g = grade(p);
        expect(g.solved).toBe(true);
        expect(g.maxTier).toBeGreaterThanOrEqual(level.minTier);
        expect(g.maxTier).toBeLessThanOrEqual(level.maxTier);
        // regions are connected and don't overlap
        const seen = new Set<number>();
        for (const r of p.regions) {
          for (const c of r.cells) {
            expect(seen.has(c)).toBe(false);
            seen.add(c);
          }
        }
        expect(JSON.parse(JSON.stringify(p))).toEqual(p);
      }
      expect(DIFFICULTY_INFO[d].description).toContain(`${level.dominoes} dominoes`);
    });
  }

  it('bundled bank puzzles are unique and graded to their level', () => {
    const bank = require('../../../data/pipsBank.json') as Record<Difficulty, PipsPuzzle[]>;
    for (const d of DIFFICULTY_ORDER) {
      expect(bank[d].length).toBeGreaterThan(0);
      for (const p of bank[d].slice(0, 6)) {
        expect(solve(p, 2).count).toBe(1);
        expect(isSolved(p, p.solution)).toBe(true);
        const g = grade(p);
        expect(g.solved).toBe(true);
        expect(g.maxTier).toBeGreaterThanOrEqual(LEVELS[d].minTier);
        expect(g.maxTier).toBeLessThanOrEqual(LEVELS[d].maxTier);
      }
    }
  });

  it('is reproducible for a seed', () => {
    expect(generate('medium', makeRng(42))).toEqual(generate('medium', makeRng(42)));
  });
});
