// Human-style solving techniques for every sudoku variant.
//
// Each technique inspects a State (placed values + candidate bitmasks) on a
// Geometry and returns the first deduction it can make as a Step, or null.
// Steps carry enough information to (a) apply the deduction, (b) highlight the
// pattern on the board and (c) explain it in plain English. The same functions
// grade puzzle difficulty and produce hints from the player's own pencil marks.
//
// The geometry defaults to classic 9×9, so classic callers can omit it.

import { combinations } from './grid';
import { CLASSIC, Geometry } from './sudoku/geometry';

export type Grid = number[];
export type Cands = number[];

export interface State {
  values: Grid;
  cands: Cands;
}

export interface CellDigit {
  cell: number;
  digit: number;
}

/** A highlighted "reason" candidate. color 0 = primary, 1 = alternate (chains/colouring). */
export interface KeyCandidate extends CellDigit {
  color?: 0 | 1;
}

export type TechniqueId =
  | 'cleanup'
  | 'nakedSingle'
  | 'hiddenSingle'
  | 'pointing'
  | 'claiming'
  | 'nakedPair'
  | 'hiddenPair'
  | 'nakedTriple'
  | 'hiddenTriple'
  | 'xWing'
  | 'nakedQuad'
  | 'hiddenQuad'
  | 'skyscraper'
  | 'twoStringKite'
  | 'turbotFish'
  | 'xyWing'
  | 'xyzWing'
  | 'swordfish'
  | 'simpleColoring'
  | 'uniqueRectangle'
  | 'wWing'
  | 'xChain'
  | 'xyChain'
  | 'jellyfish';

export interface Step {
  technique: TechniqueId;
  placements: CellDigit[];
  eliminations: CellDigit[];
  pattern: number[]; // cells that form the pattern
  keys: KeyCandidate[]; // candidates that justify the deduction
  units: number[]; // unit indices worth highlighting
  explanation: string;
}

export interface Technique {
  id: TechniqueId;
  name: string;
  tier: number; // 0 easy, 1 medium, 2 hard, 3 extra hard, 4 extreme
  find: (s: State, g?: Geometry) => Step | null;
}

// ---------- helpers ----------

const bit = (d: number) => 1 << d;
const has = (m: number, d: number) => (m & (1 << d)) !== 0;

function popcount(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

const digitsOf = (m: number, g: Geometry) => {
  const out: number[] = [];
  for (let d = 1; d <= g.n; d++) if (m & (1 << d)) out.push(d);
  return out;
};

const firstDigit = (m: number, g: Geometry) => {
  for (let d = 1; d <= g.n; d++) if (m & (1 << d)) return d;
  return 0;
};

const empty = (s: State, i: number) => s.values[i] === 0;

/** Empty cells in `cells` that have candidate d. */
const withDigit = (s: State, cells: number[], d: number) => cells.filter((i) => empty(s, i) && has(s.cands[i], d));

const elimDigit = (s: State, cells: number[], d: number): CellDigit[] =>
  withDigit(s, cells, d).map((cell) => ({ cell, digit: d }));

const uniq = (xs: number[]) => [...new Set(xs)];

const sees = (g: Geometry, a: number, b: number) => g.peerSet[a][b] === 1;

/** Cells (excluding the given ones) that see every cell in `cells`. */
function commonPeers(g: Geometry, cells: number[]): number[] {
  return g.peers[cells[0]].filter((i) => !cells.includes(i) && cells.every((c) => g.peerSet[i][c] === 1));
}

const sym = (g: Geometry, d: number) => g.symbol(d);
const cn = (g: Geometry, i: number) => g.cellName(i);
const cl = (g: Geometry, cells: number[]) => cells.map((i) => g.cellName(i)).join(', ');
const un = (g: Geometry, u: number) => g.unitLabel[u];
const dl = (g: Geometry, ds: number[]) => {
  const s = ds.map((d) => g.symbol(d));
  return s.length <= 1 ? s.join('') : s.slice(0, -1).join(', ') + ' and ' + s[s.length - 1];
};
const numList = (xs: (string | number)[]) =>
  xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

function step(
  technique: TechniqueId,
  fields: Partial<Omit<Step, 'technique' | 'explanation'>> & { explanation: string },
): Step {
  return {
    technique,
    placements: fields.placements ?? [],
    eliminations: fields.eliminations ?? [],
    pattern: fields.pattern ?? [],
    keys: fields.keys ?? [],
    units: fields.units ?? [],
    explanation: fields.explanation,
  };
}

const elimText = (g: Geometry, elims: CellDigit[]) => {
  const byDigit = new Map<number, number[]>();
  for (const e of elims) byDigit.set(e.digit, [...(byDigit.get(e.digit) ?? []), e.cell]);
  return [...byDigit.entries()].map(([d, cells]) => `${sym(g, d)} from ${cl(g, cells)}`).join('; ');
};

/** Conjugate pairs: units where d has exactly two positions. */
function strongLinks(s: State, g: Geometry, d: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let u = 0; u < g.units.length; u++) {
    const pos = withDigit(s, g.units[u], d);
    if (pos.length === 2) out.push([pos[0], pos[1], u]);
  }
  return out;
}

