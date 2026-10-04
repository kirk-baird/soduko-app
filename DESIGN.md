# Sudokou: design notes

## Goals

1. **Free forever.** No ads, no level packs. Puzzles are generated on-device, so
   the supply never runs out.
2. **Auto-finish when only singles are left.** Once the rest of the grid can be
   filled with naked and hidden singles alone, a button finishes it.

## Features

| Feature | How it works |
|---|---|
| Givens look different | Starting digits get a warmer cell background and darker, bolder digits. Your digits are blue. |
| Pencil marks | Pencil toggle in the toolbar. Long-press any number to enter it in the *other* mode without toggling. |
| Difficulty by technique | Medium / Hard / Extra Hard / Extreme. A puzzle's level is the hardest technique the grader needs (table below). |
| Timer | Pauses when you tap it, open settings, or background the app. Best time per difficulty is kept. |
| Row / column / box highlight | Always on for the selected cell. |
| Identical numbers | Selecting a filled 8 highlights every other 8. |
| Candidate hint | Finds the easiest deduction from **your current pencil marks** and explains it. The board highlights the pattern (yellow), the reason candidates (green/orange) and what to remove (red, struck through). *Apply* carries it out. |
| Undo | Steps back one action. |
| Rewind | Jumps back to just before your **first mistake that is still on the board**. |
| Auto-finish | Offered when no placed digit is wrong and singles alone complete the grid. Fills cells one by one. |
| Settings: error detection | Wrong digits turn red and a mistake counter appears in the header. |
| Settings: auto candidates | Every empty cell is kept filled with its legal candidates; you remove them as you eliminate. Turning it on mid-game fills the empty cells. |
| Settings: highlight matching candidates | Selecting a filled 8 also circles every 8 pencil mark. |
| Also | Light/dark/system theme, haptics, autosave + Continue, Android back button. |

## Difficulty levels

The grader solves the puzzle the way a person would, always using the easiest
technique that makes progress. The level is the tier of the hardest technique
it needed. Puzzles that need only singles are too easy for Medium and are not
offered. Puzzles beyond the engine's techniques are rejected, so a hint can
always be given.

| Level | Hardest technique needed is one of | Share of random puzzles |
|---|---|---|
| Medium | Pointing, Box/Line Reduction, Naked Pair, Hidden Pair | ~9% |
| Hard | Naked/Hidden Triple, X-Wing, Skyscraper, 2-String Kite, Turbot Fish, XY-Wing, Naked/Hidden Quad | ~8% |
| Extra Hard | XYZ-Wing, W-Wing, Swordfish, Simple Colouring, Unique Rectangle | ~3% |
| Extreme | X-Chain, XY-Chain, Jellyfish | ~5% |

(The rest are singles-only, about 68%, or need techniques the engine doesn't
know yet, about 6%.) Tiers follow common conventions such as HoDoKu's ratings.
They can be changed in `TECHNIQUES` in `src/engine/techniques.ts`. Re-run
`npm run survey` and `npm run build-bank` after changing them.

## Puzzle supply

- 250 pre-graded puzzles per level ship in `src/data/puzzleBank.json` (84 KB), so a
  new game starts instantly. Played puzzles are remembered.
- When a level's bank is used up, the app generates puzzles on the device: a random
  solved grid, then clues removed with 180° symmetry while the solution stays
  unique, then graded. In Node that takes about 5 ms per attempt. Extra Hard (~3%)
  needs ~30 attempts on average, which should be roughly a second on a phone.
  A "Preparing puzzle" dialog covers the wait.

## Hints from your own candidates

`findHint(values, pencil, solution, removedCorrect)` runs these checks in order:

1. **Wrong digit placed**: point it out (logic built on it would be misleading).
2. **Correct candidate removed**: if you removed the right digit from a cell's
   pencil marks and it's still missing, say so and offer Rewind.
3. **Clean-up**: pencil marks that clash with a placed digit in the same unit.
4. **Technique**: the easiest technique that applies to your candidates.

Cells with no pencil marks are treated as holding every legal candidate. Cells
whose marks are incomplete (you've been adding them one by one) are treated the
same way. Neither is reported as a mistake.

## What counts as a mistake (for Rewind)

Each action in the history records the mistakes it introduced:

- placing a digit that isn't the solution digit, or
- toggling **off** the correct candidate in a cell's pencil marks.

Adding pencil marks is never a mistake. Rewind finds the earliest recorded
mistake whose effect is still on the board and restores the state just before
it. Mistakes you have already fixed yourself are ignored, so Rewind doesn't
throw away good work. The mistake counter keeps its total.

## Engine notes

- Candidates are 9-bit masks (`1 << digit`); units are 27 precomputed cell lists.
- The backtracking solver uses minimum-remaining-values and stops at 2 solutions
  for uniqueness checks.
- Chains (Turbot Fish, X-Chain, XY-Chain) are found by breadth-first search over
  implications ("cell is/isn't d"). This finds the shortest chain and is cheap
  enough to run on a phone.
- Tests check soundness: on every intermediate state of 400 random puzzles,
  **every** technique's deductions are checked against the known solution.

## Ideas for later

- More techniques (ALS-XZ, finned fish, AIC with grouped nodes, forcing chains),
  so fewer puzzles are rejected and Extreme gets harder.
- A two-step hint: name the technique and region first, then reveal the full step.
- Number-first input mode.
- Daily puzzle, a stats screen, a notes colour palette.
