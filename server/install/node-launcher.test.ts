import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const launcher = resolve(import.meta.dirname, '..', '..', 'bin', 'node');
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'tds-node-launcher-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function fakeNvmNode(version: string) {
  const bin = join(home, '.nvm', 'versions', 'node', `v${version}`, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "ran ${version} $*"\n`);
  chmodSync(join(bin, 'node'), 0o755);
}

/** No PATH at all, and no system candidates, like launchd. */
function run(...args: string[]) {
  return spawnSync('/bin/sh', [launcher, ...args], {
    env: { HOME: home, TDS_BRAIN_NODE_SYSTEM: join(home, 'nowhere', 'node') },
    encoding: 'utf8',
  });
}

describe('bin/node', () => {
  it('runs the newest Node that is new enough, passing arguments on', () => {
    for (const v of ['20.11.0', '22.17.9', '22.18.0', '24.15.0', '24.9.1']) fakeNvmNode(v);
    const r = run('server/index.ts', '--no-open');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ran 24.15.0 server/index.ts --no-open');
  });

  it('accepts exactly the minimum version', () => {
    fakeNvmNode('22.18.0');
    expect(run().stdout.trim()).toBe('ran 22.18.0');
  });

  it('refuses versions older than the minimum with exit 127 and a plain message', () => {
    fakeNvmNode('22.17.9');
    fakeNvmNode('20.19.0');
    const r = run();
    expect(r.status).toBe(127);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('22.18.0');
  });

  it('exits 127 when there is no Node at all', () => {
    expect(run().status).toBe(127);
  });
});
