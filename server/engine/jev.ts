/**
 * The one way the app reaches Jev (TypeSafe): the brain's `jev-proxy` Worker, `POST <url>/ask`
 * with `x-proxy-secret` (plan 2026-11-13-client-picker-jev, decisions 1 and 3).
 *
 * Config is read at call time, never written and never logged. Each field comes from the first
 * place that has it, as the brain's meta-proxy runner does:
 *   1. env `JEV_PROXY_URL` + `JEV_PROXY_SECRET`
 *   2. `jev-proxy.yaml` in the brain root (`url:` / `secret:`; gitignored)
 *   3. `data/jev-proxy.json` (`{ "url": … }`, synced to the team; only a jev-proxy Worker URL) + `JEV_PROXY_SECRET` from the
 *      brain's `.env` (a `JEV_PROXY_URL` there is the last place a URL is looked for)
 * The app runs under launchd with no brain env, so the brain's `.env` is read here, and only
 * those two keys are taken from it. The URL must be `https:`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JevAsk } from './client-guess.ts';

/** What Jev is told about the one `choice` question. Not shown to people. */
export const JEV_INSTRUCTIONS =
  'This is the first message of a new chat in a digital marketing agency. Which client is it about? ' +
  'Pick the client the message is about, or "none" if it is not about any one client.';

/** Anything bigger from the Worker is not a real answer. */
const MAX_REPLY_CHARS = 64 * 1024;

export interface JevConfig {
  url: string;
  secret: string;
}

function readOr(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function unquote(v: string | undefined): string {
  return (v ?? '')
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/, '$2')
    .trim();
}

/** One `KEY=value` from a .env text; nothing else in the file is kept. */
function dotenvValue(text: string, key: 'JEV_PROXY_SECRET' | 'JEV_PROXY_URL'): string {
  return unquote(new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(\\S+)`, 'm').exec(text)?.[1]);
}

/**
 * `data/jev-proxy.json` syncs to the whole team and anyone can edit it, so a URL from there must be
 * a jev-proxy Worker; otherwise one edit could send everyone's token and first messages elsewhere.
 * URLs from env, jev-proxy.yaml or the brain's .env are the person's own and may be any https host.
 */
const TEAM_WORKER_HOST = /^jev-proxy\.[a-z0-9-]+\.workers\.dev$/;

function isTeamWorkerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && TEAM_WORKER_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

/** The Worker's URL and secret, or null when either is missing or the URL is not https. */
export function jevConfig(brainRoot: string, env: NodeJS.ProcessEnv): JevConfig | null {
  let url = unquote(env.JEV_PROXY_URL);
  let secret = unquote(env.JEV_PROXY_SECRET);
  if (!url || !secret) {
    const yaml = readOr(join(brainRoot, 'jev-proxy.yaml'));
    url ||= unquote(/^\s*url:\s*(\S+)/m.exec(yaml)?.[1]);
    secret ||= unquote(/^\s*secret:\s*(\S+)/m.exec(yaml)?.[1]);
  }
  if (!url) {
    try {
      const j = JSON.parse(readOr(join(brainRoot, 'data', 'jev-proxy.json'))) as { url?: unknown };
      if (typeof j?.url === 'string' && isTeamWorkerUrl(unquote(j.url))) url = unquote(j.url);
    } catch {
      // absent or unreadable
    }
  }
  if (!url || !secret) {
    const dotenv = readOr(join(brainRoot, '.env'));
    url ||= dotenvValue(dotenv, 'JEV_PROXY_URL');
    secret ||= dotenvValue(dotenv, 'JEV_PROXY_SECRET');
  }
  if (!url || !secret || !/^[\x21-\x7e]+$/.test(secret)) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), secret };
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** The `client` answer from the Worker's reply, or null for any other shape. */
function parseAnswer(body: unknown): Awaited<ReturnType<JevAsk>> {
  if (!body || typeof body !== 'object') return null;
  const b = body as { ok?: unknown; answers?: { client?: unknown } };
  if (b.ok !== true || !b.answers || typeof b.answers !== 'object') return null;
  const a = b.answers.client as
    | { type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: unknown }
    | undefined;
  if (!a || typeof a !== 'object' || typeof a.choice !== 'string') return null;
  if (a.type !== undefined && a.type !== 'choice') return null;
  const probabilities: Record<string, number> = {};
  if (a.probabilities && typeof a.probabilities === 'object' && !Array.isArray(a.probabilities)) {
    for (const [k, v] of Object.entries(a.probabilities)) if (finite(v)) probabilities[k] = v;
  }
  return { choice: a.choice, confidence: finite(a.confidence) ? a.confidence : 0, probabilities };
}

/**
 * A `JevAsk` that posts one `choice` question named `client`, or null when Jev isn't set up.
 * The returned function never throws: any failure (network, non-200, bad shape) resolves null.
 */
export function jevFromBrain(
  brainRoot: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): JevAsk | null {
  const config = jevConfig(brainRoot, env);
  if (!config) return null;
  return async (state, criteria, signal) => {
    try {
      const res = await fetchImpl(`${config.url}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-proxy-secret': config.secret },
        body: JSON.stringify({
          state,
          questions: { client: { type: 'choice', instructions: JEV_INSTRUCTIONS, criteria } },
        }),
        redirect: 'error',
        signal,
      });
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return null;
      }
      const text = await res.text();
      if (text.length > MAX_REPLY_CHARS) return null;
      return parseAnswer(JSON.parse(text));
    } catch {
      return null;
    }
  };
}