const isLine = (g: Geometry, u: number) => g.unitKind[u] === 'row' || g.unitKind[u] === 'col';

// ---------- singles ----------

function nakedSingle(s: State, g: Geometry = CLASSIC): Step | null {
  for (let i = 0; i < g.cellCount; i++) {
    if (!empty(s, i) || popcount(s.cands[i]) !== 1) continue;
    const d = firstDigit(s.cands[i], g);
    return step('nakedSingle', {
      placements: [{ cell: i, digit: d }],
      pattern: [i],
      keys: [{ cell: i, digit: d }],
      explanation: `${cn(g, i)} has only one candidate left: ${sym(g, d)}. Place ${sym(g, d)} there.`,
    });
  }
  return null;
}

const hiddenOrderCache = new WeakMap<Geometry, number[]>();
function hiddenSingleOrder(g: Geometry): number[] {
  let o = hiddenOrderCache.get(g);
  if (!o) {
    const all = g.units.map((_, u) => u);
    o = [...all.filter((u) => !isLine(g, u)), ...all.filter((u) => isLine(g, u))];
    hiddenOrderCache.set(g, o);
  }
  return o;
}

function hiddenSingle(s: State, g: Geometry = CLASSIC): Step | null {
  for (const u of hiddenSingleOrder(g)) {
    for (let d = 1; d <= g.n; d++) {
      if (g.units[u].some((i) => s.values[i] === d)) continue;
      const pos = withDigit(s, g.units[u], d);
      if (pos.length !== 1) continue;
      const c = pos[0];
      return step('hiddenSingle', {
        placements: [{ cell: c, digit: d }],
        pattern: [c],
        keys: [{ cell: c, digit: d }],
        units: [u],
        explanation: `In ${un(g, u)}, ${sym(g, d)} can only go in ${cn(g, c)}. Place ${sym(g, d)} there.`,
      });
    }
  }
  return null;
}

// ---------- locked candidates ----------
//
// For units A and B that overlap in 2+ cells: if every candidate for d in A
// lies inside B, then A's d is in A∩B, so B's d is too — remove d from B∖A.
// "Pointing" when A is a box/region/window, "claiming" when A is a line.

function lockedCandidates(kind: 'pointing' | 'claiming') {
  return (s: State, g: Geometry = CLASSIC): Step | null => {
    for (const [a, b] of g.intersections) {
      const aLine = isLine(g, a);
      if ((kind === 'claiming') !== aLine) continue;
      const inB = new Set(g.units[b]);
      for (let d = 1; d <= g.n; d++) {
        const pos = withDigit(s, g.units[a], d);
        if (pos.length < 2 || !pos.every((c) => inB.has(c))) continue;
        const inA = new Set(g.units[a]);
        const elims = elimDigit(s, g.units[b].filter((i) => !inA.has(i)), d);
        if (!elims.length) continue;
        const D = sym(g, d);
        return step(kind, {
          eliminations: elims,
          pattern: pos,
          keys: pos.map((cell) => ({ cell, digit: d })),
          units: [a, b],
          explanation:
            `In ${un(g, a)}, every ${D} candidate lies inside ${un(g, b)} (${cl(g, pos)}). ` +
            `Whichever of those is ${D}, ${un(g, b)} gets its ${D} there, ` +
            `so ${D} can be removed from the rest of ${un(g, b)}: ${cl(g, elims.map((e) => e.cell))}.`,
        });
      }
    }
    return null;
  };
}

// ---------- subsets ----------

const SUBSET_WORD = ['', '', 'pair', 'triple', 'quad'];

function nakedSubset(n: number, id: TechniqueId) {
  return (s: State, g: Geometry = CLASSIC): Step | null => {
    for (let u = 0; u < g.units.length; u++) {
      const cells = g.units[u].filter((i) => empty(s, i));
      const small = cells.filter((i) => {
        const p = popcount(s.cands[i]);
        return p >= 2 && p <= n;
      });
      if (small.length < n) continue;
      for (const combo of combinations(small, n)) {
        const union = combo.reduce((m, i) => m | s.cands[i], 0);
        if (popcount(union) !== n) continue;
        const ds = digitsOf(union, g);
        const others = cells.filter((i) => !combo.includes(i));
        const elims: CellDigit[] = [];
        for (const i of others) for (const d of ds) if (has(s.cands[i], d)) elims.push({ cell: i, digit: d });
        if (!elims.length) continue;
        return step(id, {
          eliminations: elims,
          pattern: combo,
          keys: combo.flatMap((cell) => digitsOf(s.cands[cell], g).map((digit) => ({ cell, digit }))),
          units: [u],
          explanation:
            `Naked ${SUBSET_WORD[n]}: in ${un(g, u)}, the ${n} cells ${cl(g, combo)} only contain the candidates ${dl(g, ds)}. ` +
            `Those ${n} cells must hold exactly those ${n} digits, so they can't appear anywhere else in ${un(g, u)}. ` +
            `Remove ${elimText(g, elims)}.`,
        });
      }
    }
    return null;
  };
}

