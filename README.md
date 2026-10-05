# Sudokou

A free, ad-free logic-puzzle app for Android (and iOS) built with Expo / React
Native: classic sudoku plus Jigsaw, Windoku, 16×16 and Samurai sudoku,
Calcudoku, Kakuro and Tents. Difficulty is graded by the solving techniques a
puzzle needs, hints explain the next deduction from *your* pencil marks, and
games can auto-finish once only the simplest steps remain.

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

## Versioning and updates

The version lives in `package.json` and `app.json` (kept in sync) and is shown
at the bottom of Settings, with the update ID, channel and date on an installed
app. Every update gets a new version:

```bash
npm version patch --no-git-tag-version   # or minor / major; also updates app.json
# add a "## x.y.z" section with bullet points to CHANGELOG.md
git commit -am "x.y.z: …" && git push
```

Pushing to `master` runs `.github/workflows/eas-update.yml`: typecheck, lint
and tests, then, if this version hasn't been published to `preview` yet, an
`eas update` with the message "vx.y.z: <changelog bullets>". It then tags the
commit `preview-vx.y.z`. A push without a version bump only runs the checks.
To publish to production, open the workflow on GitHub's Actions tab and use
"Run workflow" with channel `production`.

The workflow needs a repository secret `EXPO_TOKEN`: create a token at
expo.dev (Account settings → Access tokens), then add it in GitHub under
Settings → Secrets and variables → Actions.

To publish from your own machine instead: `npm run update:preview` or
`npm run update:production`.

The runtime version is pinned in `app.json` (`"runtimeVersion": "1.0.0"`).
An installed app only accepts updates with the same runtime version, so the app
version can change freely while installed APKs keep receiving updates. Change
the runtime version only when native code changes (an SDK upgrade or a new
native module), and then build and install a new APK. Expo Go can't open these
updates (it only opens updates whose runtime is its own SDK); use
`npx expo start` to try changes in Expo Go.

## Development

```bash
npm test            # engine + game-state tests (vitest)
npm run typecheck   # tsc
npm run web         # run in a browser
npm run build-bank  # regenerate the classic puzzle bank (src/data/puzzleBank.json)
npm run survey      # stats on which technique each random classic puzzle needs
npx tsx scripts/build-variant-bank.ts <windoku|jigsaw|sixteen|samurai> [perLevel] [minutes]
npx tsx scripts/build-calcudoku-bank.ts | build-kakuro-bank.ts | build-tents-bank.ts
```

## Layout

```
App.tsx                       screens: home → game type → game; Android back button
src/games/registry.ts         every game type: name, rules text, levels, bank, generator, adapters
src/engine/common.ts          shared types (PuzzleStep, PuzzleHint, DigitRules, Difficulty)
src/engine/sudoku/geometry.ts cells and units for classic, windoku, jigsaw, 16×16, samurai
src/engine/techniques.ts      human techniques for all sudoku variants (geometry-aware)
src/engine/logic.ts, hint.ts, solver.ts, generator.ts   grading, hints, solver, generation
src/engine/calcudoku/         Calcudoku solver, generator, techniques, hints
src/engine/kakuro/            Kakuro solver, generator, techniques, hints
src/engine/tents/             Tents solver, generator, rules, hints
src/game/gameState.ts         digit-puzzle reducer (bound to a puzzle's rules)
src/game/tentsState.ts        Tents reducer
src/game/puzzleSource.ts      bundled bank first, on-device generation afterwards
src/components/               Board (any digit puzzle), TentsBoard, Cell, controls, hint panel
src/screens/                  Home, Type (levels + how to play), Game, Tents, Settings
src/data/*Bank.json           pre-generated graded puzzles per game type
```
