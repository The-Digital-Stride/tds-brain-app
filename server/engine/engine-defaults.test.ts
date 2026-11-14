import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { modelLabel, resolveEngineDefaults } from './engine-defaults.ts';

const roots: string[] = [];
afterAll(() => {
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folders() {
  const root = mkdtempSync(join(tmpdir(), 'tba-defaults-'));
  roots.push(root);
  const home = join(root, 'home');
  const brain = join(root, 'brain');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(brain, '.claude'), { recursive: true });
  return {
    home,
    brain,
    user: (v: unknown) => writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(v)),
    shared: (v: unknown) => writeFileSync(join(brain, '.claude', 'settings.json'), JSON.stringify(v)),
    local: (v: unknown) => writeFileSync(join(brain, '.claude', 'settings.local.json'), JSON.stringify(v)),
  };
}

describe('resolveEngineDefaults', () => {
  it('is null when no file exists', () => {
    const f = folders();
    expect(resolveEngineDefaults(f.brain, f.home)).toEqual({ model: null });
  });

  it('reads the model from the user file', () => {
    const f = folders();
    f.user({ model: 'opus' });
    expect(resolveEngineDefaults(f.brain, f.home)).toEqual({ model: 'opus' });
  });

  it('lets the last file that sets it win: user, then brain, then brain local', () => {
    const f = folders();
    f.user({ model: 'opus' });
    f.shared({ model: 'sonnet' });
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('sonnet');
    f.local({ model: 'haiku' });
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('haiku');
    f.local({ other: 1 });
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('sonnet');
  });

  it('ignores junk: wrong types, bad pattern, too long, nested model, broken files', () => {
    const f = folders();
    f.user({ model: 'opus' });
    f.shared({ model: 42 });
    f.local({ model: 'has space', nested: { model: 'haiku' } });
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('opus');
    f.shared({ model: 'x'.repeat(101) });
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('opus');
    writeFileSync(join(f.brain, '.claude', 'settings.json'), '{not json');
    f.local([]);
    expect(resolveEngineDefaults(f.brain, f.home).model).toBe('opus');
  });
});

describe('modelLabel', () => {
  it('turns ids into names and leaves aliases and unknown ids alone', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M context)');
    expect(modelLabel('sonnet')).toBe('sonnet');
  });
});