function hiddenSubset(n: number, id: TechniqueId) {
  return (s: State, g: Geometry = CLASSIC): Step | null => {
    for (let u = 0; u < g.units.length; u++) {
      const cells = g.units[u];
      if (cells.length !== g.n) continue; // only complete units hold every digit
      const placed = new Set(cells.map((i) => s.values[i]).filter(Boolean));
      const positions = new Map<number, number[]>();
      for (let d = 1; d <= g.n; d++) {
        if (placed.has(d)) continue;
        const pos = withDigit(s, cells, d);
        if (pos.length >= 2 && pos.length <= n) positions.set(d, pos);
      }
      const digits = [...positions.keys()];
      if (digits.length < n) continue;
      for (const combo of combinations(digits, n)) {
        const where = uniq(combo.flatMap((d) => positions.get(d)!));
        if (where.length !== n) continue;
        const keep = combo.reduce((m, d) => m | bit(d), 0);
        const elims: CellDigit[] = [];
        for (const i of where) for (const d of digitsOf(s.cands[i] & ~keep, g)) elims.push({ cell: i, digit: d });
        if (!elims.length) continue;
        return step(id, {
          eliminations: elims,
          pattern: where,
          keys: where.flatMap((cell) => combo.filter((d) => has(s.cands[cell], d)).map((digit) => ({ cell, digit }))),
          units: [u],
          explanation:
            `Hidden ${SUBSET_WORD[n]}: in ${un(g, u)}, the digits ${dl(g, combo)} can only go in ${cl(g, where)}. ` +
            `Those ${n} cells must therefore hold exactly those digits, so every other candidate in them can be removed: ${elimText(g, elims)}.`,
        });
      }
    }
    return null;
  };
}

// ---------- fish ----------

const FISH_NAME = ['', '', 'X-Wing', 'Swordfish', 'Jellyfish'];

function fish(n: number, id: TechniqueId) {
  return (s: State, g: Geometry = CLASSIC): Step | null => {
    for (const grp of g.lineGroups) {
      for (let d = 1; d <= g.n; d++) {
        for (const rowBase of [true, false]) {
          const base = rowBase ? grp.rows : grp.cols;
          const cover = rowBase ? grp.cols : grp.rows;
          const coverIdx = rowBase ? grp.colIndex : grp.rowIndex;
          const baseIdx = rowBase ? grp.rowIndex : grp.colIndex;
          const cand: { line: number; covers: number[]; cells: number[] }[] = [];
          for (let l = 0; l < base.length; l++) {
            const cells = withDigit(s, g.units[base[l]], d);
            if (cells.length >= 2 && cells.length <= n) cand.push({ line: l, covers: cells.map((c) => coverIdx.get(c)!), cells });
          }
          if (cand.length < n) continue;
          for (const combo of combinations(cand, n)) {
            const covers = uniq(combo.flatMap((c) => c.covers)).sort((a, b) => a - b);
            if (covers.length !== n) continue;
            const baseLines = combo.map((c) => c.line);
            const elims: CellDigit[] = [];
            for (const k of covers) {
              for (const i of g.units[cover[k]]) {
                if (!baseLines.includes(baseIdx.get(i)!) && empty(s, i) && has(s.cands[i], d)) elims.push({ cell: i, digit: d });
              }
            }
            if (!elims.length) continue;
            const cells = combo.flatMap((c) => c.cells);
            const bl = baseLines.map((l) => un(g, base[l]));
            const cvl = covers.map((k) => un(g, cover[k]));
            const D = sym(g, d);
            return step(id, {
              eliminations: elims,
              pattern: cells,
              keys: cells.map((cell) => ({ cell, digit: d })),
              units: baseLines.map((l) => base[l]),
              explanation:
                `${FISH_NAME[n]} on ${D}: in ${numList(bl)}, the ${D} candidates are confined to ${numList(cvl)}. ` +
                `Each of those ${n} lines needs a ${D}, and they can only take them from those ${n} crossing lines, ` +
                `so between them they use up every ${D} there. ` +
                `Remove ${D} from the rest of ${numList(cvl)}: ${cl(g, elims.map((e) => e.cell))}.`,
            });
          }
        }
      }
    }
    return null;
  };
}

// ---------- single-digit patterns ----------

