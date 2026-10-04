# Sudokou

A free, ad-free sudoku app for Android (and iOS) built with Expo / React Native.
Difficulty is graded by the solving techniques a puzzle needs, hints explain the
next deduction from *your* pencil marks, and the game can auto-finish once only
singles remain.

See [DESIGN.md](DESIGN.md) for how it works.

## Run it on your phone (fastest)

Requirements: Node 20.19+ / 22.13+ / 24.3+, and the **Expo Go** app from the
Play Store on your Galaxy S25 (App Store for iOS).

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go. Phone and computer need to be on the same
network. If they can't see each other, use `npx expo start --tunnel`.

Code edits reload live on the phone.

## Install it as a real app (APK)

Expo Go is great for development. For a standalone app icon on your home
screen, build an APK in Expo's cloud (needs a free Expo account):

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

When it finishes, open the download link on the phone and install the APK.
(With the Android SDK installed locally, `npx expo run:android` also works.)

## Development

```bash
npm test            # engine + game-state tests (vitest)
npm run typecheck   # tsc
npm run web         # run in a browser
npm run build-bank  # regenerate the bundled puzzle bank (src/data/puzzleBank.json)
npm run survey      # stats on which technique each random puzzle needs
```

## Layout

```
App.tsx                     screen switching, new-game flow, Android back button
src/engine/                 pure TypeScript, no React
  grid.ts                   geometry, bitmask candidates, naming (R3C5, box 4…)
  solver.ts                 backtracking solver (uniqueness + solution)
  techniques.ts             human techniques; each returns a Step with an explanation
  logic.ts                  difficulty grading, singles-only autocomplete check
  hint.ts                   hint from the player's own pencil marks
  generator.ts              random symmetric minimal puzzles
src/game/gameState.ts       reducer: input, pencil, undo, rewind-to-first-mistake, hints
src/game/puzzleSource.ts    bundled bank first, on-device generation afterwards
src/components/             Board, Cell, NumberPad, toolbar, HintPanel, Dialog
src/screens/                Home, Game, Settings
src/data/puzzleBank.json    250 graded puzzles per difficulty
```
