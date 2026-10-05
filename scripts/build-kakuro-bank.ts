// Pre-generates a bank of graded Kakuro puzzles bundled with the app so a new
// game starts instantly. The app falls back to on-device generation when a
// difficulty's bank has been fully played.
//   npx tsx scripts/build-kakuro-bank.ts [perLevel] [maxSecondsPerLevel]
import { writeFileSync } from 'node:fs';
import { DIFFICULTY_ORDER, Difficulty } from '../src/engine/common';
import { KakuroPuzzle, generate } from '../src/engine/kakuro';
import { makeRng } from '../src/engine/rng';

const PER_LEVEL = Number(process.argv[2] ?? 60);
const MAX_SECONDS = Number(process.argv[3] ?? 600);
const rng = makeRng(20261005);
const bank = {} as Record<Difficulty, KakuroPuzzle[]>;
for (const d of DIFFICULTY_ORDER) {
  bank[d] = [];
  const t0 = Date.now();
  while (bank[d].length < PER_LEVEL && Date.now() - t0 < MAX_SECONDS * 1000) {
    const p = generate(d, rng);
    if (p) bank[d].push(p);
  }
  const ms = Date.now() - t0;
  console.log(`${d}: ${bank[d].length} puzzles in ${(ms / 1000).toFixed(1)} s (${(ms / Math.max(1, bank[d].length)).toFixed(0)} ms each)`);
}
const json = JSON.stringify(bank);
writeFileSync('src/data/kakuroBank.json', json);
console.log(`wrote src/data/kakuroBank.json (${(json.length / 1024).toFixed(0)} KB)`);
