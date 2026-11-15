import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  APP_USAGE_CAPABILITY,
  APP_USAGE_SALT_FILE,
  APP_USAGE_SCRIPT,
  type AppUsageEvent,
  type KitShadowRecord,
} from '../../shared/kits-contract.ts';
import { createAppUsage } from './app-usage.ts';

let root: string;
let data: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'app-usage-brain-'));
  data = mkdtempSync(join(tmpdir(), 'app-usage-data-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

const RAW_ID = 'f3c1a8e0-1111-4222-8333-444455556666';
const record = (over: Partial<KitShadowRecord> = {}): KitShadowRecord => ({
  v: 1,
  day: '2026-11-15',
  kind: 'tds',
  seq: 3,
  handedOffSeq: 2,
  turns: 4,
  compacted: 100,
  cacheRead: 200,
  ...over,
});

/**
 * A real script, run with the real spawn: `capabilities` answers the given text, `usage` appends its
 * stdin to a file in the data folder and exits with `usageCode`.
 */
function install(opts: { caps?: string; usageCode?: number } = {}): string {
  const dir = join(root, '.claude', 'skills', 'tdsapp-kits', 'scripts');
  mkdirSync(dir, { recursive: true });
  const log = join(data, 'received.jsonl');
  writeFileSync(
    join(root, APP_USAGE_SCRIPT),
    `const fs = require('node:fs');
const cmd = process.argv[2];
if (cmd === 'capabilities') { process.stdout.write(${JSON.stringify(opts.caps ?? JSON.stringify({ capabilities: [APP_USAGE_CAPABILITY] }))}); process.exit(0); }
if (cmd === 'usage') {
  let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => {
    fs.appendFileSync(${JSON.stringify(log)}, s + '\\n');
    process.exit(${opts.usageCode ?? 0});
  });
} else process.exit(2);
`,
  );
  return log;
}

const received = (log: string): AppUsageEvent[] =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const make = (over: Partial<Parameters<typeof createAppUsage>[0]> = {}) => {
  const lines: string[] = [];
  const usage = createAppUsage({
    brainRoot: () => root,
    dataDir: data,
    appVersion: '9.9.9',
    log: (l) => lines.push(l),
    env: { PATH: process.env.PATH },
    ...over,
  });
  return { usage, lines };
};

describe('app usage hand-off', () => {
  it('sends one event on stdin after checking capabilities', async () => {
    const log = install();
    const { usage } = make();
    expect(await usage.send(RAW_ID, record())).toBe('sent');
    const [e] = received(log);
    expect(e).toMatchObject({
      event: 'app',
      mode: 'shadow',
      app: '9.9.9',
      v: 1,
      day: '2026-11-15',
      kind: 'tds',
      seq: 3,
      turns: 4,
      compacted: 100,
      cacheRead: 200,
    });
    expect(e).not.toHaveProperty('handedOffSeq');
  });

  it('hashes the chat id with a per-install salt and never sends the raw id', async () => {
    const log = install();
    const { usage } = make();
    await usage.send(RAW_ID, record());
    const [e] = received(log);
    const salt = readFileSync(join(data, APP_USAGE_SALT_FILE), 'utf8').trim();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(e?.chat).toBe(
      createHash('sha256')
        .update(salt + RAW_ID)
        .digest('hex')
        .slice(0, 16),
    );
    expect(readFileSync(log, 'utf8')).not.toContain(RAW_ID);
    expect(readFileSync(log, 'utf8')).not.toContain(salt);
  });

  it('keeps the same salt across runs, and a different one per install', async () => {
    const a = make().usage;
    const hashA = await a.chatHash(RAW_ID);
    expect(await make().usage.chatHash(RAW_ID)).toBe(hashA);
    const other = mkdtempSync(join(tmpdir(), 'app-usage-data2-'));
    try {
      expect(await make({ dataDir: other }).usage.chatHash(RAW_ID)).not.toBe(hashA);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
    expect(hashA).toMatch(/^[0-9a-f]{16}$/);
  });

  it('replaces an invalid salt file once, privately, and keeps the new salt', async () => {
    const file = join(data, APP_USAGE_SALT_FILE);
    writeFileSync(file, 'not a salt\n');
    const first = make();
    const hash = await first.usage.chatHash(RAW_ID);
    const text = readFileSync(file, 'utf8').trim();
    expect(text).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(first.lines).toHaveLength(1);
    expect(first.lines[0]).not.toContain(RAW_ID);
    expect(await make().usage.chatHash(RAW_ID)).toBe(hash);
    expect(readdirSync(data).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a missing script resolves not-installed and logs one line per app run', async () => {
    const { usage, lines } = make();
    expect(await usage.send(RAW_ID, record())).toBe('not-installed');
    expect(await usage.send(RAW_ID, record())).toBe('not-installed');
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(RAW_ID);
  });

  it('no brain at all is also not-installed', async () => {
    expect(await make({ brainRoot: () => null }).usage.send(RAW_ID, record())).toBe('not-installed');
  });

  it('a script that is a link out of the brain is not installed', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      writeFileSync(join(outside, 's.cjs'), 'process.exit(0)');
      mkdirSync(join(root, '.claude', 'skills', 'tdsapp-kits', 'scripts'), { recursive: true });
      symlinkSync(join(outside, 's.cjs'), join(root, APP_USAGE_SCRIPT));
      expect(await make().usage.send(RAW_ID, record())).toBe('not-installed');
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('a failing script gives failed so the record stays pending', async () => {
    install({ usageCode: 1 });
    expect(await make().usage.send(RAW_ID, record())).toBe('failed');
  });

  it('sends nothing when capabilities does not list app-event-v1, and looks again next time', async () => {
    const log = install({ caps: JSON.stringify({ capabilities: ['something-else'] }) });
    const { usage, lines } = make();
    expect(await usage.send(RAW_ID, record())).toBe('failed');
    expect(await usage.send(RAW_ID, record())).toBe('failed');
    expect(() => readFileSync(log, 'utf8')).toThrow();
    expect(lines).toHaveLength(1);
    install(); // the skill is updated while the app runs
    expect(await usage.send(RAW_ID, record())).toBe('sent');
  });

  it('accepts a bare list of capabilities and refuses junk', async () => {
    install({ caps: JSON.stringify([APP_USAGE_CAPABILITY]) });
    expect(await make().usage.send(RAW_ID, record())).toBe('sent');
    install({ caps: 'not json' });
    expect(await make().usage.send(RAW_ID, record())).toBe('failed');
  });

  it('times out a script that hangs, and never throws', async () => {
    const dir = join(root, '.claude', 'skills', 'tdsapp-kits', 'scripts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, APP_USAGE_SCRIPT), 'setInterval(() => {}, 1000)');
    expect(await make({ timeoutMs: 200 }).usage.send(RAW_ID, record())).toBe('failed');
  });

  it('a personal record is sent as it is: counts only', async () => {
    const log = install();
    await make().usage.send(RAW_ID, record({ kind: 'personal' }));
    const [e] = received(log);
    expect(e?.kind).toBe('personal');
    expect(e).not.toHaveProperty('work');
  });
});