function skyscraper(s: State, g: Geometry = CLASSIC): Step | null {
  for (const grp of g.lineGroups) {
    for (let d = 1; d <= g.n; d++) {
      for (const rowBase of [true, false]) {
        const base = rowBase ? grp.rows : grp.cols;
        const cover = rowBase ? grp.cols : grp.rows;
        const coverIdx = rowBase ? grp.colIndex : grp.rowIndex;
        const lines: { l: number; cells: number[] }[] = [];
        for (let l = 0; l < base.length; l++) {
          const cells = withDigit(s, g.units[base[l]], d);
          if (cells.length === 2) lines.push({ l, cells });
        }
        for (const [A, B] of combinations(lines, 2)) {
          for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
              const a = A.cells[i];
              const b = B.cells[j];
              const ea = A.cells[1 - i];
              const eb = B.cells[1 - j];
              if (coverIdx.get(a) !== coverIdx.get(b) || coverIdx.get(ea) === coverIdx.get(eb)) continue;
              const elims = elimDigit(s, commonPeers(g, [ea, eb]), d);
              if (!elims.length) continue;
              const D = sym(g, d);
              return step('skyscraper', {
                eliminations: elims,
                pattern: [a, ea, b, eb],
                keys: [
                  { cell: a, digit: d, color: 1 },
                  { cell: b, digit: d, color: 1 },
                  { cell: ea, digit: d },
                  { cell: eb, digit: d },
                ],
                units: [base[A.l], base[B.l]],
                explanation:
                  `Skyscraper on ${D}: in ${un(g, base[A.l])} the ${D} is either ${cn(g, a)} or ${cn(g, ea)}; ` +
                  `in ${un(g, base[B.l])} it is either ${cn(g, b)} or ${cn(g, eb)}. ` +
                  `${cn(g, a)} and ${cn(g, b)} are both in ${un(g, cover[coverIdx.get(a)!])}, so at most one of them is ${D} — ` +
                  `meaning at least one of ${cn(g, ea)} or ${cn(g, eb)} must be ${D}. ` +
                  `Any cell that sees both can't be ${D}: remove ${D} from ${cl(g, elims.map((e) => e.cell))}.`,
              });
            }
          }
        }
      }
    }
  }
  return null;
}

function twoStringKite(s: State, g: Geometry = CLASSIC): Step | null {
  for (const grp of g.lineGroups) {
    for (let d = 1; d <= g.n; d++) {
      const rows: { u: number; cells: number[] }[] = [];
      const cols: { u: number; cells: number[] }[] = [];
      for (const u of grp.rows) {
        const r = withDigit(s, g.units[u], d);
        if (r.length === 2) rows.push({ u, cells: r });
      }
      for (const u of grp.cols) {
        const c = withDigit(s, g.units[u], d);
        if (c.length === 2) cols.push({ u, cells: c });
      }
      for (const R of rows) {
        for (const C of cols) {
          if (R.cells.some((x) => C.cells.includes(x))) continue;
          for (let i = 0; i < 2; i++) {
            for (let j = 0; j < 2; j++) {
              const ri = R.cells[i];
              const cj = C.cells[j];
              if (!sees(g, ri, cj)) continue;
              const shared = g.cellUnits[ri].find((u) => !isLine(g, u) && g.cellUnits[cj].includes(u));
              if (shared === undefined) continue;
              const re = R.cells[1 - i];
              const ce = C.cells[1 - j];
              const elims = elimDigit(s, commonPeers(g, [re, ce]), d);
              if (!elims.length) continue;
              const D = sym(g, d);
              return step('twoStringKite', {
                eliminations: elims,
                pattern: [ri, re, cj, ce],
                keys: [
                  { cell: ri, digit: d, color: 1 },
                  { cell: cj, digit: d, color: 1 },
                  { cell: re, digit: d },
                  { cell: ce, digit: d },
                ],
                units: [R.u, C.u],
                explanation:
                  `2-String Kite on ${D}: in ${un(g, R.u)} the ${D} is either ${cn(g, ri)} or ${cn(g, re)}; ` +
                  `in ${un(g, C.u)} it is either ${cn(g, cj)} or ${cn(g, ce)}. ` +
                  `${cn(g, ri)} and ${cn(g, cj)} share ${un(g, shared)}, so they can't both be ${D} — ` +
                  `so at least one of ${cn(g, re)} or ${cn(g, ce)} is ${D}. ` +
                  `Remove ${D} from cells that see both: ${cl(g, elims.map((e) => e.cell))}.`,
              });
            }
          }
        }
      }
    }
  }
  return null;
}

