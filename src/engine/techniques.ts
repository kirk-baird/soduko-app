// Human-style solving techniques.
//
// Each technique inspects a State (placed values + candidate bitmasks) and
// returns the first deduction it can make as a Step, or null. Steps carry
// enough information to (a) apply the deduction, (b) highlight the pattern on
// the board and (c) explain it in plain English. The same functions are used
// to grade puzzle difficulty and to produce hints from the player's own
// pencil marks.

import {
  BOX_UNITS,
  COL_UNITS,
  Cands,
  Grid,
  ROW_UNITS,
  UNITS,
  bit,
  boxOf,
  cellList,
  cellName,
  colOf,
  combinations,
  commonPeers,
  digitList,
  digitsOf,
  firstDigit,
  has,
  popcount,
  rowOf,
  sees,
  unitName,
} from './grid';

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
  units: number[]; // units worth highlighting
  explanation: string;
}

export interface Technique {
  id: TechniqueId;
  name: string;
  tier: number; // 0 easy, 1 medium, 2 hard, 3 extra hard, 4 extreme
  find: (s: State) => Step | null;
}

// ---------- helpers ----------

const empty = (s: State, i: number) => s.values[i] === 0;

/** Empty cells in `cells` that have candidate d. */
const withDigit = (s: State, cells: number[], d: number) => cells.filter((i) => empty(s, i) && has(s.cands[i], d));

const elimDigit = (s: State, cells: number[], d: number): CellDigit[] =>
  withDigit(s, cells, d).map((cell) => ({ cell, digit: d }));

const uniq = (xs: number[]) => [...new Set(xs)];

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

const elimText = (elims: CellDigit[]) => {
  const byDigit = new Map<number, number[]>();
  for (const e of elims) byDigit.set(e.digit, [...(byDigit.get(e.digit) ?? []), e.cell]);
  return [...byDigit.entries()].map(([d, cells]) => `${d} from ${cellList(cells)}`).join('; ');
};

const lineLabel = (isRow: boolean, idx: number) => (isRow ? `row ${idx + 1}` : `column ${idx + 1}`);

/** Unit indices (into UNITS) where d has exactly two positions: conjugate pairs. */
function strongLinks(s: State, d: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let u = 0; u < 27; u++) {
    const pos = withDigit(s, UNITS[u], d);
    if (pos.length === 2) out.push([pos[0], pos[1], u]);
  }
  return out;
}

// ---------- singles ----------

function nakedSingle(s: State): Step | null {
  for (let i = 0; i < 81; i++) {
    if (!empty(s, i) || popcount(s.cands[i]) !== 1) continue;
    const d = firstDigit(s.cands[i]);
    return step('nakedSingle', {
      placements: [{ cell: i, digit: d }],
      pattern: [i],
      keys: [{ cell: i, digit: d }],
      explanation: `${cellName(i)} has only one candidate left: ${d}. Place ${d} there.`,
    });
  }
  return null;
}

const HIDDEN_SINGLE_ORDER = [...Array(9).keys()].map((b) => 18 + b).concat([...Array(18).keys()]);

function hiddenSingle(s: State): Step | null {
  for (const u of HIDDEN_SINGLE_ORDER) {
    for (let d = 1; d <= 9; d++) {
      if (UNITS[u].some((i) => s.values[i] === d)) continue;
      const pos = withDigit(s, UNITS[u], d);
      if (pos.length !== 1) continue;
      const c = pos[0];
      return step('hiddenSingle', {
        placements: [{ cell: c, digit: d }],
        pattern: [c],
        keys: [{ cell: c, digit: d }],
        units: [u],
        explanation: `In ${unitName(u)}, ${d} can only go in ${cellName(c)}. Place ${d} there.`,
      });
    }
  }
  return null;
}

// ---------- locked candidates ----------

