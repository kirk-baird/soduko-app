import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import app from '../app.json';
import { BuildInfo, describeBuild } from './buildInfo';

/**
 * The version comes from app.json and is bundled into the JavaScript, so an
 * over-the-air update carries its own version. Bump it with
 * `npm version patch|minor|major --no-git-tag-version` before each update.
 */
export const APP_VERSION: string = app.expo.version;

export function buildInfo(): BuildInfo {
  let u = { enabled: false, id: null as string | null, channel: null as string | null, createdAt: null as Date | null, embedded: true };
  try {
    u = {
      enabled: Updates.isEnabled,
      id: Updates.updateId ?? null,
      channel: Updates.channel || null,
      createdAt: Updates.createdAt ?? null,
      embedded: Updates.isEmbeddedLaunch,
    };
  } catch {
    // Expo Go / web without the native module: just show the version
  }
  return describeBuild({
    version: APP_VERSION,
    dev: __DEV__,
    platform: Platform.OS,
    updatesEnabled: u.enabled,
    updateId: u.id,
    channel: u.channel,
    createdAt: u.createdAt,
    embedded: u.embedded,
  });
}
