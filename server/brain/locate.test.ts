import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { BrainCheckContext } from '../../shared/install-contract.ts';
import { checkBrain, findBrainCandidates } from './locate.ts';

const tempDirs: string[] = [];
const locked: string[] = [];
afterAll(() => {
  for (const d of locked.splice(0)) chmodSync(d, 0o700);
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh fake home, link-resolved (macOS temp folders sit behind /var -> /private/var). */
function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-locate-'));
  tempDirs.push(dir);
  return realpathSync(dir);
}

function ctxFor(home: string): BrainCheckContext {
  return {
    home,
    appRoot: join(home, 'Library', 'Application Support', 'TDS Brain', 'app'),
    dataDir: join(home, 'Library', 'Application Support', 'TDS Brain', 'data'),
  };
}

type Marker = 'roles' | 'whoami' | 'git';

/** Makes a brain at `dir` with every marker except those in `skip`. */
function makeBrain(dir: string, opts: { skip?: Marker[]; gitFile?: boolean } = {}): string {
  const skip = new Set(opts.skip ?? []);
  mkdirSync(dir, { recursive: true });
  if (!skip.has('roles')) {
    mkdirSync(join(dir, '.team-config'), { recursive: true });
    writeFileSync(join(dir, '.team-config', 'roles.json'), '{}');
  }
  if (!skip.has('whoami')) {
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'whoami.cjs'), '');
  }
  if (!skip.has('git')) {
    if (opts.gitFile) writeFileSync(join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/brain\n');
    else mkdirSync(join(dir, '.git'), { recursive: true });
  }
  return dir;
}

describe('checkBrain', () => {
  it('accepts a real brain and gives its resolved path', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'agencybrain'));
    expect(await checkBrain(brain, ctxFor(home))).toEqual({ ok: true, path: brain });
  });

  it('accepts a worktree, where .git is a file', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'Developer', 'brain-wt'), { gitFile: true });
    expect(await checkBrain(brain, ctxFor(home))).toEqual({ ok: true, path: brain });
  });

  it('resolves a link inside home to the real folder', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'Documents', 'brain'));
    symlinkSync(brain, join(home, 'brain-link'));
    expect(await checkBrain(join(home, 'brain-link'), ctxFor(home))).toEqual({ ok: true, path: brain });
  });

  it('resolves links in home itself before comparing', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'agencybrain'));
    const outer = tempHome();
    symlinkSync(home, join(outer, 'home-link'));
    const linkedHome = join(outer, 'home-link');
    const ctx = ctxFor(linkedHome);
    expect(await checkBrain(join(linkedHome, 'agencybrain'), ctx)).toEqual({ ok: true, path: brain });
  });

  it('refuses a relative path', async () => {
    const home = tempHome();
    makeBrain(join(home, 'agencybrain'));
    expect(await checkBrain('agencybrain', ctxFor(home))).toEqual({ ok: false, reason: 'not-absolute' });
    expect(await checkBrain('~/agencybrain', ctxFor(home))).toEqual({ ok: false, reason: 'not-absolute' });
  });

  it('refuses a folder that does not exist, or a file', async () => {
    const home = tempHome();
    expect(await checkBrain(join(home, 'nope'), ctxFor(home))).toEqual({ ok: false, reason: 'not-found' });
    writeFileSync(join(home, 'file'), '');
    expect(await checkBrain(join(home, 'file'), ctxFor(home))).toEqual({ ok: false, reason: 'not-found' });
  });

  it.each([
    ['roles', 'missing-roles'],
    ['whoami', 'missing-whoami'],
    ['git', 'not-a-repo'],
  ] as const)('refuses a folder without its %s marker', async (marker, reason) => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'brain'), { skip: [marker] });
    expect(await checkBrain(brain, ctxFor(home))).toEqual({ ok: false, reason });
  });

  it('refuses markers of the wrong kind', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'brain'), { skip: ['roles'] });
    mkdirSync(join(brain, '.team-config', 'roles.json'), { recursive: true });
    expect(await checkBrain(brain, ctxFor(home))).toEqual({ ok: false, reason: 'missing-roles' });
  });

  it('refuses a link that points outside home', async () => {
    const home = tempHome();
    const outside = makeBrain(join(tempHome(), 'brain'));
    symlinkSync(outside, join(home, 'brain'));
    expect(await checkBrain(join(home, 'brain'), ctxFor(home))).toEqual({
      ok: false,
      reason: 'outside-home',
    });
    expect(await checkBrain(outside, ctxFor(home))).toEqual({ ok: false, reason: 'outside-home' });
  });

  it('refuses home itself', async () => {
    const home = tempHome();
    makeBrain(home);
    expect(await checkBrain(home, ctxFor(home))).toEqual({ ok: false, reason: 'outside-home' });
  });

  it('refuses the app folder', async () => {
    const home = tempHome();
    const ctx = ctxFor(home);
    makeBrain(ctx.appRoot);
    expect(await checkBrain(ctx.appRoot, ctx)).toEqual({ ok: false, reason: 'is-app-folder' });
  });

  it('refuses the data folder and anything inside it', async () => {
    const home = tempHome();
    const ctx = ctxFor(home);
    makeBrain(ctx.dataDir);
    expect(await checkBrain(ctx.dataDir, ctx)).toEqual({ ok: false, reason: 'is-data-folder' });
    const inner = makeBrain(join(ctx.dataDir, 'cache', 'brain'));
    expect(await checkBrain(inner, ctx)).toEqual({ ok: false, reason: 'is-data-folder' });
  });

  it('refuses a folder that holds the data folder or the app folder', async () => {
    const home = tempHome();
    const ctx = ctxFor(home);
    mkdirSync(ctx.dataDir, { recursive: true });
    const support = makeBrain(join(home, 'Library', 'Application Support', 'TDS Brain'));
    expect(await checkBrain(support, ctx)).toEqual({ ok: false, reason: 'is-data-folder' });
    rmSync(ctx.dataDir, { recursive: true });
    mkdirSync(ctx.appRoot, { recursive: true });
    expect(await checkBrain(support, { ...ctx, dataDir: join(home, 'elsewhere', 'data') })).toEqual({
      ok: false,
      reason: 'is-app-folder',
    });
  });

  it('compares through links on both sides, even before the data folder exists', async () => {
    const real = tempHome();
    const outer = tempHome();
    symlinkSync(real, join(outer, 'home-link'));
    const ctx = ctxFor(join(outer, 'home-link'));
    // The brain is named through the real path; the data folder (not made yet) through the link.
    const support = makeBrain(join(real, 'Library', 'Application Support', 'TDS Brain'));
    expect(await checkBrain(support, ctx)).toEqual({ ok: false, reason: 'is-data-folder' });
    const inside = makeBrain(join(real, 'Library', 'Application Support', 'TDS Brain', 'data', 'x'));
    expect(await checkBrain(inside, ctx)).toEqual({ ok: false, reason: 'is-data-folder' });
  });

  it('does not mistake a sibling whose name starts with the data folder name', async () => {
    const home = tempHome();
    const ctx = ctxFor(home);
    const sibling = makeBrain(`${ctx.dataDir}-old`);
    expect(await checkBrain(sibling, ctx)).toEqual({ ok: true, path: sibling });
  });

  it.skipIf(process.getuid?.() === 0)('reports a folder it is not allowed to read as protected', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'brain'));
    chmodSync(join(brain, '.team-config'), 0o000);
    locked.push(join(brain, '.team-config'));
    expect(await checkBrain(brain, ctxFor(home))).toEqual({ ok: false, reason: 'protected-folder' });
  });
});