function pointing(s: State): Step | null {
  for (let b = 0; b < 9; b++) {
    for (let d = 1; d <= 9; d++) {
      const pos = withDigit(s, BOX_UNITS[b], d);
      if (pos.length < 2) continue;
      for (const isRow of [true, false]) {
        const lines = uniq(pos.map(isRow ? rowOf : colOf));
        if (lines.length !== 1) continue;
        const line = isRow ? ROW_UNITS[lines[0]] : COL_UNITS[lines[0]];
        const elims = elimDigit(s, line.filter((i) => boxOf(i) !== b), d);
        if (!elims.length) continue;
        const ln = lineLabel(isRow, lines[0]);
        return step('pointing', {
          eliminations: elims,
          pattern: pos,
          keys: pos.map((cell) => ({ cell, digit: d })),
          units: [18 + b, isRow ? lines[0] : 9 + lines[0]],
          explanation:
            `In box ${b + 1}, every ${d} candidate lies in ${ln} (${cellList(pos)}). ` +
            `Whichever of those is ${d}, ${ln} gets its ${d} inside box ${b + 1}, ` +
            `so ${d} can be removed from the rest of ${ln}: ${cellList(elims.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

function claiming(s: State): Step | null {
  for (let u = 0; u < 18; u++) {
    for (let d = 1; d <= 9; d++) {
      const pos = withDigit(s, UNITS[u], d);
      if (pos.length < 2) continue;
      const boxes = uniq(pos.map(boxOf));
      if (boxes.length !== 1) continue;
      const b = boxes[0];
      const elims = elimDigit(s, BOX_UNITS[b].filter((i) => !UNITS[u].includes(i)), d);
      if (!elims.length) continue;
      return step('claiming', {
        eliminations: elims,
        pattern: pos,
        keys: pos.map((cell) => ({ cell, digit: d })),
        units: [u, 18 + b],
        explanation:
          `In ${unitName(u)}, every ${d} candidate lies inside box ${b + 1} (${cellList(pos)}). ` +
          `So the ${d} for ${unitName(u)} must come from box ${b + 1}, which means no other cell in box ${b + 1} can be ${d}. ` +
          `Remove ${d} from ${cellList(elims.map((e) => e.cell))}.`,
      });
    }
  }
  return null;
}

// ---------- subsets ----------

const SUBSET_WORD = ['', '', 'pair', 'triple', 'quad'];

function nakedSubset(n: number, id: TechniqueId) {
  return (s: State): Step | null => {
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u].filter((i) => empty(s, i));
      const small = cells.filter((i) => {
        const p = popcount(s.cands[i]);
        return p >= 2 && p <= n;
      });
      if (small.length < n) continue;
      for (const combo of combinations(small, n)) {
        const union = combo.reduce((m, i) => m | s.cands[i], 0);
        if (popcount(union) !== n) continue;
        const ds = digitsOf(union);
        const others = cells.filter((i) => !combo.includes(i));
        const elims: CellDigit[] = [];
        for (const i of others) for (const d of ds) if (has(s.cands[i], d)) elims.push({ cell: i, digit: d });
        if (!elims.length) continue;
        return step(id, {
          eliminations: elims,
          pattern: combo,
          keys: combo.flatMap((cell) => digitsOf(s.cands[cell]).map((digit) => ({ cell, digit }))),
          units: [u],
          explanation:
            `Naked ${SUBSET_WORD[n]}: in ${unitName(u)}, the ${n} cells ${cellList(combo)} only contain the candidates ${digitList(ds)}. ` +
            `Those ${n} cells must hold exactly those ${n} digits, so they can't appear anywhere else in ${unitName(u)}. ` +
            `Remove ${elimText(elims)}.`,
        });
      }
    }
    return null;
  };
}

function hiddenSubset(n: number, id: TechniqueId) {
  return (s: State): Step | null => {
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u];
      const placed = new Set(cells.map((i) => s.values[i]).filter(Boolean));
      const positions = new Map<number, number[]>();
      for (let d = 1; d <= 9; d++) {
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
        for (const i of where) for (const d of digitsOf(s.cands[i] & ~keep)) elims.push({ cell: i, digit: d });
        if (!elims.length) continue;
        return step(id, {
          eliminations: elims,
          pattern: where,
          keys: where.flatMap((cell) => combo.filter((d) => has(s.cands[cell], d)).map((digit) => ({ cell, digit }))),
          units: [u],
          explanation:
            `Hidden ${SUBSET_WORD[n]}: in ${unitName(u)}, the digits ${digitList(combo)} can only go in ${cellList(where)}. ` +
            `Those ${n} cells must therefore hold exactly those digits, so every other candidate in them can be removed: ${elimText(elims)}.`,
        });
      }
    }
    return null;
  };
}

