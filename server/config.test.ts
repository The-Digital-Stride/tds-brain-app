import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveConfig } from './config.ts';
import { defaultDataDir, writeSettings } from './settings.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-config-'));
  tempDirs.push(dir);
  return dir;
}

const APP_ROOT = join(import.meta.dirname, '..');

describe('resolveConfig', () => {
  it('keeps data in Application Support by default, not in the app folder', () => {
    const home = tempDir();
    const config = resolveConfig({}, APP_ROOT, home);
    expect(config.dataDir).toBe(defaultDataDir(home));
    expect(existsSync(join(defaultDataDir(home), 'runtime.json'))).toBe(true);
  });

  it('lets TDS_BRAIN_APP_DATA override the data folder, with ~ against home', () => {
    const home = tempDir();
    expect(resolveConfig({ TDS_BRAIN_APP_DATA: '~/dev-data' }, APP_ROOT, home).dataDir).toBe(
      join(home, 'dev-data'),
    );
    const other = tempDir();
    expect(resolveConfig({ TDS_BRAIN_APP_DATA: other }, APP_ROOT, home).dataDir).toBe(other);
  });

  it('takes the brain from settings.json in the data folder', () => {
    const home = tempDir();
    writeSettings(defaultDataDir(home), { brainPath: join(home, 'Documents', 'brain') });
    const config = resolveConfig({}, APP_ROOT, home);
    expect(config.brainCandidate).toEqual({ path: join(home, 'Documents', 'brain'), source: 'settings' });
    expect(config).not.toHaveProperty('brainPath');
  });

  it('lets TDS_BRAIN_PATH win over settings', () => {
    const home = tempDir();
    writeSettings(defaultDataDir(home), { brainPath: join(home, 'Documents', 'brain') });
    const config = resolveConfig({ TDS_BRAIN_PATH: '~/other' }, APP_ROOT, home);
    expect(config.brainCandidate).toEqual({ path: join(home, 'other'), source: 'env' });
  });

  it('names ~/agencybrain as the unchecked candidate when settings are missing or broken', () => {
    const home = tempDir();
    expect(resolveConfig({}, APP_ROOT, home).brainCandidate).toEqual({
      path: join(home, 'agencybrain'),
      source: 'default',
    });
    writeFileSync(join(defaultDataDir(home), 'settings.json'), '{ broken');
    expect(resolveConfig({}, APP_ROOT, home).brainCandidate.source).toBe('default');
  });

  it('knows when it runs under the service', () => {
    const home = tempDir();
    expect(resolveConfig({}, APP_ROOT, home).underService).toBe(false);
    expect(resolveConfig({ TDS_BRAIN_SERVICE: '0' }, APP_ROOT, home).underService).toBe(false);
    expect(resolveConfig({ TDS_BRAIN_SERVICE: 'true' }, APP_ROOT, home).underService).toBe(false);
    expect(resolveConfig({ TDS_BRAIN_SERVICE: '1' }, APP_ROOT, home).underService).toBe(true);
  });
});