function simpleColoring(s: State, g: Geometry = CLASSIC): Step | null {
  for (let d = 1; d <= g.n; d++) {
    const links = strongLinks(s, g, d);
    const adj = new Map<number, number[]>();
    for (const [a, b] of links) {
      adj.set(a, [...(adj.get(a) ?? []), b]);
      adj.set(b, [...(adj.get(b) ?? []), a]);
    }
    const color = new Map<number, 0 | 1>();
    for (const start of adj.keys()) {
      if (color.has(start)) continue;
      const comp: number[] = [];
      color.set(start, 0);
      const queue = [start];
      while (queue.length) {
        const x = queue.shift()!;
        comp.push(x);
        for (const y of adj.get(x)!) {
          if (!color.has(y)) {
            color.set(y, (1 - color.get(x)!) as 0 | 1);
            queue.push(y);
          }
        }
      }
      if (comp.length < 3) continue;
      const D = sym(g, d);
      const keys = comp.map((cell) => ({ cell, digit: d, color: color.get(cell)! }));
      const intro =
        `Simple Colouring on ${D}: following the chain of conjugate pairs (units where ${D} has exactly two spots), ` +
        `the cells alternate between two colours, and exactly one colour holds all the ${D}s. `;

      for (const c of [0, 1] as const) {
        const same = comp.filter((x) => color.get(x) === c);
        const clash = combinations(same, 2).find(([a, b]) => sees(g, a, b));
        if (clash) {
          return step('simpleColoring', {
            eliminations: same.map((cell) => ({ cell, digit: d })),
            pattern: comp,
            keys,
            explanation:
              intro +
              `${cn(g, clash[0])} and ${cn(g, clash[1])} have the same colour but see each other, so that colour can't be the true one. ` +
              `Remove ${D} from every cell of that colour: ${cl(g, same)}.`,
          });
        }
      }
      const elims: CellDigit[] = [];
      let example: [number, number, number] | null = null;
      for (let i = 0; i < g.cellCount; i++) {
        if (!empty(s, i) || !has(s.cands[i], d) || color.has(i)) continue;
        const a = comp.find((x) => color.get(x) === 0 && sees(g, i, x));
        const b = comp.find((x) => color.get(x) === 1 && sees(g, i, x));
        if (a !== undefined && b !== undefined) {
          elims.push({ cell: i, digit: d });
          example ??= [i, a, b];
        }
      }
      if (elims.length && example) {
        return step('simpleColoring', {
          eliminations: elims,
          pattern: comp,
          keys,
          explanation:
            intro +
            `${cn(g, example[0])} sees ${cn(g, example[1])} (one colour) and ${cn(g, example[2])} (the other), ` +
            `so whichever colour is true, ${cn(g, example[0])} can't be ${D}. ` +
            `Remove ${D} from ${cl(g, elims.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

// ---------- wings ----------

function bivalueCells(s: State, g: Geometry) {
  const out: number[] = [];
  for (let i = 0; i < g.cellCount; i++) if (empty(s, i) && popcount(s.cands[i]) === 2) out.push(i);
  return out;
}

function xyWing(s: State, g: Geometry = CLASSIC): Step | null {
  const bv = bivalueCells(s, g);
  for (const p of bv) {
    const [x, y] = digitsOf(s.cands[p], g);
    for (const a of bv) {
      if (a === p || !sees(g, p, a)) continue;
      for (const [link, other] of [
        [x, y],
        [y, x],
      ]) {
        if (!has(s.cands[a], link) || has(s.cands[a], other)) continue;
        const z = firstDigit(s.cands[a] & ~bit(link), g);
        for (const b of bv) {
          if (b === p || b === a || !sees(g, p, b)) continue;
          if (s.cands[b] !== (bit(other) | bit(z))) continue;
          const elims = elimDigit(s, commonPeers(g, [a, b]), z);
          if (!elims.length) continue;
          const [L, O, Z] = [sym(g, link), sym(g, other), sym(g, z)];
          return step('xyWing', {
            eliminations: elims,
            pattern: [p, a, b],
            keys: [
              { cell: p, digit: x, color: 1 },
              { cell: p, digit: y, color: 1 },
              { cell: a, digit: link, color: 1 },
              { cell: b, digit: other, color: 1 },
              { cell: a, digit: z },
              { cell: b, digit: z },
            ],
            explanation:
              `XY-Wing: the pivot ${cn(g, p)} is ${L} or ${O}. ` +
              `If it's ${L}, then ${cn(g, a)} (${L}/${Z}) must be ${Z}. ` +
              `If it's ${O}, then ${cn(g, b)} (${O}/${Z}) must be ${Z}. ` +
              `Either way one of ${cn(g, a)} or ${cn(g, b)} is ${Z}, so any cell that sees both can't be ${Z}: ` +
              `remove ${Z} from ${cl(g, elims.map((e) => e.cell))}.`,
          });
        }
      }
    }
  }
  return null;
}

function xyzWing(s: State, g: Geometry = CLASSIC): Step | null {
  const bv = bivalueCells(s, g);
  for (let p = 0; p < g.cellCount; p++) {
    if (!empty(s, p) || popcount(s.cands[p]) !== 3) continue;
    const pm = s.cands[p];
    const wings = bv.filter((w) => sees(g, p, w) && (s.cands[w] & ~pm) === 0);
    for (const [a, b] of combinations(wings, 2)) {
      if (s.cands[a] === s.cands[b]) continue;
      const shared = s.cands[a] & s.cands[b];
      if (popcount(shared) !== 1 || (s.cands[a] | s.cands[b]) !== pm) continue;
      const z = firstDigit(shared, g);
      const elims = elimDigit(s, commonPeers(g, [p, a, b]), z);
      if (!elims.length) continue;
      const Z = sym(g, z);
      const col = (digit: number) => (digit === z ? 0 : 1) as 0 | 1;
      return step('xyzWing', {
        eliminations: elims,
        pattern: [p, a, b],
        keys: [
          ...digitsOf(pm, g).map((digit) => ({ cell: p, digit, color: col(digit) })),
          ...digitsOf(s.cands[a], g).map((digit) => ({ cell: a, digit, color: col(digit) })),
          ...digitsOf(s.cands[b], g).map((digit) => ({ cell: b, digit, color: col(digit) })),
        ],
        explanation:
          `XYZ-Wing: the pivot ${cn(g, p)} is ${dl(g, digitsOf(pm, g))}; ${cn(g, a)} is ${dl(g, digitsOf(s.cands[a], g))} ` +
          `and ${cn(g, b)} is ${dl(g, digitsOf(s.cands[b], g))}, both seeing the pivot. ` +
          `If the pivot isn't ${Z}, it takes one wing's other digit and forces that wing to ${Z}. ` +
          `So one of these three cells is always ${Z}, and any cell that sees all three can't be ${Z}: ` +
          `remove ${Z} from ${cl(g, elims.map((e) => e.cell))}.`,
      });
    }
  }
  return null;
}