// ---------- fish ----------

const FISH_NAME = ['', '', 'X-Wing', 'Swordfish', 'Jellyfish'];

function fish(n: number, id: TechniqueId) {
  return (s: State): Step | null => {
    for (let d = 1; d <= 9; d++) {
      for (const rowBase of [true, false]) {
        const base = rowBase ? ROW_UNITS : COL_UNITS;
        const cover = rowBase ? COL_UNITS : ROW_UNITS;
        const coverIdx = rowBase ? colOf : rowOf;
        const cand: { line: number; covers: number[]; cells: number[] }[] = [];
        for (let l = 0; l < 9; l++) {
          const cells = withDigit(s, base[l], d);
          if (cells.length >= 2 && cells.length <= n) cand.push({ line: l, covers: cells.map(coverIdx), cells });
        }
        if (cand.length < n) continue;
        for (const combo of combinations(cand, n)) {
          const covers = uniq(combo.flatMap((c) => c.covers)).sort((a, b) => a - b);
          if (covers.length !== n) continue;
          const baseLines = combo.map((c) => c.line);
          const elims: CellDigit[] = [];
          for (const cl of covers) {
            for (const i of cover[cl]) {
              const bl = rowBase ? rowOf(i) : colOf(i);
              if (!baseLines.includes(bl) && empty(s, i) && has(s.cands[i], d)) elims.push({ cell: i, digit: d });
            }
          }
          if (!elims.length) continue;
          const cells = combo.flatMap((c) => c.cells);
          const bName = rowBase ? 'rows' : 'columns';
          const cName = rowBase ? 'columns' : 'rows';
          const bl = baseLines.map((x) => x + 1);
          const cl = covers.map((x) => x + 1);
          return step(id, {
            eliminations: elims,
            pattern: cells,
            keys: cells.map((cell) => ({ cell, digit: d })),
            units: [...baseLines.map((l) => (rowBase ? l : 9 + l))],
            explanation:
              `${FISH_NAME[n]} on ${d}: in ${bName} ${digitList(bl)}, the ${d} candidates are confined to ${cName} ${digitList(cl)}. ` +
              `Each of those ${n} ${bName} needs a ${d}, and they can only take them from those ${n} ${cName}, ` +
              `so between them they use up every ${d} in ${cName} ${digitList(cl)}. ` +
              `Remove ${d} from the rest of those ${cName}: ${cellList(elims.map((e) => e.cell))}.`,
          });
        }
      }
    }
    return null;
  };
}

// ---------- single-digit patterns ----------

function skyscraper(s: State): Step | null {
  for (let d = 1; d <= 9; d++) {
    for (const rowBase of [true, false]) {
      const base = rowBase ? ROW_UNITS : COL_UNITS;
      const coverIdx = rowBase ? colOf : rowOf;
      const lines: { l: number; cells: number[] }[] = [];
      for (let l = 0; l < 9; l++) {
        const cells = withDigit(s, base[l], d);
        if (cells.length === 2) lines.push({ l, cells });
      }
      for (const [A, B] of combinations(lines, 2)) {
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            const a = A.cells[i];
            const b = B.cells[j];
            const ea = A.cells[1 - i];
            const eb = B.cells[1 - j];
            if (coverIdx(a) !== coverIdx(b) || coverIdx(ea) === coverIdx(eb)) continue;
            const elims = elimDigit(s, commonPeers([ea, eb]), d);
            if (!elims.length) continue;
            const shared = lineLabel(!rowBase, coverIdx(a));
            return step('skyscraper', {
              eliminations: elims,
              pattern: [a, ea, b, eb],
              keys: [
                { cell: a, digit: d, color: 1 },
                { cell: b, digit: d, color: 1 },
                { cell: ea, digit: d },
                { cell: eb, digit: d },
              ],
              units: rowBase ? [A.l, B.l] : [9 + A.l, 9 + B.l],
              explanation:
                `Skyscraper on ${d}: in ${lineLabel(rowBase, A.l)} the ${d} is either ${cellName(a)} or ${cellName(ea)}; ` +
                `in ${lineLabel(rowBase, B.l)} it is either ${cellName(b)} or ${cellName(eb)}. ` +
                `${cellName(a)} and ${cellName(b)} are both in ${shared}, so at most one of them is ${d} — ` +
                `meaning at least one of ${cellName(ea)} or ${cellName(eb)} must be ${d}. ` +
                `Any cell that sees both can't be ${d}: remove ${d} from ${cellList(elims.map((e) => e.cell))}.`,
            });
          }
        }
      }
    }
  }
  return null;
}

