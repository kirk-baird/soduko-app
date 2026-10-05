import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_ORDER, Difficulty, bit, hasBit } from '../../common';
import { makeRng } from '../../rng';
import { DEFAULT_CAGE_OPTIONS, randomPuzzle } from '../generator';
import {
  CalcCage,
  CalcudokuPuzzle,
  DIFFICULTY_INFO,
  LEVELS,
  cageLabel,
  findHint,
  generate,
  grade,
  rulesFor,
  singlesFinish,
  solve,
} from '../index';
import { cageSatisfied, getCtx, legalCandidates } from '../model';
import { State, TECHNIQUES, applyStep, findStep } from '../techniques';

// A hand-checked 4×4 puzzle.
//   solution     cages
//   1 2 3 4      a a b c      a: 3+   (R1C1,R1C2)
//   3 4 1 2      d e b c      b: 4+   (R1C3,R2C3) -> 3+1
//   2 1 4 3      d e f f      c: 2÷   (R1C4,R2C4) -> 4,2
//   4 3 2 1      g g g h      d: 1−   (R2C1,R3C1) -> 3,2 ; e: 4× (R2C2,R3C2) -> 4,1
//                             f: 7+ (R3C3,R3C4) ; g: 24× (R4C1..R4C3) ; h: 1
const SMALL: CalcudokuPuzzle = {
  size: 4,
  cages: [
    { cells: [0, 1], op: '+', target: 3 },
    { cells: [2, 6], op: '+', target: 4 },
    { cells: [3, 7], op: '/', target: 2 },
    { cells: [4, 8], op: '-', target: 1 },
    { cells: [5, 9], op: '*', target: 4 },
    { cells: [10, 11], op: '+', target: 7 },
    { cells: [12, 13, 14], op: '*', target: 24 },
    { cells: [15], op: '=', target: 1 },
  ],
  solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1],
};

const isLatin = (n: number, g: number[]) => {
  for (let r = 0; r < n; r++) {
    const row = new Set(g.slice(r * n, r * n + n));
    const col = new Set([...Array(n).keys()].map((x) => g[x * n + r]));
    if (row.size !== n || col.size !== n) return false;
  }
  return g.every((v) => v >= 1 && v <= n);
};

const satisfiesCages = (p: CalcudokuPuzzle, g: number[]) =>
  p.cages.every((c) => cageSatisfied(c.op, c.target, c.cells.map((x) => g[x])));

function samplePuzzles(count: number, seed: number, sizes: number[]): CalcudokuPuzzle[] {
  const rng = makeRng(seed);
  const out: CalcudokuPuzzle[] = [];
  const opts = [DEFAULT_CAGE_OPTIONS, LEVELS.hard.cage, LEVELS.extreme.cage];
  for (let i = 0; i < count; i++) {
    const p = randomPuzzle(sizes[i % sizes.length], rng, opts[i % opts.length]);
    if (p) out.push(p);
  }
  return out;
}

describe('cage labels', () => {
  it('formats targets with operation symbols', () => {
    expect(cageLabel({ cells: [0, 1, 2], op: '*', target: 24 })).toBe('24×');
    expect(cageLabel({ cells: [0, 1], op: '-', target: 2 })).toBe('2−');
    expect(cageLabel({ cells: [0, 1], op: '/', target: 3 })).toBe('3÷');
    expect(cageLabel({ cells: [0, 1, 2], op: '+', target: 15 })).toBe('15+');
    expect(cageLabel({ cells: [0], op: '=', target: 5 })).toBe('5');
  });
});

describe('solver', () => {
  it('solves a known puzzle uniquely', () => {
    const r = solve(SMALL.size, SMALL.cages);
    expect(r.count).toBe(1);
    expect(r.solution).toEqual(SMALL.solution);
  });

  it('detects multiple solutions', () => {
    const rows: CalcCage[] = [0, 1, 2, 3].map((r) => ({ cells: [r * 4, r * 4 + 1, r * 4 + 2, r * 4 + 3], op: '+', target: 10 }));
    expect(solve(4, rows).count).toBe(2);
    expect(solve(4, rows, 5).count).toBe(5);
  });

  it('rejects inconsistent cages', () => {
    const bad = SMALL.cages.map((c) => (c.op === '=' ? { ...c, target: 2 } : c));
    expect(solve(4, bad).count).toBe(0);
    const impossible = SMALL.cages.map((c, i) => (i === 0 ? { ...c, target: 30 } : c));
    expect(solve(4, impossible).count).toBe(0);
  });
});

