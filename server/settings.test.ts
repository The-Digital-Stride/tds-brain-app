import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  defaultDataDir,
  installedAppDir,
  readSettings,
  resolveBrainPath,
  resolveDataDir,
  supportDir,
  writeSettings,
} from './settings.ts';

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-settings-'));
  tempDirs.push(dir);
  return dir;
}

describe('folders', () => {
  it('puts the app and the data side by side in Application Support', () => {
    expect(supportDir('/Users/sam')).toBe('/Users/sam/Library/Application Support/TDS Brain');
    expect(defaultDataDir('/Users/sam')).toBe('/Users/sam/Library/Application Support/TDS Brain/data');
    expect(installedAppDir('/Users/sam')).toBe('/Users/sam/Library/Application Support/TDS Brain/app');
  });
});

describe('readSettings', () => {
  it('gives {} when the folder or the file is missing', () => {
    expect(readSettings(join(tempDir(), 'nope'))).toEqual({});
    expect(readSettings(tempDir())).toEqual({});
  });

  it('gives {} for broken JSON or a value that is not an object', () => {
    for (const raw of ['{ not json', 'null', '[]', '"text"', '42', '']) {
      const dir = tempDir();
      writeFileSync(join(dir, 'settings.json'), raw);
      expect(readSettings(dir)).toEqual({});
    }
  });

  it('gives {} when settings.json is a folder', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'settings.json'));
    expect(readSettings(dir)).toEqual({});
  });

  it('drops a brainPath that is not a non-empty string', () => {
    for (const brainPath of [42, null, '', '   ', ['/a']]) {
      const dir = tempDir();
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ brainPath }));
      expect(readSettings(dir)).toEqual({});
    }
  });

  it('reads a saved brainPath', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ brainPath: '/Users/sam/brain', extra: 1 }));
    expect(readSettings(dir)).toEqual({ brainPath: '/Users/sam/brain' });
  });
});

describe('writeSettings', () => {
  it('creates the folder 0700 and the file 0600, and round-trips', () => {
    const dataDir = join(tempDir(), 'TDS Brain', 'data');
    writeSettings(dataDir, { brainPath: '/Users/sam/brain' });
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dataDir, 'settings.json')).mode & 0o777).toBe(0o600);
    expect(readSettings(dataDir)).toEqual({ brainPath: '/Users/sam/brain' });
  });

  it('replaces the file in one step and leaves no temp file behind', () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, 'settings.json'), '{ broken', { mode: 0o644 });
    writeSettings(dataDir, { brainPath: '/a' });
    writeSettings(dataDir, { brainPath: '/b' });
    expect(readSettings(dataDir)).toEqual({ brainPath: '/b' });
    expect(readdirSync(dataDir)).toEqual(['settings.json']);
    expect(statSync(join(dataDir, 'settings.json')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dataDir, 'settings.json'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('writes {} as an empty object', () => {
    const dataDir = tempDir();
    writeSettings(dataDir, {});
    expect(existsSync(join(dataDir, 'settings.json'))).toBe(true);
    expect(readSettings(dataDir)).toEqual({});
  });
});

describe('resolveDataDir', () => {
  const home = '/Users/sam';
  const fallback = '/Users/sam/Library/Application Support/TDS Brain/data';

  it('uses the Application Support folder when TDS_BRAIN_APP_DATA is unset', () => {
    expect(resolveDataDir({}, home)).toBe(fallback);
  });

  it('uses an absolute TDS_BRAIN_APP_DATA, trimmed', () => {
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '/tmp/dev-data' }, home)).toBe('/tmp/dev-data');
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '  /tmp/dev-data/  ' }, home)).toBe('/tmp/dev-data');
  });

  it('expands ~ against the given home', () => {
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '~/dev-data' }, home)).toBe('/Users/sam/dev-data');
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '~' }, home)).toBe('/Users/sam');
  });

  it('falls back when the value is blank or relative', () => {
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '' }, home)).toBe(fallback);
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '   ' }, home)).toBe(fallback);
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: 'data' }, home)).toBe(fallback);
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: './data' }, home)).toBe(fallback);
    expect(resolveDataDir({ TDS_BRAIN_APP_DATA: '~sam/data' }, home)).toBe(fallback);
  });
});

describe('resolveBrainPath', () => {
  const home = '/Users/sam';

  it('prefers TDS_BRAIN_PATH over settings', () => {
    expect(
      resolveBrainPath({ TDS_BRAIN_PATH: '/elsewhere/brain' }, { brainPath: '/Users/sam/b' }, home),
    ).toEqual({
      path: '/elsewhere/brain',
      source: 'env',
    });
  });

  it('expands ~ in TDS_BRAIN_PATH against the given home', () => {
    expect(resolveBrainPath({ TDS_BRAIN_PATH: ' ~/work/brain ' }, {}, home)).toEqual({
      path: '/Users/sam/work/brain',
      source: 'env',
    });
  });

  it('uses settings when the variable is unset or blank', () => {
    expect(resolveBrainPath({}, { brainPath: '/Users/sam/Documents/brain' }, home)).toEqual({
      path: '/Users/sam/Documents/brain',
      source: 'settings',
    });
    expect(resolveBrainPath({ TDS_BRAIN_PATH: '  ' }, { brainPath: '/Users/sam/b' }, home)).toEqual({
      path: '/Users/sam/b',
      source: 'settings',
    });
  });

  it('falls back to ~/agencybrain', () => {
    expect(resolveBrainPath({}, {}, home)).toEqual({ path: '/Users/sam/agencybrain', source: 'default' });
    expect(resolveBrainPath({}, { brainPath: '  ' }, home)).toEqual({
      path: '/Users/sam/agencybrain',
      source: 'default',
    });
  });
});
