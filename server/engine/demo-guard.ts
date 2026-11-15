/**
 * Demo mode for the help screenshots (plan 2026-11-15-cortex-help-phase-1, decision 11).
 *
 * It fails closed, by allow-list: demo mode only runs where every folder it can read or write sits inside
 * `<appRoot>/.help-demo/`, so it can only ever see made-up data. Pure functions; `server/index.ts` calls them
 * and exits on a refusal. Flag unset means nothing here changes behaviour.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import type { ClientGuessResponse } from '../../shared/contract.ts';
import { resolveBrainPath, resolveDataDir } from '../settings.ts';
import { jevConfig } from './jev.ts';

export const DEMO_FLAG = 'TDS_CORTEX_DEMO';
export const DEMO_DIR = '.help-demo';
export const DEMO_MARKER = '.cortex-demo';

export type DemoEnvDecision =
  | { demo: false }
  | { demo: true; ok: true }
  | { demo: true; ok: false; rule: string };

export interface DemoEnvInput {
  env: NodeJS.ProcessEnv;
  argv: readonly string[];
  appRoot: string;
  defaultPort: number;
  /** The home folder the server resolves paths against. Default: `homedir()`. */
  home?: string;
  /** Resolves links; injectable for tests. */
  realpath?: (p: string) => string;
}

function inside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function real(p: string, realpath: (p: string) => string): string | null {
  try {
    return realpath(resolve(p));
  } catch {
    return null;
  }
}

/** The env check. Runs before `resolveConfig()`, which writes runtime.json. */
export function checkDemoEnv(i: DemoEnvInput): DemoEnvDecision {
  const flag = i.env[DEMO_FLAG];
  if (flag === undefined) return { demo: false };
  const fail = (rule: string): DemoEnvDecision => ({ demo: true, ok: false, rule });
  if (flag !== '1') return fail(`${DEMO_FLAG} must be exactly 1 to turn demo mode on.`);
  if (i.env.TDS_BRAIN_SERVICE === '1') return fail('Demo mode never runs under the background service.');
  if (!i.argv.includes('--no-open')) return fail('Demo mode needs --no-open.');
  const rawPort = i.env.TDS_BRAIN_APP_PORT;
  if (!rawPort) return fail('Demo mode needs TDS_BRAIN_APP_PORT set to its own port.');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port >= 65536)
    return fail('TDS_BRAIN_APP_PORT must be a whole port number.');
  if (port === i.defaultPort) return fail(`Demo mode must not use the app's usual port (${i.defaultPort}).`);
  const realpath = i.realpath ?? ((p: string) => realpathSync(p));
  // `.help-demo` itself must be a real folder sitting in the app folder, never a link to somewhere else.
  const demoDir = join(i.appRoot, DEMO_DIR);
  let isLink: boolean;
  try {
    isLink = lstatSync(demoDir).isSymbolicLink();
  } catch {
    return fail(`The ${DEMO_DIR} folder does not exist yet.`);
  }
  if (isLink) return fail(`The ${DEMO_DIR} folder must be a real folder, not a link.`);
  const root = real(demoDir, realpath);
  const appReal = real(i.appRoot, realpath);
  if (root === null || appReal === null) return fail(`The ${DEMO_DIR} folder does not exist yet.`);
  if (root !== join(appReal, DEMO_DIR)) return fail(`The ${DEMO_DIR} folder must sit in the app folder.`);
  // The folders exactly as `resolveConfig` will pick them: `resolveDataDir` swaps a value that is not a full
  // path for the real data folder, so the raw value is checked as well as the result. With TDS_BRAIN_PATH set
  // (required below), `resolveBrainPath` never looks at settings.json, so `{}` gives the same answer.
  const home = i.home ?? homedir();
  const used = {
    TDS_BRAIN_APP_DATA: resolveDataDir(i.env, home),
    TDS_BRAIN_PATH: resolveBrainPath(i.env, {}, home).path,
  };
  for (const name of ['TDS_BRAIN_APP_DATA', 'TDS_BRAIN_PATH'] as const) {
    const raw = i.env[name];
    if (!raw) return fail(`Demo mode needs ${name} set.`);
    if (raw !== raw.trim() || !isAbsolute(raw))
      return fail(`${name} must be a full path, with no spaces around it.`);
    // The check above is what stops a relative value (which the server would swap for the real default
    // folder). This one only keeps the guard honest if resolveDataDir or resolveBrainPath ever change.
    if (used[name] !== resolve(raw)) return fail(`${name} is not the folder the app would use.`);
    const path = real(used[name], realpath);
    if (path === null || !inside(root, path))
      return fail(`${name} must be a folder inside ${DEMO_DIR} in the app folder.`);
  }
  return { demo: true, ok: true };
}

export interface DemoBrainInput {
  /** The brain decision's kind and path, after `decideBrain`. */
  decision: { kind: 'ready'; path: string } | { kind: 'setup' };
  env: NodeJS.ProcessEnv;
  hasMarker: (brainPath: string) => boolean;
  /** True when a chat could reach Jev from this Brain and env. Default: `jevConfig` finds a config. */
  jevConfigured?: (brainPath: string) => boolean;
  realpath?: (p: string) => string;
}

/** The Brain check. Runs straight after `decideBrain`, before `buildBrainSide`. null means all is well. */
export function checkDemoBrain(i: DemoBrainInput): string | null {
  if (i.decision.kind !== 'ready')
    return 'Demo mode cannot start without a ready demo Brain (it would open setup).';
  const realpath = i.realpath ?? ((p: string) => realpathSync(p));
  const wanted = i.env.TDS_BRAIN_PATH ? real(i.env.TDS_BRAIN_PATH, realpath) : null;
  const actual = real(i.decision.path, realpath);
  if (wanted === null || actual === null || wanted !== actual)
    return 'The Brain in use is not the folder named by TDS_BRAIN_PATH.';
  if (!i.hasMarker(actual))
    return `The Brain has no ${DEMO_MARKER} file, so it is not the made-up demo Brain.`;
  const jev = i.jevConfigured ?? ((p: string) => jevConfig(p, i.env) !== null);
  if (jev(actual)) return 'Jev is set up for this Brain, so demo mode could reach the internet.';
  return null;
}

/** Env names that may hold a secret or point the app at a service on the internet (Jev's proxy among them). */
const SECRETISH = /SECRET|TOKEN|KEY|PROXY|PASSWORD|CREDENTIAL|AUTH/i;

/** Removes secret-ish keys in place. `server/index.ts` runs it in demo mode before anything reads the env. */
export function scrubSecretEnv(env: NodeJS.ProcessEnv): void {
  for (const k of Object.keys(env)) if (SECRETISH.test(k)) delete env[k];
}

/** A copy of `env` without secret-ish keys, for the demo server and the programs it starts. */
export function demoSafeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  scrubSecretEnv(out);
  return out;
}

/** Demo mode's client guess: always "ask, with nothing to suggest", and never a call to Jev. */
export async function demoClientGuess(): Promise<ClientGuessResponse> {
  return { kind: 'ask', options: [] };
}

/** The one plain line printed on a refusal. */
export function demoRefusalLine(rule: string): string {
  return `[tds-brain] Demo mode refused to start: ${rule}`;
}
