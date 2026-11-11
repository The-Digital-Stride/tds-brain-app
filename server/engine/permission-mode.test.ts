import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePermissionMode } from './permission-mode.ts';

let root: string;
let home: string;
let brain: string;

function write(file: string, body: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
}

const userFile = () => join(home, '.claude', 'settings.json');
const projectFile = () => join(brain, '.claude', 'settings.json');
const localFile = () => join(brain, '.claude', 'settings.local.json');
const mode = (defaultMode: unknown) => ({ permissions: { defaultMode } });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tba-mode-'));
  home = join(root, 'home');
  brain = join(root, 'brain');
  mkdirSync(home);
  mkdirSync(brain);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolvePermissionMode (A18)', () => {
  it('is default when no settings file sets it', () => {
    expect(resolvePermissionMode(brain, home)).toBe('default');
    write(userFile(), { model: 'x' });
    expect(resolvePermissionMode(brain, home)).toBe('default');
  });

  it('passes auto and acceptEdits through', () => {
    write(userFile(), mode('auto'));
    expect(resolvePermissionMode(brain, home)).toBe('auto');
    write(userFile(), mode('acceptEdits'));
    expect(resolvePermissionMode(brain, home)).toBe('acceptEdits');
    write(userFile(), mode('default'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
  });

  it('never passes through a mode that stops asking or blocks work', () => {
    for (const m of ['bypassPermissions', 'dontAsk', 'plan', 'something-new', 42, null, ['auto'], { a: 1 }]) {
      write(userFile(), mode(m));
      expect(resolvePermissionMode(brain, home)).toBe('default');
    }
  });

  it('gives default for corrupt JSON or a strange shape', () => {
    write(userFile(), '{ not json');
    expect(resolvePermissionMode(brain, home)).toBe('default');
    write(userFile(), '[1,2]');
    expect(resolvePermissionMode(brain, home)).toBe('default');
    write(userFile(), { permissions: 'auto' });
    expect(resolvePermissionMode(brain, home)).toBe('default');
  });

  it('lets the brain project file beat the user file, and the local file beat both', () => {
    write(userFile(), mode('default'));
    write(projectFile(), mode('acceptEdits'));
    expect(resolvePermissionMode(brain, home)).toBe('acceptEdits');
    write(localFile(), mode('default'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
    write(localFile(), mode('acceptEdits'));
    write(projectFile(), mode('default'));
    expect(resolvePermissionMode(brain, home)).toBe('acceptEdits');
    write(localFile(), mode('bypassPermissions'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
  });

  it('honours auto only from the person’s own settings, never from the shared brain', () => {
    write(projectFile(), mode('auto'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
    rmSync(projectFile());
    write(localFile(), mode('auto'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
    // A brain file saying auto still overrides the person's auto, as default.
    write(userFile(), mode('auto'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
    rmSync(localFile());
    write(projectFile(), mode('auto'));
    expect(resolvePermissionMode(brain, home)).toBe('default');
    rmSync(projectFile());
    expect(resolvePermissionMode(brain, home)).toBe('auto');
  });

  it('skips a later file that does not set the mode', () => {
    write(userFile(), mode('auto'));
    write(projectFile(), { permissions: { deny: ['Read(.env)'] } });
    write(localFile(), '{ broken');
    expect(resolvePermissionMode(brain, home)).toBe('auto');
  });
});
