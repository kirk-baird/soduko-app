import { generateMinimal } from '../src/engine/generator';
import { grade } from '../src/engine/logic';
import { makeRng } from '../src/engine/rng';
import { TECHNIQUES } from '../src/engine/techniques';
const N = Number(process.argv[2] ?? 200);
const rng = makeRng(999);
const hardest: Record<string, number> = {};
const order = TECHNIQUES.map(t => t.id);
for (let i = 0; i < N; i++) {
  const p = generateMinimal(rng);
  const g = grade(p.puzzle);
  let k = 'unsolved';
  if (g.solved) { const used = Object.keys(g.counts); k = order.filter(o => used.includes(o)).pop()!; }
  hardest[k] = (hardest[k] ?? 0) + 1;
}
for (const id of [...order, 'unsolved']) if (hardest[id]) console.log(id.padEnd(16), hardest[id], (100*hardest[id]/N).toFixed(1)+'%');
