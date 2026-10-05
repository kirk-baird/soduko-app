// Pre-generates a bank of graded Tents puzzles bundled with the app so a new
// game starts instantly (the app can fall back to on-device generation).
//   npx tsx scripts/build-tents-bank.ts [perLevel]
import { writeFileSync } from 'node:fs';
import { DIFFICULTY_ORDER, Difficulty } from '../src/engine/common';
import { makeRng } from '../src/engine/rng';
import { TentsPuzzle, generate, grade } from '../src/engine/tents';

const PER_LEVEL = Number(process.argv[2] ?? 60);
const bank = {} as Record<Difficulty, TentsPuzzle[]>;
for (const d of DIFFICULTY_ORDER) {
  const rng = makeRng(20261005 + DIFFICULTY_ORDER.indexOf(d));
  const list: TentsPuzzle[] = [];
  const tiers: Record<number, number> = {};
  const t0 = Date.now();
  let failures = 0;
  while (list.length < PER_LEVEL) {
    const p = generate(d, rng);
    if (!p) {
      failures++;
      continue;
    }
    const t = grade(p).maxTier;
    tiers[t] = (tiers[t] ?? 0) + 1;
    list.push(p);
  }
  bank[d] = list;
  const ms = (Date.now() - t0) / PER_LEVEL;
  console.log(`${d}: ${list.length} puzzles, ${ms.toFixed(0)} ms/puzzle, tiers ${JSON.stringify(tiers)}, failed calls ${failures}`);
}
writeFileSync('src/data/tentsBank.json', JSON.stringify(bank));