function twoStringKite(s: State): Step | null {
  for (let d = 1; d <= 9; d++) {
    const rows: { l: number; cells: number[] }[] = [];
    const cols: { l: number; cells: number[] }[] = [];
    for (let l = 0; l < 9; l++) {
      const r = withDigit(s, ROW_UNITS[l], d);
      if (r.length === 2) rows.push({ l, cells: r });
      const c = withDigit(s, COL_UNITS[l], d);
      if (c.length === 2) cols.push({ l, cells: c });
    }
    for (const R of rows) {
      for (const C of cols) {
        if (R.cells.some((x) => C.cells.includes(x))) continue;
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            const ri = R.cells[i];
            const cj = C.cells[j];
            if (boxOf(ri) !== boxOf(cj)) continue;
            const re = R.cells[1 - i];
            const ce = C.cells[1 - j];
            const elims = elimDigit(s, commonPeers([re, ce]), d);
            if (!elims.length) continue;
            return step('twoStringKite', {
              eliminations: elims,
              pattern: [ri, re, cj, ce],
              keys: [
                { cell: ri, digit: d, color: 1 },
                { cell: cj, digit: d, color: 1 },
                { cell: re, digit: d },
                { cell: ce, digit: d },
              ],
              units: [R.l, 9 + C.l],
              explanation:
                `2-String Kite on ${d}: in row ${R.l + 1} the ${d} is either ${cellName(ri)} or ${cellName(re)}; ` +
                `in column ${C.l + 1} it is either ${cellName(cj)} or ${cellName(ce)}. ` +
                `${cellName(ri)} and ${cellName(cj)} share box ${boxOf(ri) + 1}, so they can't both be ${d} — ` +
                `so at least one of ${cellName(re)} or ${cellName(ce)} is ${d}. ` +
                `Remove ${d} from cells that see both: ${cellList(elims.map((e) => e.cell))}.`,
            });
          }
        }
      }
    }
  }
  return null;
}

