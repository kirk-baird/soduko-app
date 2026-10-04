// Pre-generates a bank of graded puzzles bundled with the app so a new game
// starts instantly. The app falls back to on-device generation when a
// difficulty's bank has been fully played.
//   npx tsx scripts/build-bank.ts [perLevel]
import { writeFileSync } from 'node:fs';
import { generateMinimal } from '../src/engine/generator';
import { gridToString } from '../src/engine/grid';
import { DIFFICULTIES, Difficulty, difficultyForTier, grade } from '../src/engine/logic';
import { makeRng } from '../src/engine/rng';

const PER_LEVEL = Number(process.argv[2] ?? 250);
const rng = makeRng(20261004);
const bank: Record<Difficulty, string[]> = { medium: [], hard: [], extraHard: [], extreme: [] };
let attempts = 0;
while (DIFFICULTIES.some((d) => bank[d].length < PER_LEVEL)) {
  attempts++;
  const p = generateMinimal(rng);
  const g = grade(p.puzzle);
  if (!g.solved) continue;
  const d = difficultyForTier(g.maxTier);
  if (d && bank[d].length < PER_LEVEL) bank[d].push(gridToString(p.puzzle).replace(/\./g, '0'));
}
writeFileSync('src/data/puzzleBank.json', JSON.stringify(bank));
console.log(`attempts=${attempts}`, Object.fromEntries(DIFFICULTIES.map((d) => [d, bank[d].length])));
