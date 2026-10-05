// Runs from `npm version …`: copies the new package.json version into
// app.json (expo.version), which is what the app shows in Settings.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const text = readFileSync('app.json', 'utf8');
// replace only expo.version in place, keeping the file's formatting
const next = text.replace(/("expo"\s*:\s*\{[\s\S]*?"version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
if (next === text && !text.includes(`"version": "${version}"`)) {
  console.error('Could not find expo.version in app.json');
  process.exit(1);
}
writeFileSync('app.json', next);
console.log(`app.json expo.version → ${version}`);
if (!readFileSync('CHANGELOG.md', 'utf8').includes(`## ${version}`)) {
  console.log(`Remember to add a "## ${version}" section to CHANGELOG.md.`);
}