function simpleColoring(s: State): Step | null {
  for (let d = 1; d <= 9; d++) {
    const links = strongLinks(s, d);
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
      const keys = comp.map((cell) => ({ cell, digit: d, color: color.get(cell)! }));
      const intro =
        `Simple Colouring on ${d}: following the chain of conjugate pairs (units where ${d} has exactly two spots), ` +
        `the cells alternate between two colours, and exactly one colour holds all the ${d}s. `;

      // Colour wrap: two cells of the same colour see each other.
      for (const c of [0, 1] as const) {
        const same = comp.filter((x) => color.get(x) === c);
        const clash = combinations(same, 2).find(([a, b]) => sees(a, b));
        if (clash) {
          const elims = same.map((cell) => ({ cell, digit: d }));
          return step('simpleColoring', {
            eliminations: elims,
            pattern: comp,
            keys,
            explanation:
              intro +
              `${cellName(clash[0])} and ${cellName(clash[1])} have the same colour but see each other, so that colour can't be the true one. ` +
              `Remove ${d} from every cell of that colour: ${cellList(same)}.`,
          });
        }
      }
      // Colour trap: an uncoloured cell sees both colours.
      const elims: CellDigit[] = [];
      let example: [number, number, number] | null = null;
      for (let i = 0; i < 81; i++) {
        if (!empty(s, i) || !has(s.cands[i], d) || color.has(i)) continue;
        const a = comp.find((x) => color.get(x) === 0 && sees(i, x));
        const b = comp.find((x) => color.get(x) === 1 && sees(i, x));
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
            `${cellName(example[0])} sees ${cellName(example[1])} (one colour) and ${cellName(example[2])} (the other), ` +
            `so whichever colour is true, ${cellName(example[0])} can't be ${d}. ` +
            `Remove ${d} from ${cellList(elims.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

// ---------- wings ----------

function bivalueCells(s: State) {
  const out: number[] = [];
  for (let i = 0; i < 81; i++) if (empty(s, i) && popcount(s.cands[i]) === 2) out.push(i);
  return out;
}

function xyWing(s: State): Step | null {
  const bv = bivalueCells(s);
  for (const p of bv) {
    const [x, y] = digitsOf(s.cands[p]);
    for (const a of bv) {
      if (a === p || !sees(p, a)) continue;
      for (const [link, other] of [
        [x, y],
        [y, x],
      ]) {
        if (!has(s.cands[a], link) || has(s.cands[a], other)) continue;
        const z = firstDigit(s.cands[a] & ~bit(link));
        for (const b of bv) {
          if (b === p || b === a || !sees(p, b)) continue;
          if (s.cands[b] !== (bit(other) | bit(z))) continue;
          const elims = elimDigit(s, commonPeers([a, b]), z);
          if (!elims.length) continue;
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
              `XY-Wing: the pivot ${cellName(p)} is ${link} or ${other}. ` +
              `If it's ${link}, then ${cellName(a)} (${link}/${z}) must be ${z}. ` +
              `If it's ${other}, then ${cellName(b)} (${other}/${z}) must be ${z}. ` +
              `Either way one of ${cellName(a)} or ${cellName(b)} is ${z}, so any cell that sees both can't be ${z}: ` +
              `remove ${z} from ${cellList(elims.map((e) => e.cell))}.`,
          });
        }
      }
    }
  }
  return null;
}

function xyzWing(s: State): Step | null {
  const bv = bivalueCells(s);
  for (let p = 0; p < 81; p++) {
    if (!empty(s, p) || popcount(s.cands[p]) !== 3) continue;
    const pm = s.cands[p];
    const wings = bv.filter((w) => sees(p, w) && (s.cands[w] & ~pm) === 0);
    for (const [a, b] of combinations(wings, 2)) {
      if (s.cands[a] === s.cands[b]) continue;
      const shared = s.cands[a] & s.cands[b];
      if (popcount(shared) !== 1 || (s.cands[a] | s.cands[b]) !== pm) continue;
      const z = firstDigit(shared);
      const elims = elimDigit(s, commonPeers([p, a, b]), z);
      if (!elims.length) continue;
      return step('xyzWing', {
        eliminations: elims,
        pattern: [p, a, b],
        keys: [
          ...digitsOf(pm).map((digit) => ({ cell: p, digit, color: (digit === z ? 0 : 1) as 0 | 1 })),
          ...digitsOf(s.cands[a]).map((digit) => ({ cell: a, digit, color: (digit === z ? 0 : 1) as 0 | 1 })),
          ...digitsOf(s.cands[b]).map((digit) => ({ cell: b, digit, color: (digit === z ? 0 : 1) as 0 | 1 })),
        ],
        explanation:
          `XYZ-Wing: the pivot ${cellName(p)} is ${digitList(digitsOf(pm))}; ${cellName(a)} is ${digitList(digitsOf(s.cands[a]))} ` +
          `and ${cellName(b)} is ${digitList(digitsOf(s.cands[b]))}, both seeing the pivot. ` +
          `If the pivot isn't ${z}, it takes one wing's other digit and forces that wing to ${z}. ` +
          `So one of these three cells is always ${z}, and any cell that sees all three can't be ${z}: ` +
          `remove ${z} from ${cellList(elims.map((e) => e.cell))}.`,
      });
    }
  }
  return null;
}