describe('legalCandidates', () => {
  // Brute-force reference: d is legal in an empty cell iff it's not used in
  // the row/column and the cage's empty cells can be filled with row/column-
  // legal digits (distinct within the cage per row/column) reaching the target.
  function reference(p: CalcudokuPuzzle, values: number[]): number[] {
    const n = p.size;
    const lat = values.map((v, i) => {
      if (v) return 0;
      let m = 0;
      for (let d = 1; d <= n; d++) {
        const r = Math.floor(i / n);
        const c = i % n;
        let ok = true;
        for (let x = 0; x < n; x++) if (values[r * n + x] === d || values[x * n + c] === d) ok = false;
        if (ok) m |= bit(d);
      }
      return m;
    });
    const out = new Array<number>(n * n).fill(0);
    for (const cage of p.cages) {
      const open = cage.cells.filter((c) => !values[c]);
      const assign = new Map<number, number>();
      const rec = (j: number): void => {
        if (j === open.length) {
          const ds = cage.cells.map((c) => values[c] || assign.get(c)!);
          const clash = cage.cells.some((a, x) =>
            cage.cells.some(
              (b, y) => x < y && ds[x] === ds[y] && (Math.floor(a / n) === Math.floor(b / n) || a % n === b % n),
            ),
          );
          if (!clash && cageSatisfied(cage.op, cage.target, ds)) for (const c of open) out[c] |= bit(assign.get(c)!);
          return;
        }
        for (let d = 1; d <= n; d++) {
          if (!hasBit(lat[open[j]], d)) continue;
          assign.set(open[j], d);
          rec(j + 1);
        }
      };
      rec(0);
    }
    return out;
  }

  it('matches a brute-force reference on random partial grids', () => {
    const rng = makeRng(77);
    for (const p of samplePuzzles(30, 5, [4, 5, 6, 7])) {
      const rules = rulesFor(p);
      for (let trial = 0; trial < 4; trial++) {
        const values = p.solution.map((v) => (rng() < 0.4 ? v : 0));
        expect(rules.legalCandidates(values)).toEqual(reference(p, values));
        // Arbitrary (possibly wrong) placements must still match the reference.
        const messy = values.map((v) => (v === 0 && rng() < 0.15 ? 1 + Math.floor(rng() * p.size) : v));
        expect(rules.legalCandidates(messy)).toEqual(reference(p, messy));
      }
    }
  });

  it('always contains the solution digit when placed values are correct', () => {
    for (const p of samplePuzzles(20, 6, [5, 6, 7, 8])) {
      const rules = rulesFor(p);
      const legal = rules.legalCandidates(new Array(p.size * p.size).fill(0));
      legal.forEach((m, i) => expect(hasBit(m, p.solution[i])).toBe(true));
    }
  });

  it('describes rules for the game screen', () => {
    const r = rulesFor(SMALL);
    expect(r.cellCount).toBe(16);
    expect(r.maxDigit).toBe(4);
    expect(r.playable.every(Boolean)).toBe(true);
    expect(r.peers[5].sort((a, b) => a - b)).toEqual([1, 4, 6, 7, 9, 13]);
    // Single-cell cage: only its target.
    expect(r.legalCandidates(new Array(16).fill(0))[15]).toBe(bit(1));
  });
});

