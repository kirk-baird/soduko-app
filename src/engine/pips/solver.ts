// Backtracking solver that counts Pips solutions (up to `limit`).
//
// Dominoes are all different, so a solution is a set of placements and each
// one is found exactly once: branch on the open cell with the fewest
// placements that still fit (domino unused, partner cell open, every region it
// touches still satisfiable from partial sums).

import { Frame, MAX_PIP, RegionKind } from './model';

interface Acc {
  kind: RegionKind;
  target: number;
  size: number;
  filled: number;
  sum: number;
  seen: number; // value mask
}

export function solveFrame(f: Frame, limit = 2): { count: number; solution: number[] | null; solutions: number[][] } {
  const covered = new Uint8Array(f.n);
  const used = new Uint8Array(f.doms.length);
  const acc: Acc[] = f.regions.map((r) => ({ kind: r.kind, target: r.target, size: r.cells.length, filled: 0, sum: 0, seen: 0 }));
  const chosen: number[] = [];
  let count = 0;
  const solutions: number[][] = [];

  if (f.n !== 2 * f.doms.length) return { count: 0, solution: null, solutions };

  const fits = (r: Acc, v: number, extra: Acc | null, ev: number): boolean => {
    // `extra` is set when the other half of the domino lands in the same region
    const filled = r.filled + 1 + (extra ? 1 : 0);
    const sum = r.sum + v + (extra ? ev : 0);
    const left = r.size - filled;
    switch (r.kind) {
      case 'sum':
        return sum <= r.target && sum + MAX_PIP * left >= r.target;
      case 'less':
        return sum < r.target;
      case 'greater':
        return sum + MAX_PIP * left > r.target;
      case 'equal': {
        const m = r.seen | (1 << v) | (extra ? 1 << ev : 0);
        return (m & (m - 1)) === 0;
      }
      case 'unequal':
        if (r.seen & (1 << v)) return false;
        return !extra || (v !== ev && !(r.seen & (1 << ev)));
    }
  };

  const ok = (pid: number): boolean => {
    const pl = f.places[pid];
    if (used[pl.d] || covered[pl.u] || covered[pl.v]) return false;
    const ru = f.regionOf[pl.u];
    const rv = f.regionOf[pl.v];
    if (ru >= 0 && ru === rv) return fits(acc[ru], pl.a, acc[ru], pl.b);
    if (ru >= 0 && !fits(acc[ru], pl.a, null, 0)) return false;
    if (rv >= 0 && !fits(acc[rv], pl.b, null, 0)) return false;
    return true;
  };

  const apply = (pid: number, sign: 1 | -1) => {
    const pl = f.places[pid];
    used[pl.d] = sign > 0 ? 1 : 0;
    covered[pl.u] = covered[pl.v] = sign > 0 ? 1 : 0;
    for (const [c, val] of [
      [pl.u, pl.a],
      [pl.v, pl.b],
    ]) {
      const r = f.regionOf[c];
      if (r < 0) continue;
      const a = acc[r];
      a.filled += sign;
      a.sum += sign * val;
      if (a.kind === 'equal' || a.kind === 'unequal') {
        // values in an equal/unequal region are recomputed from scratch on undo
        if (sign > 0) a.seen |= 1 << val;
      }
    }
  };

  const recomputeSeen = (r: number) => {
    const a = acc[r];
    a.seen = 0;
    for (const pid of chosen) {
      const pl = f.places[pid];
      if (f.regionOf[pl.u] === r) a.seen |= 1 << pl.a;
      if (f.regionOf[pl.v] === r) a.seen |= 1 << pl.b;
    }
  };

  const dfs = (depth: number) => {
    if (count >= limit) return;
    if (depth === f.doms.length) {
      count++;
      solutions.push(chosen.slice());
      return;
    }
    let best = -1;
    let bestList: number[] = [];
    for (let c = 0; c < f.n; c++) {
      if (covered[c]) continue;
      const list: number[] = [];
      for (const pid of f.byCell[c]) {
        if (ok(pid)) list.push(pid);
        if (best >= 0 && list.length >= bestList.length) break;
      }
      if (best < 0 || list.length < bestList.length) {
        best = c;
        bestList = list;
        if (!list.length) return;
      }
    }
    for (const pid of bestList) {
      apply(pid, 1);
      chosen.push(pid);
      dfs(depth + 1);
      chosen.pop();
      apply(pid, -1);
      const pl = f.places[pid];
      for (const c of [pl.u, pl.v]) {
        const r = f.regionOf[c];
        if (r >= 0 && (acc[r].kind === 'equal' || acc[r].kind === 'unequal')) recomputeSeen(r);
      }
      if (count >= limit) return;
    }
  };

  dfs(0);
  return { count, solution: solutions[0] ?? null, solutions };
}