function wWing(s: State): Step | null {
  const bv = bivalueCells(s);
  for (const [p, q] of combinations(bv, 2)) {
    if (s.cands[p] !== s.cands[q] || sees(p, q)) continue;
    const [x, y] = digitsOf(s.cands[p]);
    for (const [link, elimD] of [
      [x, y],
      [y, x],
    ]) {
      const targets = elimDigit(s, commonPeers([p, q]), elimD);
      if (!targets.length) continue;
      for (const [s1, s2, u] of strongLinks(s, link)) {
        if ([s1, s2].includes(p) || [s1, s2].includes(q)) continue;
        let a = -1;
        let b = -1;
        if (sees(s1, p) && sees(s2, q)) [a, b] = [s1, s2];
        else if (sees(s1, q) && sees(s2, p)) [a, b] = [s2, s1];
        if (a < 0) continue;
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
            `W-Wing: ${cellName(p)} and ${cellName(q)} both contain only ${x}/${y}. ` +
            `In ${unitName(u)}, ${link} must be in ${cellName(a)} or ${cellName(b)}; ${cellName(a)} sees ${cellName(p)} and ${cellName(b)} sees ${cellName(q)}. ` +
            `So ${cellName(p)} and ${cellName(q)} can't both be ${link} — at least one of them is ${elimD}. ` +
            `Remove ${elimD} from cells that see both: ${cellList(targets.map((e) => e.cell))}.`,
        });
      }
    }
  }
  return null;
}

// ---------- uniqueness ----------

