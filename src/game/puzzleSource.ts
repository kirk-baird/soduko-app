// Where new puzzles come from: the bundled bank first (instant), then
// on-device generation once a difficulty's bank has been played through.

import { Difficulty } from '../engine/common';
import { makeRng } from '../engine/rng';
import { GAMES } from '../games/registry';
import { GameType } from '../games/types';
import { loadRaw, saveJSON } from '../storage';

type PlayedMap = Partial<Record<Difficulty, number[]>>;

export interface PuzzleChoice {
  id: string;
  payload: unknown;
}

/** Yield to the UI thread between generation attempts. */
const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

const playedKey = (t: GameType) => `played.${t}`;

export async function nextPuzzle(type: GameType, difficulty: Difficulty, onProgress?: (attempts: number) => void): Promise<PuzzleChoice> {
  const def = GAMES[type];
  const played = (await loadRaw<PlayedMap>(playedKey(type))) ?? {};
  const used = new Set(played[difficulty] ?? []);
  const list = def.bank()[difficulty] ?? [];
  const unplayed = list.map((_, i) => i).filter((i) => !used.has(i));

  if (unplayed.length) {
    const idx = unplayed[Math.floor(Math.random() * unplayed.length)];
    await saveJSON(playedKey(type), { ...played, [difficulty]: [...used, idx] });
    return { id: `bank-${type}-${difficulty}-${idx}`, payload: def.fromBank(list[idx]) };
  }

  // Bank exhausted: generate on the device, yielding between attempts.
  const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
  const rng = makeRng(seed);
  for (let attempts = 1; ; attempts++) {
    const payload = def.generate(difficulty, rng);
    if (payload) return { id: `gen-${type}-${seed}-${attempts}`, payload };
    // Rare levels can take a long time to hit on a phone: after a while,
    // replay a bank puzzle rather than keep the player waiting.
    if (attempts >= 150 && list.length) {
      const idx = Math.floor(Math.random() * list.length);
      return { id: `bank-${type}-${difficulty}-${idx}-replay-${seed}`, payload: def.fromBank(list[idx]) };
    }
    onProgress?.(attempts);
    await nextTick();
  }
}
