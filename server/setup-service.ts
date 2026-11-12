/**
 * Choosing the brain folder from the app (setup-screen plan, decision 4). Built in `server/index.ts`
 * and handed to the routes; available whether the app is ready or in setup mode.
 */
import type {
  AppSettings,
  BrainCheck,
  BrainCheckContext,
  NormalizePastedPath,
  SettingSource,
  SetupService,
} from '../shared/install-contract.ts';
import { expandHomeFor } from './settings.ts';

export interface SetupServiceDeps {
  env: Record<string, string | undefined>;
  home: string;
  appRoot: string;
  dataDir: string;
  /** True under the LaunchAgent, which starts the server again after `restart()`. */
  underService: boolean;
  /** The checked brain in use, or null in setup mode. */
  current: { path: string; source: SettingSource } | null;
  /** Chats a restart would close. */
  openChats(): Promise<number>;
  checkBrain(path: string, ctx: BrainCheckContext): Promise<BrainCheck>;
  findBrainCandidates(ctx: BrainCheckContext): Promise<string[]>;
  mergeSettings(dataDir: string, patch: AppSettings): void;
  log(line: string): void;
  /** Shuts the server down gracefully, closing chats. */
  restart(): void;
}

const QUOTED = /^(['"])(.*)\1$/s;

export const normalizePastedPath: NormalizePastedPath = (raw, home) => {
  let p = raw.trim();
  const quoted = QUOTED.exec(p);
  if (quoted) p = quoted[2] ?? '';
  p = p.replace(/\\ /g, ' ');
  return expandHomeFor(p, home);
};

function envOverride(env: Record<string, string | undefined>): boolean {
  return (env.TDS_BRAIN_PATH ?? '').trim() !== '';
}

export function createSetupService(d: SetupServiceDeps): SetupService {
  const ctx: BrainCheckContext = { home: d.home, appRoot: d.appRoot, dataDir: d.dataDir };
  return {
    async candidates() {
      const [candidates, openChats] = await Promise.all([
        d.findBrainCandidates(ctx).catch(() => []),
        d.openChats().catch(() => 0),
      ]);
      return { candidates, current: d.current, openChats, envOverride: envOverride(d.env) };
    },

    async save(raw) {
      const path = normalizePastedPath(raw, d.home);
      if (envOverride(d.env)) return { ok: false, reason: 'env-override' };
      const check = await d.checkBrain(path, ctx);
      if (!check.ok) return { ok: false, reason: check.reason };
      d.mergeSettings(d.dataDir, { brainPath: check.path });
      d.log(`Brain folder changed to ${JSON.stringify(check.path)}.`);
      return { ok: true, path: check.path, restarting: d.underService };
    },

    restart() {
      d.restart();
    },
  };
}
