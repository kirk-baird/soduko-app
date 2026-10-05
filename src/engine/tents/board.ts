// Shared geometry, board state and tree/tent matching helpers for Tents.
//
// Cell states (internal): UNK = undecided, TENT, GRASS, TREE. The public
// `marks` array uses 0/1/2 for unknown/tent/grass and ignores tree cells.

export const UNK = 0;
export const TENT = 1;
export const GRASS = 2;
export const TREE = 3;

export interface Geo {
  rows: number;
  cols: number;
  n: number;
  orth: number[][]; // up/down/left/right neighbours
  adj8: number[][]; // all 8 neighbours
  rowCells: number[][];
  colCells: number[][];
}

const geoCache = new Map<string, Geo>();

export function geo(rows: number, cols: number): Geo {
  const key = `${rows}x${cols}`;
  const hit = geoCache.get(key);
  if (hit) return hit;
  const n = rows * cols;
  const orth: number[][] = [];
  const adj8: number[][] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const o: number[] = [];
    const a: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        a.push(rr * cols + cc);
        if (!dr || !dc) o.push(rr * cols + cc);
      }
    }
    orth.push(o);
    adj8.push(a);
  }
  const rowCells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => r * cols + c));
  const colCells = Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => r * cols + c));
  const g = { rows, cols, n, orth, adj8, rowCells, colCells };
  geoCache.set(key, g);
  return g;
}

export interface Line {
  kind: 'row' | 'col';
  index: number;
  cells: number[];
  need: number;
  name: string; // 'row 3' / 'column 5'
}

/** Static puzzle data used by the solver and the rules. */
export interface Frame {
  g: Geo;
  trees: number[];
  isTree: boolean[];
  treeNbrs: number[][]; // per cell: orthogonally adjacent trees
  rowCounts: number[];
  colCounts: number[];
  lines: Line[]; // rows then columns
}

export interface PuzzleShape {
  rows: number;
  cols: number;
  trees: number[];
  rowCounts: number[];
  colCounts: number[];
}

export function makeFrame(p: PuzzleShape): Frame {
  const g = geo(p.rows, p.cols);
  const isTree = new Array<boolean>(g.n).fill(false);
  for (const t of p.trees) isTree[t] = true;
  const treeNbrs = g.orth.map((o) => o.filter((j) => isTree[j]));
  const lines: Line[] = [
    ...g.rowCells.map((cells, r) => ({ kind: 'row' as const, index: r, cells, need: p.rowCounts[r], name: `row ${r + 1}` })),
    ...g.colCells.map((cells, c) => ({ kind: 'col' as const, index: c, cells, need: p.colCounts[c], name: `column ${c + 1}` })),
  ];
  return { g, trees: p.trees.slice(), isTree, treeNbrs, rowCounts: p.rowCounts, colCounts: p.colCounts, lines };
}

/** Initial cell states: trees fixed, everything else undecided. */
export function blankCells(f: Frame): number[] {
  return f.isTree.map((t) => (t ? TREE : UNK));
}

/** Convert player marks (0/1/2) to internal cell states. */
export function cellsFromMarks(f: Frame, marks: number[]): number[] {
  return f.isTree.map((t, i) => (t ? TREE : marks[i] === TENT ? TENT : marks[i] === GRASS ? GRASS : UNK));
}

// ---------- matching ----------

export interface HallViolation {
  side: 'trees' | 'tents';
  left: number[]; // trees (side 'trees') or tents (side 'tents')
  right: number[]; // the spots / trees they can use between them (fewer than `left`)
}

/**
 * Checks that every tree can get its own spot among tents and undecided cells,
 * and that every tent can get its own tree. By the Mendelsohn–Dulmage theorem
 * these two together mean a matching exists that covers all trees and all
 * placed tents at once. Returns a (minimal) Hall violation, or null if fine.
 */
export function hallCheck(f: Frame, cells: number[]): HallViolation | null {
  const spotsOf = (t: number) => f.g.orth[t].filter((j) => cells[j] === TENT || cells[j] === UNK);
  const v = kuhn(f.trees, spotsOf);
  if (v) return { side: 'trees', ...minimise(v.left, spotsOf) };
  const tents: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === TENT) tents.push(i);
  const treesOf = (t: number) => f.treeNbrs[t];
  const w = kuhn(tents, treesOf);
  if (w) return { side: 'tents', ...minimise(w.left, treesOf) };
  return null;
}

function kuhn(left: number[], adj: (u: number) => number[]): { left: number[] } | null {
  const mate = new Map<number, number>(); // right -> left
  const adjCache = new Map<number, number[]>();
  const nb = (u: number) => {
    let a = adjCache.get(u);
    if (!a) adjCache.set(u, (a = adj(u)));
    return a;
  };
  for (const u of left) {
    const seenR = new Set<number>();
    const seenL: number[] = [];
    const tryU = (x: number): boolean => {
      seenL.push(x);
      for (const v of nb(x)) {
        if (seenR.has(v)) continue;
        seenR.add(v);
        const m = mate.get(v);
        if (m === undefined || tryU(m)) {
          mate.set(v, x);
          return true;
        }
      }
      return false;
    };
    if (!tryU(u)) return { left: seenL };
  }
  return null;
}

function minimise(left: number[], adj: (u: number) => number[]): { left: number[]; right: number[] } {
  let set = left.slice();
  const nbrs = (s: number[]) => [...new Set(s.flatMap(adj))];
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < set.length; k++) {
      const trial = set.filter((_, j) => j !== k);
      if (trial.length && nbrs(trial).length < trial.length) {
        set = trial;
        changed = true;
        break;
      }
    }
  }
  return { left: set.sort((a, b) => a - b), right: nbrs(set).sort((a, b) => a - b) };
}

// ---------- obvious pairs ----------

export interface Pairs {
  tentOf: Map<number, number>; // tree -> tent
  treeOf: Map<number, number>; // tent -> tree
}

/**
 * Tree/tent pairs that are certain from local reasoning alone:
 *  - a tent with only one tree next to it that isn't already taken belongs to that tree;
 *  - a tree with no undecided neighbours and only one untaken tent next to it owns that tent.
 */
export function obviousPairs(f: Frame, cells: number[]): Pairs {
  const tentOf = new Map<number, number>();
  const treeOf = new Map<number, number>();
  const tents: number[] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === TENT) tents.push(i);
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tents) {
      if (treeOf.has(t)) continue;
      const free = f.treeNbrs[t].filter((tr) => !tentOf.has(tr));
      if (free.length === 1) {
        tentOf.set(free[0], t);
        treeOf.set(t, free[0]);
        changed = true;
      }
    }
    for (const tr of f.trees) {
      if (tentOf.has(tr)) continue;
      const o = f.g.orth[tr];
      if (o.some((j) => cells[j] === UNK)) continue;
      const free = o.filter((j) => cells[j] === TENT && !treeOf.has(j));
      if (free.length === 1) {
        tentOf.set(tr, free[0]);
        treeOf.set(free[0], tr);
        changed = true;
      }
    }
  }
  return { tentOf, treeOf };
}

// ---------- text helpers ----------

export const cellName = (i: number, cols: number) => `R${Math.floor(i / cols) + 1}C${(i % cols) + 1}`;

export function listNames(cells: number[], cols: number, max = 6): string {
  const names = cells.slice(0, max).map((c) => cellName(c, cols));
  const extra = cells.length - names.length;
  if (extra > 0) return `${names.join(', ')} and ${extra} more`;
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
