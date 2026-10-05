// What to show about the running build in Settings. Pure, so it can be tested
// without React Native; src/version.ts feeds it the real values.

export interface BuildEnv {
  version: string; // app.json expo.version, bundled into the JS
  dev: boolean; // __DEV__
  platform: string; // Platform.OS
  updatesEnabled: boolean;
  updateId: string | null;
  channel: string | null;
  createdAt: Date | null;
  embedded: boolean; // running the bundle that shipped inside the installed app
}

export interface BuildInfo {
  version: string; // "1.1.0"
  detail: string; // one line under it
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export function describeBuild(e: BuildEnv): BuildInfo {
  if (e.dev) return { version: e.version, detail: e.platform === 'web' ? 'Development server (web)' : 'Development server' };
  if (e.platform === 'web') return { version: e.version, detail: 'Web build' };
  if (!e.updatesEnabled || !e.updateId) return { version: e.version, detail: 'Installed build' };
  const parts = [e.embedded ? 'Installed build' : `Update ${e.updateId.slice(0, 8)}`];
  if (e.channel) parts.push(e.channel);
  if (e.createdAt && !Number.isNaN(e.createdAt.getTime())) parts.push(fmtDate(e.createdAt));
  return { version: e.version, detail: parts.join(' · ') };
}
