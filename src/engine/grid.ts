// Core grid geometry and bitmask helpers.
//
// Cells are indexed 0..80, row-major. Candidate sets are bitmasks where
// digit d (1..9) is bit (1 << d). ALL_DIGITS therefore equals 0b1111111110.

export type Grid = number[]; // 81 entries, 0 = empty
export type Cands = number[]; // 81 bitmasks; 0 for filled cells

export const ALL_DIGITS = 0x3fe;
export const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export const rowOf = (i: number) => Math.floor(i / 9);
export const colOf = (i: number) => i % 9;
export const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/** Unit indices: 0-8 rows, 9-17 columns, 18-26 boxes. */
export const UNITS: number[][] = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3;
  const c0 = (b % 3) * 3;
  const cells: number[] = [];
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push((r0 + dr) * 9 + c0 + dc);
  UNITS.push(cells);
}

export const ROW_UNITS = UNITS.slice(0, 9);
export const COL_UNITS = UNITS.slice(9, 18);
export const BOX_UNITS = UNITS.slice(18, 27);

/** For each cell: [rowUnit, colUnit, boxUnit]. */
export const CELL_UNITS: number[][] = Array.from({ length: 81 }, (_, i) => [rowOf(i), 9 + colOf(i), 18 + boxOf(i)]);

export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set<number>();
  for (const u of CELL_UNITS[i]) for (const j of UNITS[u]) if (j !== i) s.add(j);
  return [...s].sort((a, b) => a - b);
});

const PEER_SET: boolean[][] = Array.from({ length: 81 }, (_, i) => {
  const a = new Array<boolean>(81).fill(false);
  for (const j of PEERS[i]) a[j] = true;
  return a;
});

export const sees = (a: number, b: number) => PEER_SET[a][b];

/** Cells (excluding the given ones) that see every cell in `cells`. */
export function commonPeers(cells: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (cells.includes(i)) continue;
    if (cells.every((c) => PEER_SET[i][c])) out.push(i);
  }
  return out;
}

export function popcount(m: number): number {
  let n = 0;
  while (m) {
    m &= m - 1;
    n++;
  }
  return n;
}

export function digitsOf(m: number): number[] {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) out.push(d);
  return out;
}

export const bit = (d: number) => 1 << d;
export const has = (m: number, d: number) => (m & (1 << d)) !== 0;

export function firstDigit(m: number): number {
  for (let d = 1; d <= 9; d++) if (m & (1 << d)) return d;
  return 0;
}

// ---- Naming (used in hint explanations) ----

export const cellName = (i: number) => `R${rowOf(i) + 1}C${colOf(i) + 1}`;
export const cellList = (cells: number[]) => cells.map(cellName).join(', ');

export function unitName(u: number): string {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 8}`;
  return `box ${u - 17}`;
}

export const digitList = (ds: number[]) =>
  ds.length <= 1 ? ds.join('') : ds.slice(0, -1).join(', ') + ' and ' + ds[ds.length - 1];

// ---- Grid parsing / candidate computation ----

export function parseGrid(s: string): Grid {
  const clean = s.replace(/\s/g, '');
  if (clean.length !== 81) throw new Error(`Grid string must have 81 cells, got ${clean.length}`);
  return [...clean].map((ch) => (ch >= '1' && ch <= '9' ? Number(ch) : 0));
}

export const gridToString = (g: Grid) => g.map((v) => (v ? String(v) : '.')).join('');

/** Candidates allowed by the placed values (no other logic). */
export function computeCandidates(g: Grid): Cands {
  const cands = new Array<number>(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    let m = ALL_DIGITS;
    for (const p of PEERS[i]) if (g[p]) m &= ~bit(g[p]);
    cands[i] = m;
  }
  return cands;
}

/** True if no unit contains a repeated digit. */
export function isConsistent(g: Grid): boolean {
  for (const u of UNITS) {
    let seen = 0;
    for (const i of u) {
      const v = g[i];
      if (!v) continue;
      if (seen & bit(v)) return false;
      seen |= bit(v);
    }
  }
  return true;
}

export function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i <= arr.length - (k - cur.length); i++) {
      cur.push(arr[i]);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}