describe('technique soundness', () => {
  const fired = new Set<string>();
  const check = (p: CalcudokuPuzzle, start: State) => {
    const ctx = getCtx(p.size, p.cages);
    let s = start;
    for (let guard = 0; guard < 400; guard++) {
      if (s.values.every((v) => v)) break;
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
            throw new Error(`${t.id} eliminated the solution ${e.digit} at ${e.cell}\n${st.explanation}\n${JSON.stringify(p)}`);
          }
          if (!hasBit(s.cands[e.cell], e.digit)) throw new Error(`${t.id} eliminated a non-candidate`);
        }
        expect(st.placements.length + st.eliminations.length).toBeGreaterThan(0);
        expect(st.explanation.length).toBeGreaterThan(10);
        expect(st.tier).toBe(t.tier);
      }
      const st = findStep(ctx, s);
      if (!st) break;
      s = applyStep(ctx, s, st);
    }
  };

  it('never contradicts the solution (legal-candidate start)', () => {
    for (const p of samplePuzzles(160, 11, [4, 5, 6, 6, 7, 7, 8])) {
      const values = new Array<number>(p.size * p.size).fill(0);
      check(p, { values, cands: legalCandidates(getCtx(p.size, p.cages), values) });
    }
  });

  it('never contradicts the solution (every digit pencilled in)', () => {
    for (const p of samplePuzzles(60, 12, [4, 5, 6, 7])) {
      const N2 = p.size * p.size;
      const full = getCtx(p.size, p.cages).full;
      check(p, { values: new Array<number>(N2).fill(0), cands: new Array<number>(N2).fill(full) });
    }
  });

  it('exercises most techniques', () => {
    const rare = ['nakedQuad', 'hiddenQuad', 'xyWing', 'swordfish', 'cageProductSets', 'cageProduct'];
    const notFired = TECHNIQUES.map((t) => t.id).filter((id) => !fired.has(id));
    expect(notFired.filter((id) => !rare.includes(id))).toEqual([]);
  });
});

describe('generation', () => {
  it.each(DIFFICULTY_ORDER)('generates a unique %s puzzle that fits the level', (d: Difficulty) => {
    const rng = makeRng(1000 + DIFFICULTY_ORDER.indexOf(d));
    for (let i = 0; i < 3; i++) {
      const p = generate(d, rng);
      expect(p, d).not.toBeNull();
      const L = LEVELS[d];
      expect(p!.size).toBe(L.size);
      expect(isLatin(p!.size, p!.solution)).toBe(true);
      expect(satisfiesCages(p!, p!.solution)).toBe(true);
      const covered = p!.cages.flatMap((c) => c.cells).sort((a, b) => a - b);
      expect(covered).toEqual([...Array(L.size * L.size).keys()]);
      for (const c of p!.cages) {
        expect(c.cells.length).toBeLessThanOrEqual(4);
        if (c.op === '-' || c.op === '/') expect(c.cells.length).toBe(2);
        if (c.op === '=') expect(c.cells.length).toBe(1);
      }
      expect(p!.cages.filter((c) => c.op === '=').length).toBeLessThanOrEqual(L.cage.maxSingles);
      const r = solve(p!.size, p!.cages);
      expect(r.count).toBe(1);
      expect(r.solution).toEqual(p!.solution);
      const g = grade(p!);
      expect(g.solved).toBe(true);
      expect(g.maxTier).toBeGreaterThanOrEqual(L.minTier);
      expect(g.maxTier).toBeLessThanOrEqual(L.maxTier);
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    }
    expect(DIFFICULTY_INFO[d].label.length).toBeGreaterThan(0);
  });
});

describe('singlesFinish', () => {
  it('finishes a nearly complete grid', () => {
    const p = generate('hard', makeRng(5))!;
    const rng = makeRng(6);
    const values = p.solution.map((v) => (rng() < 0.75 ? v : 0));
    const out = singlesFinish(p, values);
    expect(out).not.toBeNull();
    const g = values.slice();
    for (const pl of out!) {
      expect(g[pl.cell]).toBe(0);
      g[pl.cell] = pl.digit;
    }
    expect(g).toEqual(p.solution);
  });

  it('returns an empty list for a solved grid', () => {
    expect(singlesFinish(SMALL, SMALL.solution)).toEqual([]);
  });

  it('returns null when more than singles are needed', () => {
    const p = generate('extraHard', makeRng(8))!;
    expect(singlesFinish(p, new Array(p.size * p.size).fill(0))).toBeNull();
  });
});

