// Pre-generates a bank of graded Calcudoku puzzles bundled with the app so a
// new game starts instantly (the app can fall back to on-device generation).
//   npx tsx scripts/build-calcudoku-bank.ts [perLevel]
import { writeFileSync } from 'node:fs';
import { DIFFICULTY_ORDER, Difficulty } from '../src/engine/common';
import { CalcudokuPuzzle, generate, grade } from '../src/engine/calcudoku';
import { makeRng } from '../src/engine/rng';

const PER_LEVEL = Number(process.argv[2] ?? 60);
const rng = makeRng(20261005);
const bank = {} as Record<Difficulty, CalcudokuPuzzle[]>;
for (const d of DIFFICULTY_ORDER) {
  const t0 = Date.now();
  const list: CalcudokuPuzzle[] = [];
  const tiers: Record<number, number> = {};
  while (list.length < PER_LEVEL) {
    const p = generate(d, rng);
    if (!p) continue;
    list.push(p);
    const t = grade(p).maxTier;
    tiers[t] = (tiers[t] ?? 0) + 1;
  }
  bank[d] = list;
  console.log(`${d}: ${list.length} puzzles in ${((Date.now() - t0) / 1000).toFixed(1)}s, tiers ${JSON.stringify(tiers)}`);
}
writeFileSync('src/data/calcudokuBank.json', JSON.stringify(bank));