function wWing(s: State, g: Geometry = CLASSIC): Step | null {
  const bv = bivalueCells(s, g);
  for (const [p, q] of combinations(bv, 2)) {
    if (s.cands[p] !== s.cands[q] || sees(g, p, q)) continue;
    const [x, y] = digitsOf(s.cands[p], g);
    for (const [link, elimD] of [
      [x, y],
      [y, x],
    ]) {
      const targets = elimDigit(s, commonPeers(g, [p, q]), elimD);
      if (!targets.length) continue;
      for (const [s1, s2, u] of strongLinks(s, g, link)) {
        if ([s1, s2].includes(p) || [s1, s2].includes(q)) continue;
        let a = -1;
        let b = -1;
        if (sees(g, s1, p) && sees(g, s2, q)) [a, b] = [s1, s2];
        else if (sees(g, s1, q) && sees(g, s2, p)) [a, b] = [s2, s1];
        if (a < 0) continue;
        const [L, E] = [sym(g, link), sym(g, elimD)];
        return step('wWing', {
          eliminations: targets,
          pattern: [p, q, a, b],
          keys: [
            { cell: p, digit: link, color: 1 },
            { cell: q, digit: link, color: 1 },
            { cell: a, digit: link, color: 1 },
            { cell: b, digit: link, color: 1 },
            { cell: p, digit: elimD },
            { cell: q, digit: elimD },
          ],
          units: [u],
          explanation:
            `W-Wing: ${cn(g, p)} and ${cn(g, q)} both contain only ${sym(g, x)}/${sym(g, y)}. ` +
            `In ${un(g, u)}, ${L} must be in ${cn(g, a)} or ${cn(g, b)}; ${cn(g, a)} sees ${cn(g, p)} and ${cn(g, b)} sees ${cn(g, q)}. ` +
            `So ${cn(g, p)} and ${cn(g, q)} can't both be ${L} — at least one of them is ${E}. ` +
            `Remove ${E} from cells that see both: ${cl(g, targets.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

// ---------- uniqueness ----------

/**
 * Four cells in two rows and two columns form a "deadly pattern" only if every
 * unit touching them contains exactly two of them, side by side (same row or
 * same column of the rectangle). Then swapping a/b keeps every unit valid.
 */
function isDeadlyShape(g: Geometry, cells: number[]): boolean {
  const [tl, tr, bl, br] = cells;
  const edges = [
    [tl, tr],
    [bl, br],
    [tl, bl],
    [tr, br],
  ];
  const touched = new Set(cells.flatMap((c) => g.cellUnits[c]));
  for (const u of touched) {
    const inU = cells.filter((c) => g.cellUnits[c].includes(u));
    if (inU.length !== 2) return false;
    if (!edges.some(([a, b]) => inU.includes(a) && inU.includes(b))) return false;
  }
  return true;
}

function uniqueRectangle(s: State, g: Geometry = CLASSIC): Step | null {
  for (const grp of g.lineGroups) {
    const n = grp.rows.length;
    const at = (r: number, c: number) => g.units[grp.rows[r]].find((x) => grp.colIndex.get(x) === c)!;
    for (const [r1, r2] of combinations([...Array(n).keys()], 2)) {
      for (const [c1, c2] of combinations([...Array(n).keys()], 2)) {
        const cells = [at(r1, c1), at(r1, c2), at(r2, c1), at(r2, c2)];
        if (!cells.every((i) => empty(s, i))) continue;
        const bivals = cells.filter((i) => popcount(s.cands[i]) === 2);
        if (bivals.length !== 3) continue;
        const m = s.cands[bivals[0]];
        if (!bivals.every((i) => s.cands[i] === m)) continue;
        const fourth = cells.find((i) => !bivals.includes(i))!;
        if ((s.cands[fourth] & m) !== m) continue;
        if (!isDeadlyShape(g, cells)) continue;
        const [a, b] = digitsOf(m, g);
        const [A, B] = [sym(g, a), sym(g, b)];
        return step('uniqueRectangle', {
          eliminations: [a, b].map((digit) => ({ cell: fourth, digit })),
          pattern: cells,
          keys: bivals.flatMap((cell) => [
            { cell, digit: a },
            { cell, digit: b },
          ]),
          explanation:
            `Unique Rectangle: ${cl(g, bivals)} all contain only ${A}/${B}, and with ${cn(g, fourth)} they form a rectangle across two boxes. ` +
            `If ${cn(g, fourth)} were also reduced to ${A}/${B}, the ${A}s and ${B}s could be swapped around the rectangle, giving two solutions. ` +
            `A proper puzzle has exactly one, so ${cn(g, fourth)} can't be ${A} or ${B}: remove both.`,
        });
      }
    }
  }
  return null;
}