function uniqueRectangle(s: State): Step | null {
  for (const [r1, r2] of combinations([...Array(9).keys()], 2)) {
    for (const [c1, c2] of combinations([...Array(9).keys()], 2)) {
      const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
      if (uniq(cells.map(boxOf)).length !== 2) continue;
      if (!cells.every((i) => empty(s, i))) continue;
      const bivals = cells.filter((i) => popcount(s.cands[i]) === 2);
      if (bivals.length !== 3) continue;
      const m = s.cands[bivals[0]];
      if (!bivals.every((i) => s.cands[i] === m)) continue;
      const fourth = cells.find((i) => !bivals.includes(i))!;
      if ((s.cands[fourth] & m) !== m) continue;
      const [a, b] = digitsOf(m);
      const elims = [a, b].map((digit) => ({ cell: fourth, digit }));
      return step('uniqueRectangle', {
        eliminations: elims,
        pattern: cells,
        keys: bivals.flatMap((cell) => [
          { cell, digit: a },
          { cell, digit: b },
        ]),
        explanation:
          `Unique Rectangle: ${cellList(bivals)} all contain only ${a}/${b}, and with ${cellName(fourth)} they form a rectangle across two boxes. ` +
          `If ${cellName(fourth)} were also reduced to ${a}/${b}, the ${a}s and ${b}s could be swapped around the rectangle, giving two solutions. ` +
          `A proper puzzle has exactly one, so ${cellName(fourth)} can't be ${a} or ${b}: remove both.`,
      });
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

/**
 * X-Chain search on digit d. State "cell OFF" -> (strong link) -> "partner ON";
 * "cell ON" -> (weak link) -> "peer OFF". Reaching some end ON from start OFF
 * proves start or end is d.
 */
function searchXChain(s: State, d: number, maxLinks: number): ChainHit | null {
  const nodes = withDigit(s, [...Array(81).keys()], d);
  if (nodes.length < 4) return null;
  const strong = new Map<number, number[]>();
  for (const [a, b] of strongLinks(s, d)) {
    strong.set(a, uniq([...(strong.get(a) ?? []), b]));
    strong.set(b, uniq([...(strong.get(b) ?? []), a]));
  }
  let best: ChainHit | null = null;
  for (const start of strong.keys()) {
    // key = cell*2 + (on ? 1 : 0)
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
        const elims = elimDigit(s, commonPeers([start, cell]), d);
        if (elims.length && (!best || dep < best.path.length - 1)) {
          const path: number[] = [];
          for (let x = k; x !== -1; x = parent.get(x)!) path.unshift(x >> 1);
          best = { path, start, end: cell, elims };
        }
      }
      if (dep >= maxLinks || (best && dep >= best.path.length - 1)) continue;
      const next = on ? nodes.filter((n) => n !== cell && sees(cell, n)) : strong.get(cell) ?? [];
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
  return (s: State): Step | null => {
    for (let d = 1; d <= 9; d++) {
      const hit = searchXChain(s, d, maxLinks);
      if (!hit) continue;
      const { path, start, end, elims } = hit;
      const keys = path.map((cell, idx) => ({ cell, digit: d, color: (idx % 2 === 0 ? 1 : 0) as 0 | 1 }));
      const label = id === 'turbotFish' ? 'Turbot Fish' : 'X-Chain';
      return step(id, {
        eliminations: elims,
        pattern: uniq(path),
        keys,
        explanation:
          `${label} on ${d}: ${path.map(cellName).join(' → ')}. ` +
          `The links alternate between "strong" (the two cells are the only places for ${d} in some row, column or box, so one of them must be ${d}) ` +
          `and "weak" (the two cells see each other, so they can't both be ${d}). ` +
          `If ${cellName(start)} isn't ${d}, the chain forces ${cellName(end)} to be ${d}. ` +
          `So at least one end is ${d}, and any cell seeing both ends can't be: remove ${d} from ${cellList(elims.map((e) => e.cell))}.`,
      });
    }
    return null;
  };
}

const MAX_XY_CHAIN_CELLS = 12;

/** XY-Chain over bivalue cells: if the first cell isn't z, the last is forced to z. */
function xyChain(s: State): Step | null {
  const bv = bivalueCells(s);
  let best: { path: number[]; z: number; elims: CellDigit[] } | null = null;
  for (const start of bv) {
    for (const z of digitsOf(s.cands[start])) {
      // node key = cell*10 + digit that is forced ON in that cell
      const firstOn = firstDigit(s.cands[start] & ~bit(z));
      const k0 = start * 10 + firstOn;
      const parent = new Map<number, number>([[k0, -1]]);
      const depth = new Map<number, number>([[k0, 1]]);
      const queue = [k0];
      while (queue.length) {
        const k = queue.shift()!;
        const cell = Math.floor(k / 10);
        const on = k % 10;
        const dep = depth.get(k)!;
        if (on === z && cell !== start && dep >= 3) {
          const elims = elimDigit(s, commonPeers([start, cell]), z);
          if (elims.length && (!best || dep < best.path.length)) {
            const path: number[] = [];
            for (let x = k; x !== -1; x = parent.get(x)!) path.unshift(Math.floor(x / 10));
            best = { path, z, elims };
          }
        }
        if (dep >= MAX_XY_CHAIN_CELLS || (best && dep >= best.path.length)) continue;
        for (const n of bv) {
          if (n === cell || !sees(cell, n) || !has(s.cands[n], on)) continue;
          const nk = n * 10 + firstDigit(s.cands[n] & ~bit(on));
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
    for (const digit of digitsOf(s.cands[cell])) {
      const isZEnd = (idx === 0 || idx === path.length - 1) && digit === z;
      keys.push({ cell, digit, color: isZEnd ? 0 : 1 });
    }
  });
  const desc = path.map((c) => `${cellName(c)} (${digitsOf(s.cands[c]).join('/')})`).join(' → ');
  return step('xyChain', {
    eliminations: elims,
    pattern: uniq(path),
    keys,
    explanation:
      `XY-Chain: ${desc}. Each cell has exactly two candidates and sees the next one. ` +
      `If ${cellName(start)} isn't ${z}, it must be its other digit, which forces the next cell, and so on down the chain until ${cellName(end)} is forced to be ${z}. ` +
      `So either ${cellName(start)} or ${cellName(end)} is ${z}; any cell seeing both can't be ${z}: ` +
      `remove ${z} from ${cellList(elims.map((e) => e.cell))}.`,
  });
}

// ---------- registry ----------

export const TECHNIQUES: Technique[] = [
  // tier 0: singles (used everywhere; not a difficulty level on their own)
  { id: 'nakedSingle', name: 'Naked Single', tier: 0, find: nakedSingle },
  { id: 'hiddenSingle', name: 'Hidden Single', tier: 0, find: hiddenSingle },
  // tier 1: Medium
  { id: 'pointing', name: 'Pointing', tier: 1, find: pointing },
  { id: 'claiming', name: 'Box/Line Reduction', tier: 1, find: claiming },
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

export function findStep(s: State, maxTier = 4): Step | null {
  for (const t of TECHNIQUES) {
    if (t.tier > maxTier) break;
    const st = t.find(s);
    if (st) return st;
  }
  return null;
}
