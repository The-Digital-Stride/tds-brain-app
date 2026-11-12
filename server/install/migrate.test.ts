import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateData } from './migrate.ts';

const TOKEN = 'a'.repeat(43);
let root: string;
let from: string;
let to: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tds-migrate-'));
  from = join(root, 'old', 'data');
  to = join(root, 'new', 'data');
  mkdirSync(join(from, 'caches'), { recursive: true });
  writeFileSync(join(from, 'runtime.json'), JSON.stringify({ launchToken: TOKEN }), { mode: 0o600 });
  writeFileSync(join(from, 'prefs.json'), '{"pins":[1]}');
  writeFileSync(join(from, 'caches', 'x.json'), '{}');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('migrateData', () => {
  it('copies everything, keeps the token, and renames the old folder', () => {
    const r = migrateData(from, to);
    expect(r.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(to, 'runtime.json'), 'utf8')).launchToken).toBe(TOKEN);
    expect(readFileSync(join(to, 'prefs.json'), 'utf8')).toBe('{"pins":[1]}');
    expect(existsSync(join(to, 'caches', 'x.json'))).toBe(true);
    expect(statSync(join(to, 'runtime.json')).mode & 0o777).toBe(0o600);
    expect(existsSync(from)).toBe(false);
    expect(existsSync(`${from}.moved`)).toBe(true);
  });

  it('refuses when the destination already has a runtime.json, touching nothing', () => {
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, 'runtime.json'), '{}');
    writeFileSync(join(to, 'prefs.json'), '{}');
    const r = migrateData(from, to);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/already/);
    expect(existsSync(from)).toBe(true);
    expect(existsSync(`${from}.moved`)).toBe(false);
  });

  it('replaces a target whose only entry is a runtime.json', () => {
    mkdirSync(to, { recursive: true });
    writeFileSync(join(to, 'runtime.json'), JSON.stringify({ launchToken: 'b'.repeat(43) }));
    expect(migrateData(from, to).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(to, 'runtime.json'), 'utf8')).launchToken).toBe(TOKEN);
  });

  it('refuses when the source is missing', () => {
    const r = migrateData(join(root, 'nope'), to);
    expect(r.ok).toBe(false);
  });

  it('refuses when a .moved folder is already there', () => {
    mkdirSync(`${from}.moved`);
    expect(migrateData(from, to).ok).toBe(false);
    expect(existsSync(to)).toBe(false);
  });

  it('refuses folders inside each other', () => {
    expect(migrateData(from, join(from, 'inner')).ok).toBe(false);
  });
});
