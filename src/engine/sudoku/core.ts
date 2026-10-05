// Geometry-aware basics shared by the solver, grader and hints.
import { Geometry } from './geometry';

/** Candidates allowed by the placed values (no other logic). */
export function legalCandidates(g: Geometry, values: number[]): number[] {
  const cands = new Array<number>(g.cellCount).fill(0);
  for (let i = 0; i < g.cellCount; i++) {
    if (values[i]) continue;
    let m = g.all;
    for (const p of g.peers[i]) if (values[p]) m &= ~(1 << values[p]);
    cands[i] = m;
  }
  return cands;
}

/** True if no unit contains a repeated digit. */
export function isConsistent(g: Geometry, values: number[]): boolean {
  for (const u of g.units) {
    let seen = 0;
    for (const i of u) {
      const v = values[i];
      if (!v) continue;
      if (seen & (1 << v)) return false;
      seen |= 1 << v;
    }
  }
  return true;
}

/** Encode values as a compact string: 0 = empty, 1-9, A-G for 10-16. */
export const encodeValues = (values: number[]) => values.map((v) => '0123456789ABCDEFG'[v]).join('');
export const decodeValues = (s: string) => [...s].map((ch) => parseInt(ch, 17));