// ---------- chains ----------
//
// Chains are found by breadth-first search over implications, which yields
// the shortest chain to each end cell. An implication path that revisits a
// cell is still logically valid, so no simple-path bookkeeping is needed.

interface ChainHit {
  path: number[];
  start: number;
  end: number;
  elims: CellDigit[];
}

function searchXChain(s: State, g: Geometry, d: number, maxLinks: number): ChainHit | null {
  const nodes = withDigit(s, [...Array(g.cellCount).keys()], d);
  if (nodes.length < 4) return null;
  const strong = new Map<number, number[]>();
  for (const [a, b] of strongLinks(s, g, d)) {
    strong.set(a, uniq([...(strong.get(a) ?? []), b]));
    strong.set(b, uniq([...(strong.get(b) ?? []), a]));
  }
  const nodeSet = new Set(nodes);
  let best: ChainHit | null = null;
  for (const start of strong.keys()) {
    const parent = new Map<number, number>();
    const depth = new Map<number, number>();
    const k0 = start * 2;
    parent.set(k0, -1);
    depth.set(k0, 0);
    const queue = [k0];
    while (queue.length) {
      const k = queue.shift()!;
      const cell = k >> 1;
      const on = (k & 1) === 1;
      const dep = depth.get(k)!;
      if (on && cell !== start && dep >= 3) {
        const elims = elimDigit(s, commonPeers(g, [start, cell]), d);
        if (elims.length && (!best || dep < best.path.length - 1)) {
          const path: number[] = [];
          for (let x = k; x !== -1; x = parent.get(x)!) path.unshift(x >> 1);
          best = { path, start, end: cell, elims };
        }
      }
      if (dep >= maxLinks || (best && dep >= best.path.length - 1)) continue;
      const next = on ? g.peers[cell].filter((n) => nodeSet.has(n)) : (strong.get(cell) ?? []);
      for (const n of next) {
        const nk = n * 2 + (on ? 0 : 1);
        if (parent.has(nk)) continue;
        parent.set(nk, k);
        depth.set(nk, dep + 1);
        queue.push(nk);
      }
    }
  }
  return best;
}

function xChainTechnique(id: TechniqueId, maxLinks: number) {
  return (s: State, g: Geometry = CLASSIC): Step | null => {
    for (let d = 1; d <= g.n; d++) {
      const hit = searchXChain(s, g, d, maxLinks);
      if (!hit) continue;
      const { path, start, end, elims } = hit;
      const D = sym(g, d);
      const keys = path.map((cell, idx) => ({ cell, digit: d, color: (idx % 2 === 0 ? 1 : 0) as 0 | 1 }));
      const label = id === 'turbotFish' ? 'Turbot Fish' : 'X-Chain';
      return step(id, {
        eliminations: elims,
        pattern: uniq(path),
        keys,
        explanation:
          `${label} on ${D}: ${path.map((c) => cn(g, c)).join(' → ')}. ` +
          `The links alternate between "strong" (the two cells are the only places for ${D} in some unit, so one of them must be ${D}) ` +
          `and "weak" (the two cells see each other, so they can't both be ${D}). ` +
          `If ${cn(g, start)} isn't ${D}, the chain forces ${cn(g, end)} to be ${D}. ` +
          `So at least one end is ${D}, and any cell seeing both ends can't be: remove ${D} from ${cl(g, elims.map((e) => e.cell))}.`,
      });
    }
    return null;
  };
}

const MAX_XY_CHAIN_CELLS = 12;