describe('hints', () => {
  const p = generate('hard', makeRng(21))!;
  const N2 = p.size * p.size;
  const noPencil = new Array<number>(N2).fill(0);
  const blank = new Array<number>(N2).fill(0);

  it('reports a solved puzzle', () => {
    expect(findHint(p, p.solution, noPencil).kind).toBe('solved');
  });

  it('flags wrong placed digits first', () => {
    const v = blank.slice();
    v[0] = (p.solution[0] % p.size) + 1;
    const h = findHint(p, v, noPencil);
    expect(h.kind).toBe('wrongValue');
    if (h.kind === 'wrongValue') expect(h.cells).toEqual([0]);
  });

  it('flags pencil marks where the correct digit was removed', () => {
    const pencil = noPencil.slice();
    pencil[3] = getCtx(p.size, p.cages).full & ~bit(p.solution[3]);
    const h = findHint(p, blank, pencil, [3]);
    expect(h.kind).toBe('missingCandidate');
    if (h.kind === 'missingCandidate') expect(h.cells).toEqual([3]);
    // Not explicitly removed: treated as unfinished marks.
    const h2 = findHint(p, blank, pencil);
    expect(h2.kind).toBe('step');
  });

  it('cleans up pencil marks that clash with placed digits', () => {
    const v = blank.slice();
    v[0] = p.solution[0];
    const pencil = noPencil.slice();
    pencil[1] = bit(p.solution[0]) | bit(p.solution[1]); // same row as R1C1
    const h = findHint(p, v, pencil);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.step.technique).toBe('cleanup');
      expect(h.step.eliminations).toEqual([{ cell: 1, digit: p.solution[0] }]);
    }
  });

  it('gives a sound step on the player candidates', () => {
    const h = findHint(p, blank, noPencil);
    expect(h.kind).toBe('step');
    if (h.kind === 'step') {
      expect(h.cands).toEqual(rulesFor(p).legalCandidates(blank));
      for (const e of h.step.eliminations) expect(p.solution[e.cell]).not.toBe(e.digit);
      for (const pl of h.step.placements) expect(p.solution[pl.cell]).toBe(pl.digit);
      expect(h.step.explanation).toMatch(/R\dC\d/);
    }
  });

  it('can walk a whole puzzle using only hints', () => {
    for (const d of DIFFICULTY_ORDER) {
      const q = generate(d, makeRng(30 + DIFFICULTY_ORDER.indexOf(d)))!;
      const n2 = q.size * q.size;
      const values = new Array<number>(n2).fill(0);
      let pencil = rulesFor(q).legalCandidates(values);
      for (let guard = 0; guard < 2000; guard++) {
        const h = findHint(q, values, pencil);
        if (h.kind === 'solved') break;
        expect(h.kind, d).toBe('step');
        if (h.kind !== 'step') break;
        pencil = h.cands!.slice();
        for (const e of h.step.eliminations) pencil[e.cell] &= ~bit(e.digit);
        for (const pl of h.step.placements) {
          values[pl.cell] = pl.digit;
          pencil[pl.cell] = 0;
          for (const q2 of rulesFor(q).peers[pl.cell]) pencil[q2] &= ~bit(pl.digit);
        }
      }
      expect(values).toEqual(q.solution);
    }
  });

  it('reveals a cell when no technique applies', () => {
    // Find a puzzle the techniques can't finish and hint from the stuck state.
    const rng = makeRng(99);
    for (let tries = 0; tries < 300; tries++) {
      const q = randomPuzzle(8, rng, LEVELS.extreme.cage);
      if (!q) continue;
      const ctx = getCtx(q.size, q.cages);
      const values = new Array<number>(64).fill(0);
      let s: State = { values, cands: legalCandidates(ctx, values) };
      for (;;) {
        const st = findStep(ctx, s);
        if (!st) break;
        s = applyStep(ctx, s, st);
      }
      if (s.values.every((v) => v)) continue;
      const h = findHint(q, s.values, s.cands);
      expect(h.kind).toBe('reveal');
      if (h.kind === 'reveal') expect(h.digit).toBe(q.solution[h.cell]);
      return;
    }
    throw new Error('no stuck puzzle found');
  });
});

describe('bank', () => {
  const file = join(__dirname, '../../../data/calcudokuBank.json');
  it.skipIf(!existsSync(file))('holds valid unique puzzles for every level', () => {
    const bank = JSON.parse(readFileSync(file, 'utf8')) as Record<Difficulty, CalcudokuPuzzle[]>;
    for (const d of DIFFICULTY_ORDER) {
      expect(bank[d].length).toBe(60);
      for (const p of bank[d]) {
        expect(p.size).toBe(LEVELS[d].size);
        expect(isLatin(p.size, p.solution)).toBe(true);
        expect(satisfiesCages(p, p.solution)).toBe(true);
        expect(solve(p.size, p.cages).count).toBe(1);
      }
      const g = grade(bank[d][0]);
      expect(g.solved).toBe(true);
    }
  });
});
