// Publish an over-the-air update labelled with the app version and the
// changelog notes for it:
//   npm run update:preview
//   npm run update:production
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const channel = process.argv[2];
if (!channel) {
  console.error('Usage: node scripts/publish-update.mjs <channel>');
  process.exit(1);
}

const version = JSON.parse(readFileSync('app.json', 'utf8')).expo.version;
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version}`));
if (!section) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Bump the version (npm version patch --no-git-tag-version) and describe the update first.`);
  process.exit(1);
}
const notes = section
  .split('\n')
  .slice(1)
  .filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2).trim())
  .join('; ');
const message = `v${version}${notes ? `: ${notes}` : ''}`.slice(0, 500);

console.log(`Publishing ${message}\n  to channel "${channel}"`);
if (process.env.DRY_RUN) process.exit(0);
const r = spawnSync('npx', ['eas-cli@latest', 'update', '--channel', channel, '--message', message], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