function xyChain(s: State, g: Geometry = CLASSIC): Step | null {
  const bv = bivalueCells(s, g);
  const bvSet = new Set(bv);
  const K = 32; // key = cell*K + digit
  let best: { path: number[]; z: number; elims: CellDigit[] } | null = null;
  for (const start of bv) {
    for (const z of digitsOf(s.cands[start], g)) {
      const firstOn = firstDigit(s.cands[start] & ~bit(z), g);
      const k0 = start * K + firstOn;
      const parent = new Map<number, number>([[k0, -1]]);
      const depth = new Map<number, number>([[k0, 1]]);
      const queue = [k0];
      while (queue.length) {
        const k = queue.shift()!;
        const cell = Math.floor(k / K);
        const on = k % K;
        const dep = depth.get(k)!;
        if (on === z && cell !== start && dep >= 3) {
          const elims = elimDigit(s, commonPeers(g, [start, cell]), z);
          if (elims.length && (!best || dep < best.path.length)) {
            const path: number[] = [];
            for (let x = k; x !== -1; x = parent.get(x)!) path.unshift(Math.floor(x / K));
            best = { path, z, elims };
          }
        }
        if (dep >= MAX_XY_CHAIN_CELLS || (best && dep >= best.path.length)) continue;
        for (const n of g.peers[cell]) {
          if (!bvSet.has(n) || !has(s.cands[n], on)) continue;
          const nk = n * K + firstDigit(s.cands[n] & ~bit(on), g);
          if (parent.has(nk)) continue;
          parent.set(nk, k);
          depth.set(nk, dep + 1);
          queue.push(nk);
        }
      }
    }
  }
  if (!best) return null;
  const { path, z, elims } = best;
  const start = path[0];
  const end = path[path.length - 1];
  const keys: KeyCandidate[] = [];
  path.forEach((cell, idx) => {
    for (const digit of digitsOf(s.cands[cell], g)) {
      const isZEnd = (idx === 0 || idx === path.length - 1) && digit === z;
      keys.push({ cell, digit, color: isZEnd ? 0 : 1 });
    }
  });
  const Z = sym(g, z);
  const desc = path.map((c) => `${cn(g, c)} (${digitsOf(s.cands[c], g).map((d) => sym(g, d)).join('/')})`).join(' → ');
  return step('xyChain', {
    eliminations: elims,
    pattern: uniq(path),
    keys,
    explanation:
      `XY-Chain: ${desc}. Each cell has exactly two candidates and sees the next one. ` +
      `If ${cn(g, start)} isn't ${Z}, it must be its other digit, which forces the next cell, and so on down the chain until ${cn(g, end)} is forced to be ${Z}. ` +
      `So either ${cn(g, start)} or ${cn(g, end)} is ${Z}; any cell seeing both can't be ${Z}: ` +
      `remove ${Z} from ${cl(g, elims.map((e) => e.cell))}.`,
  });
}

// ---------- registry ----------

export const TECHNIQUES: Technique[] = [
  // tier 0: singles (used everywhere; not a difficulty level on their own)
  { id: 'nakedSingle', name: 'Naked Single', tier: 0, find: nakedSingle },
  { id: 'hiddenSingle', name: 'Hidden Single', tier: 0, find: hiddenSingle },
  // tier 1: Medium
  { id: 'pointing', name: 'Pointing', tier: 1, find: lockedCandidates('pointing') },
  { id: 'claiming', name: 'Box/Line Reduction', tier: 1, find: lockedCandidates('claiming') },
  { id: 'nakedPair', name: 'Naked Pair', tier: 1, find: nakedSubset(2, 'nakedPair') },
  { id: 'hiddenPair', name: 'Hidden Pair', tier: 1, find: hiddenSubset(2, 'hiddenPair') },
  // tier 2: Hard
  { id: 'nakedTriple', name: 'Naked Triple', tier: 2, find: nakedSubset(3, 'nakedTriple') },
  { id: 'hiddenTriple', name: 'Hidden Triple', tier: 2, find: hiddenSubset(3, 'hiddenTriple') },
  { id: 'xWing', name: 'X-Wing', tier: 2, find: fish(2, 'xWing') },
  { id: 'skyscraper', name: 'Skyscraper', tier: 2, find: skyscraper },
  { id: 'twoStringKite', name: '2-String Kite', tier: 2, find: twoStringKite },
  { id: 'turbotFish', name: 'Turbot Fish', tier: 2, find: xChainTechnique('turbotFish', 3) },
  { id: 'xyWing', name: 'XY-Wing', tier: 2, find: xyWing },
  { id: 'nakedQuad', name: 'Naked Quad', tier: 2, find: nakedSubset(4, 'nakedQuad') },
  { id: 'hiddenQuad', name: 'Hidden Quad', tier: 2, find: hiddenSubset(4, 'hiddenQuad') },
  // tier 3: Extra Hard
  { id: 'xyzWing', name: 'XYZ-Wing', tier: 3, find: xyzWing },
  { id: 'wWing', name: 'W-Wing', tier: 3, find: wWing },
  { id: 'swordfish', name: 'Swordfish', tier: 3, find: fish(3, 'swordfish') },
  { id: 'simpleColoring', name: 'Simple Colouring', tier: 3, find: simpleColoring },
  { id: 'uniqueRectangle', name: 'Unique Rectangle', tier: 3, find: uniqueRectangle },
  // tier 4: Extreme
  { id: 'xChain', name: 'X-Chain', tier: 4, find: xChainTechnique('xChain', 15) },
  { id: 'xyChain', name: 'XY-Chain', tier: 4, find: xyChain },
  { id: 'jellyfish', name: 'Jellyfish', tier: 4, find: fish(4, 'jellyfish') },
];

export const TECHNIQUE_BY_ID: Record<string, Technique> = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t]));
TECHNIQUE_BY_ID.cleanup = { id: 'cleanup', name: 'Candidate Clean-up', tier: 0, find: () => null };

export interface FindOptions {
  maxTier?: number;
  /** Skip uniqueness-based techniques (when using logic to prove uniqueness). */
  noUniqueness?: boolean;
}

export function findStep(s: State, maxTier = 4, g: Geometry = CLASSIC, opts: FindOptions = {}): Step | null {
  for (const t of TECHNIQUES) {
    if (t.tier > maxTier) break;
    if (opts.noUniqueness && t.id === 'uniqueRectangle') continue;
    const st = t.find(s, g);
    if (st) return st;
  }
  return null;
}
