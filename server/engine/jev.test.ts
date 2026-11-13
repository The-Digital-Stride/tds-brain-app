import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { JEV_INSTRUCTIONS, jevConfig, jevFromBrain } from './jev.ts';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A throwaway brain folder with just the config files a test asks for. */
function brain(files: { yaml?: string; json?: string; env?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'tba-jev-'));
  dirs.push(root);
  if (files.yaml !== undefined) writeFileSync(join(root, 'jev-proxy.yaml'), files.yaml);
  if (files.json !== undefined) {
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'jev-proxy.json'), files.json);
  }
  if (files.env !== undefined) writeFileSync(join(root, '.env'), files.env);
  return root;
}

const CRITERIA = { skyseal: 'The client Skyseal', none: 'Not about any one client' };

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GOOD = {
  ok: true,
  answers: {
    client: {
      type: 'choice',
      choice: 'skyseal',
      confidence: 0.9,
      probabilities: { skyseal: 0.95, none: 0.05 },
    },
  },
};

describe('jevConfig', () => {
  it('prefers env, then jev-proxy.yaml, then data/jev-proxy.json with the .env secret', () => {
    const root = brain({
      yaml: 'url: https://yaml.example\nsecret: yaml-secret\n',
      json: JSON.stringify({ url: 'https://jev-proxy.team-1.workers.dev' }),
      env: 'OTHER=1\nJEV_PROXY_SECRET=env-file-secret\n',
    });
    expect(
      jevConfig(root, { JEV_PROXY_URL: 'https://env.example/', JEV_PROXY_SECRET: 'env-secret' }),
    ).toEqual({
      url: 'https://env.example',
      secret: 'env-secret',
    });
    expect(jevConfig(root, {})).toEqual({ url: 'https://yaml.example', secret: 'yaml-secret' });
    const tier3 = brain({
      json: JSON.stringify({ url: 'https://jev-proxy.team-1.workers.dev' }),
      env: 'OTHER=1\nJEV_PROXY_SECRET=env-file-secret\n',
    });
    expect(jevConfig(tier3, {})).toEqual({
      url: 'https://jev-proxy.team-1.workers.dev',
      secret: 'env-file-secret',
    });
  });

  it('fills each field from the first place that has it', () => {
    const root = brain({
      yaml: 'secret: yaml-secret\n',
      json: JSON.stringify({ url: 'https://jev-proxy.team-1.workers.dev' }),
    });
    expect(jevConfig(root, {})).toEqual({
      url: 'https://jev-proxy.team-1.workers.dev',
      secret: 'yaml-secret',
    });
    expect(jevConfig(root, { JEV_PROXY_SECRET: 'env-secret' })).toEqual({
      url: 'https://jev-proxy.team-1.workers.dev',
      secret: 'env-secret',
    });
  });

  it('reads JEV_PROXY_URL from the brain .env when nothing else gives a URL', () => {
    const root = brain({ env: 'JEV_PROXY_URL="https://dotenv.example"\nJEV_PROXY_SECRET=s\n' });
    expect(jevConfig(root, {})).toEqual({ url: 'https://dotenv.example', secret: 's' });
  });

  it('strips quotes', () => {
    const root = brain({ yaml: 'url: "https://yaml.example"\nsecret: \'abc\'\n' });
    expect(jevConfig(root, {})).toEqual({ url: 'https://yaml.example', secret: 'abc' });
    expect(jevConfig(brain(), { JEV_PROXY_URL: "'https://q.example'", JEV_PROXY_SECRET: '"s"' })).toEqual({
      url: 'https://q.example',
      secret: 's',
    });
  });

  it('refuses a URL that is not https', () => {
    expect(jevConfig(brain(), { JEV_PROXY_URL: 'http://jev.example', JEV_PROXY_SECRET: 's' })).toBeNull();
    expect(jevConfig(brain(), { JEV_PROXY_URL: 'not a url', JEV_PROXY_SECRET: 's' })).toBeNull();
  });

  it('is null with no config, a URL but no secret, or unreadable JSON', () => {
    expect(jevConfig(brain(), {})).toBeNull();
    expect(
      jevConfig(brain({ json: JSON.stringify({ url: 'https://jev-proxy.team-1.workers.dev' }) }), {}),
    ).toBeNull();
    expect(jevConfig(brain({ json: '{nope', env: 'JEV_PROXY_SECRET=s' }), {})).toBeNull();
    expect(jevConfig('/nonexistent/brain', {})).toBeNull();
  });

  it('takes a URL from the team-synced data file only when it is a jev-proxy Worker', () => {
    const data = (url: string) => brain({ json: JSON.stringify({ url }), env: 'JEV_PROXY_SECRET=s\n' });
    for (const url of [
      'https://evil.example',
      'https://jev-proxy.team.workers.dev.evil.example',
      'https://other.team.workers.dev',
      'https://jev-proxy.workers.dev',
      'https://jev-proxy.a.b.workers.dev',
      'http://jev-proxy.team.workers.dev',
    ]) {
      expect(jevConfig(data(url), {})).toBeNull();
    }
    expect(jevConfig(data('https://jev-proxy.peter-36b.workers.dev/'), {})).toEqual({
      url: 'https://jev-proxy.peter-36b.workers.dev',
      secret: 's',
    });
  });

  it('lets env, jev-proxy.yaml and the brain .env give any https host', () => {
    expect(jevConfig(brain(), { JEV_PROXY_URL: 'https://own.example', JEV_PROXY_SECRET: 's' })?.url).toBe(
      'https://own.example',
    );
    expect(jevConfig(brain({ yaml: 'url: https://own.example\nsecret: s\n' }), {})?.url).toBe(
      'https://own.example',
    );
    const both = brain({
      json: JSON.stringify({ url: 'https://evil.example' }),
      env: 'JEV_PROXY_URL=https://own.example\nJEV_PROXY_SECRET=s\n',
    });
    expect(jevConfig(both, {})?.url).toBe('https://own.example');
  });
});