describe('findBrainCandidates', () => {
  it('finds brains one level inside the usual folders, ~/agencybrain first', async () => {
    const home = tempHome();
    const a = makeBrain(join(home, 'Documents', 'aaa-brain'));
    const b = makeBrain(join(home, 'My Repos', 'team-brain'));
    const c = makeBrain(join(home, 'Projects', 'p-brain'));
    const d = makeBrain(join(home, 'Developer', 'd-brain'));
    const e = makeBrain(join(home, 'zz-brain'));
    const agency = makeBrain(join(home, 'agencybrain'));
    const found = await findBrainCandidates(ctxFor(home));
    expect(found[0]).toBe(agency);
    expect([...found].sort()).toEqual([a, b, c, d, e, agency].sort());
  });

  it('goes one level only, skips dot folders, non-brains and the app and data folders', async () => {
    const home = tempHome();
    const ctx = ctxFor(home);
    makeBrain(join(home, 'Developer', 'group', 'deep-brain'));
    makeBrain(join(home, '.hidden-brain'));
    makeBrain(join(home, 'Documents', '.dot-brain'));
    makeBrain(join(home, 'Projects', 'half'), { skip: ['whoami'] });
    makeBrain(ctx.appRoot);
    makeBrain(ctx.dataDir);
    const ok = makeBrain(join(home, 'Developer', 'brain'));
    expect(await findBrainCandidates(ctx)).toEqual([ok]);
  });

  it('lists a brain reached by two links once', async () => {
    const home = tempHome();
    const brain = makeBrain(join(home, 'Developer', 'brain'));
    symlinkSync(brain, join(home, 'Projects-link'));
    mkdirSync(join(home, 'Projects'));
    symlinkSync(brain, join(home, 'Projects', 'brain-link'));
    expect(await findBrainCandidates(ctxFor(home))).toEqual([brain]);
  });

  it('gives an empty list when nothing qualifies or home is missing', async () => {
    const home = tempHome();
    expect(await findBrainCandidates(ctxFor(home))).toEqual([]);
    expect(await findBrainCandidates(ctxFor(join(home, 'missing')))).toEqual([]);
  });
});
