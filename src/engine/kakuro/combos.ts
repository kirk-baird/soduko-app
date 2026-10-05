// Digit-set ("combination") tables and run-consistency helpers.
// Digit sets are bitmasks: digit d is bit (1 << d), so masks fit in 10 bits.

import { digitsOf } from '../common';

/** COMBO_MASKS[len][sum] = all sets of `len` distinct digits 1..9 adding to `sum`. */
const COMBO_MASKS: number[][][] = Array.from({ length: 10 }, () => Array.from({ length: 46 }, () => []));
for (let m = 0; m < 512; m++) {
  let len = 0;
  let sum = 0;
  for (let d = 1; d <= 9; d++) {
    if (m & (1 << (d - 1))) {
      len++;
      sum += d;
    }
  }
  COMBO_MASKS[len][sum].push(m << 1);
}
// Lexicographic order of the ascending digit lists (1+9 before 2+8 ...).
const lex = (a: number, b: number) => {
  for (let d = 1; d <= 9; d++) {
    const x = a & (1 << d);
    const y = b & (1 << d);
    if (x !== y) return x ? -1 : 1;
  }
  return 0;
};
for (const byLen of COMBO_MASKS) for (const list of byLen) list.sort(lex);

const EMPTY: number[] = [];

/** All digit sets (as bitmasks) of `len` distinct digits adding to `sum`. */
export function comboMasks(sum: number, len: number): number[] {
  if (len < 0 || len > 9 || sum < 0 || sum > 45) return EMPTY;
  return COMBO_MASKS[len][sum];
}

const COMBO_CACHE = new Map<number, number[][]>();

/** All ascending digit sets of `length` distinct digits 1..9 adding to `sum` (cached). */
export function combinations(sum: number, length: number): number[][] {
  const key = sum * 16 + length;
  let hit = COMBO_CACHE.get(key);
  if (!hit) {
    hit = comboMasks(sum, length).map((m) => digitsOf(m, 9));
    COMBO_CACHE.set(key, hit);
  }
  return hit;
}

// allowedMask cache: index ((placed >> 1) * 46 + rem) * 10 + k
const ALLOWED = new Int16Array(512 * 46 * 10).fill(-1);

/**
 * Union of the digit sets that complete a run whose empty cells (k of them)
 * must add to `rem`, avoiding the digits already placed (`placed` mask).
 */
export function allowedMask(rem: number, k: number, placed: number): number {
  if (k <= 0 || k > 9 || rem < 0 || rem > 45) return 0;
  const idx = ((placed >> 1) * 46 + rem) * 10 + k;
  let v = ALLOWED[idx];
  if (v < 0) {
    v = 0;
    for (const c of COMBO_MASKS[k][rem]) if (!(c & placed)) v |= c;
    ALLOWED[idx] = v;
  }
  return v;
}

/** Combos for the remaining empty cells of a run, avoiding placed digits. */
export function remainingCombos(rem: number, k: number, placed: number): number[] {
  return comboMasks(rem, k).filter((c) => !(c & placed));
}

// ---- exact single-run consistency (generalised arc consistency) ----

const B_STAMP = Array.from({ length: 11 }, () => new Int32Array(1024));
const F_STAMP = Array.from({ length: 11 }, () => new Int32Array(1024));
let gen = 0;

/**
 * For a run whose cells have candidate masks `doms`, and whose digits must form
 * one of `combos`, compute for each cell the digits that appear in at least one
 * complete assignment (distinct digits, each cell from its own candidates,
 * together forming one of the combos). Writes into `out` (length >= doms.length).
 * Pushes every combo that can be arranged into `okCombos` if given.
 * Returns false if no assignment exists.
 */
export function runSupport(doms: number[], combos: number[], out: number[], okCombos?: number[]): boolean {
  const k = doms.length;
  for (let i = 0; i < k; i++) out[i] = 0;
  let any = false;
  for (const c of combos) {
    let u = 0;
    let bad = false;
    for (let i = 0; i < k; i++) {
      const m = doms[i] & c;
      if (!m) {
        bad = true;
        break;
      }
      u |= m;
    }
    if (bad || u !== c) continue;
    if (++gen > 2_000_000_000) {
      gen = 1;
      for (const a of B_STAMP) a.fill(0);
      for (const a of F_STAMP) a.fill(0);
    }
    const g = gen;
    // Backward: sets of digits the cells i..k-1 can take together.
    B_STAMP[k][0] = g;
    let cur = [0];
    for (let i = k - 1; i >= 0 && cur.length; i--) {
      const next: number[] = [];
      const bs = B_STAMP[i];
      const dm = doms[i] & c;
      for (const m of cur) {
        let avail = dm & ~m;
        while (avail) {
          const b = avail & -avail;
          avail ^= b;
          const nm = m | b;
          if (bs[nm] !== g) {
            bs[nm] = g;
            next.push(nm);
          }
        }
      }
      cur = next;
    }
    if (B_STAMP[0][c] !== g) continue;
    // Forward, keeping only prefixes that can be completed.
    let fw = [0];
    for (let i = 0; i < k; i++) {
      const next: number[] = [];
      const fs = F_STAMP[i + 1];
      const bs = B_STAMP[i + 1];
      const dm = doms[i] & c;
      for (const m of fw) {
        let avail = dm & ~m;
        while (avail) {
          const b = avail & -avail;
          avail ^= b;
          if (bs[c & ~m & ~b] !== g) continue;
          out[i] |= b;
          const nm = m | b;
          if (fs[nm] !== g) {
            fs[nm] = g;
            next.push(nm);
          }
        }
      }
      fw = next;
    }
    okCombos?.push(c);
    any = true;
  }
  return any;
}

export const comboText = (m: number) => digitsOf(m, 9).join('+');