describe('jevFromBrain', () => {
  const ENV = { JEV_PROXY_URL: 'https://jev.example', JEV_PROXY_SECRET: 'sekret' };

  it('is null when there is no config', () => {
    expect(jevFromBrain(brain(), {})).toBeNull();
  });

  it('posts one choice question to /ask with the secret header, https only and no redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, GOOD));
    const ask = jevFromBrain(brain(), ENV, fetchImpl);
    const signal = new AbortController().signal;
    expect(await ask?.('Skyseal roof page', CRITERIA, signal)).toEqual({
      choice: 'skyseal',
      confidence: 0.9,
      probabilities: { skyseal: 0.95, none: 0.05 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://jev.example/ask');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBe(signal);
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-proxy-secret': 'sekret' });
    expect(JSON.parse(String(init?.body))).toEqual({
      state: 'Skyseal roof page',
      questions: { client: { type: 'choice', instructions: JEV_INSTRUCTIONS, criteria: CRITERIA } },
    });
  });

  it('reads the config each time it is called', async () => {
    const root = brain();
    expect(jevFromBrain(root, {})).toBeNull();
    writeFileSync(join(root, 'jev-proxy.yaml'), 'url: https://later.example\nsecret: s\n');
    const fetchImpl = vi.fn<typeof fetch>(async () => reply(200, GOOD));
    await jevFromBrain(root, {}, fetchImpl)?.('x', CRITERIA, new AbortController().signal);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://later.example/ask');
  });

  it('is null for a non-200 answer, ok:false, a bad shape or a network error', async () => {
    const signal = new AbortController().signal;
    const answers: (() => Promise<Response>)[] = [
      async () => reply(401, { ok: false, error: 'unauthorised' }),
      async () => reply(500, GOOD),
      async () => reply(200, { ok: false, error: 'upstream' }),
      async () => reply(200, { ok: true, answers: {} }),
      async () => reply(200, { ok: true, answers: { client: { type: 'choice', choice: 7 } } }),
      async () => reply(200, '<html>not json'),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const a of answers) {
      const ask = jevFromBrain(brain(), ENV, vi.fn<typeof fetch>(a));
      expect(await ask?.('x', CRITERIA, signal)).toBeNull();
    }
  });

  it('keeps only numeric probabilities and defaults a missing confidence to 0', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      reply(200, {
        ok: true,
        answers: { client: { type: 'choice', choice: 'none', probabilities: { none: 0.9, skyseal: 'x' } } },
      }),
    );
    expect(
      await jevFromBrain(brain(), ENV, fetchImpl)?.('x', CRITERIA, new AbortController().signal),
    ).toEqual({
      choice: 'none',
      confidence: 0,
      probabilities: { none: 0.9 },
    });
  });
});
