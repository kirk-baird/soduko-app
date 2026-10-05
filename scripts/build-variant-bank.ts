// Pre-generates sudoku-variant puzzles (windoku, jigsaw, 16×16, samurai).
//   npx tsx scripts/build-variant-bank.ts <variant> [perLevel=40] [minutes=20]
// Writes src/data/<variant>Bank.json as Record<Difficulty, {p, s, r?}[]> with
// encoded puzzle (p), solution (s) and jigsaw regions (r). Progress is saved
// as it goes, so a partial run is still usable.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateVariant } from '../src/engine/generator';
import { DIFFICULTIES, Difficulty } from '../src/engine/logic';
import { makeRng } from '../src/engine/rng';
import { encodeValues } from '../src/engine/sudoku/core';

type Entry = { p: string; s: string; r?: string };
const variant = process.argv[2] as 'windoku' | 'jigsaw' | 'sixteen' | 'samurai';
const perLevel = Number(process.argv[3] ?? 40);
const minutes = Number(process.argv[4] ?? 20);
const file = `src/data/${variant}Bank.json`;
const bank: Record<Difficulty, Entry[]> = existsSync(file)
  ? JSON.parse(readFileSync(file, 'utf8'))
  : { medium: [], hard: [], extraHard: [], extreme: [] };
const rng = makeRng(20261005 + variant.length * 1000 + Object.values(bank).flat().length);
const deadline = Date.now() + minutes * 60_000;
let attempts = 0;
let lastSave = Date.now();
while (Date.now() < deadline) {
  const need = DIFFICULTIES.filter((d) => bank[d].length < perLevel);
  if (!need.length) break;
  for (const d of need) {
    attempts++;
    const p = generateVariant(variant, d, rng);
    if (p) bank[d].push({ p: encodeValues(p.puzzle), s: encodeValues(p.solution), ...(p.regions ? { r: p.regions.join('') } : {}) });
  }
  if (Date.now() - lastSave > 20_000) {
    writeFileSync(file, JSON.stringify(bank));
    lastSave = Date.now();
    console.log(new Date().toISOString().slice(11, 19), variant, attempts, Object.fromEntries(DIFFICULTIES.map((d) => [d, bank[d].length])));
  }
}
writeFileSync(file, JSON.stringify(bank));
console.log('done', variant, attempts, Object.fromEntries(DIFFICULTIES.map((d) => [d, bank[d].length])));
