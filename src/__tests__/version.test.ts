import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildEnv, describeBuild } from '../buildInfo';

const root = new URL('../../', import.meta.url);
const json = (f: string) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));

const base: BuildEnv = {
  version: '1.2.3',
  dev: false,
  platform: 'android',
  updatesEnabled: true,
  updateId: '0f3c9a12-7b44-4d1e-9a51-2c2f6e0d9b10',
  channel: 'preview',
  createdAt: new Date(2026, 9, 5),
  embedded: false,
};

describe('version', () => {
  it('app.json and package.json agree, and the changelog has an entry for it', () => {
    const v = json('app.json').expo.version;
    expect(json('package.json').version).toBe(v);
    expect(readFileSync(new URL('CHANGELOG.md', root), 'utf8')).toContain(`## ${v}`);
  });

  it('describes an over-the-air update', () => {
    expect(describeBuild(base)).toEqual({ version: '1.2.3', detail: 'Update 0f3c9a12 · preview · 5 Oct 2026' });
  });

  it('describes the bundle that shipped with the install', () => {
    expect(describeBuild({ ...base, embedded: true }).detail).toBe('Installed build · preview · 5 Oct 2026');
    expect(describeBuild({ ...base, updatesEnabled: false, updateId: null }).detail).toBe('Installed build');
  });

  it('describes development and web', () => {
    expect(describeBuild({ ...base, dev: true }).detail).toBe('Development server');
    expect(describeBuild({ ...base, dev: true, platform: 'web' }).detail).toBe('Development server (web)');
    expect(describeBuild({ ...base, platform: 'web' }).detail).toBe('Web build');
  });
});
