/**
 * `pnpm start`: start the local server, then open Chrome with a one-time sign-in code (A15).
 *
 * Logs are short status lines only: never prompts, replies, tokens or cookie values.
 */
import { existsSync, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getSessionMessages, listSessions, query } from '@anthropic-ai/claude-agent-sdk';
import { APP_HOST, DEFAULT_PORT } from '../shared/contract.ts';
import type { BrainDecision, BrainRefusal } from '../shared/install-contract.ts';
import type { LevelSources } from '../shared/levels-contract.ts';
import { createAppUsage } from './brain/app-usage.ts';
import { appStateFor, decideBrain } from './brain/decide.ts';
import { createBrainReaders } from './brain/index.ts';
import { checkBrain, findBrainCandidates } from './brain/locate.ts';
import { createSkillLevels } from './brain/skill-levels.ts';
import { ownLevel } from './brain/skills.ts';
import { createThumbnailer, QUICK_LOOK_COMMAND, quickLookAvailable } from './brain/thumbs.ts';
import { createChangelogReader } from './changelog.ts';
import { APP_ROOT, resolveConfig } from './config.ts';
import { createDemoEngine } from './engine/demo-engine.ts';
import {
  checkDemoBrain,
  checkDemoEnv,
  DEMO_MARKER,
  demoClientGuess,
  demoRefusalLine,
  scrubSecretEnv,
} from './engine/demo-guard.ts';
import { createKitTracker, loadKits, projectServers } from './engine/kits.ts';
import { resolvePermissionMode } from './engine/permission-mode.ts';
import { createSessionManager, type EngineFns } from './engine/session-manager.ts';
import { createTrashSession } from './engine/trash-session.ts';
import { createAuthCodes } from './http/security.ts';
import { createAppServer } from './http/server.ts';
import {
  appUrl as appUrlFor,
  codeFromRunningServer,
  openBrowser as openLink,
  signInUrl,
} from './launcher.ts';
import { startPurgeTimer } from './purge-timer.ts';
import { mergeSettings } from './settings.ts';
import {
  createEngineHealth,
  createSetupBrain,
  createSetupSessions,
  createSetupThumbs,
  createSetupUploads,
} from './setup-mode.ts';
import { createSetupService } from './setup-service.ts';
import { createAppStore } from './store/app-store.ts';
import { createAssetCache, sweepAssetTemps } from './store/asset-cache.ts';
import { createChatKindStore } from './store/chat-kinds.ts';
import { createChatLevelStore } from './store/chat-levels.ts';
import { createClientPickTally } from './store/client-pick-tally.ts';
import { createContextReadingStore } from './store/context-readings.ts';
import { createKitShadowStore } from './store/kit-shadow.ts';
import { createPageCopies, type PageCopyStore } from './store/page-copies.ts';
import { createTokenSavingsStore } from './store/token-savings.ts';
import { createRunner } from './update/run.ts';
import { createUpdater } from './update/updater.ts';
import { createUploadStaging } from './uploads/staging.ts';
import { createSavings } from './usage/savings.ts';

// The update's boot check (`bin/node server/index.ts --check`): reaching here means every import loaded.
// Nothing below this line has run, so no config is read and nothing is created or started.
if (process.argv.includes('--check')) process.exit(0);

const noOpen = process.argv.slice(2).includes('--no-open');

function log(line: string): void {
  console.log(`[tds-brain] ${line}`);
}

// Demo mode (help screenshots) is checked before the config is read, because reading it writes runtime.json.
// Flag unset: nothing here does anything.
const demoEnv = checkDemoEnv({
  env: process.env,
  argv: process.argv.slice(2),
  appRoot: APP_ROOT,
  defaultPort: DEFAULT_PORT,
});
if (demoEnv.demo && !demoEnv.ok) {
  console.error(demoRefusalLine(demoEnv.rule));
  process.exit(1);
}
const demoMode = demoEnv.demo;
// No secrets and no proxy settings in demo mode, so nothing can reach Jev or any other service.
if (demoMode) scrubSecretEnv(process.env);

const config = resolveConfig();
// The pretend Claude never runs a program; this only stops the app saying Claude Code is missing.
if (demoMode) config.claudePath = process.execPath;
const appUrl = appUrlFor(config.port);
const authCodes = createAuthCodes(config.launchToken);
const openBrowser = (url: string) => {
  if (!noOpen) openLink(url);
};

const home = homedir();
const brainCheckContext = { home, appRoot: config.appRoot, dataDir: config.dataDir };

// Decided once, and checked, before anything that touches the brain is built (setup-screen plan,
// decision 1). Only a `ready` decision's path is ever handed to brain code.
const decision: BrainDecision = await decideBrain(config.brainCandidate, (p) =>
  checkBrain(p, brainCheckContext),
);
if (demoMode) {
  const refusal = checkDemoBrain({
    decision,
    env: process.env,
    hasMarker: (p) => existsSync(join(p, DEMO_MARKER)),
  });
  if (refusal) {
    console.error(demoRefusalLine(refusal));
    process.exit(1);
  }
}
const brainPath = decision.kind === 'ready' ? decision.path : null;

const engine: EngineFns = demoMode
  ? createDemoEngine()
  : {
      query: (params) => query(params),
      listSessions: (opts) => listSessions(opts),
      getSessionMessages: (id, opts) => getSessionMessages(id, opts),
      trashSession: createTrashSession({ log }),
    };

const store = createAppStore(config.dataDir);
// The token savings ledger (plan 2026-11-15-startup-kits, decisions 1-3): one count every tool feeds,
// in the app's data folder. Shown in Settings in setup mode too (empty until a chat counts something).
const savings = createSavings({ store: createTokenSavingsStore(config.dataDir, log) });

/**
 * The real readers, thumbnailer, upload staging and session manager on a checked brain; in setup mode,
 * stand-ins that read nothing and can never start Claude (decision 2).
 */
function buildBrainSide(path: string | null) {
  if (path === null) {
    return {
      brain: createSetupBrain(),
      thumbs: createSetupThumbs(),
      uploads: createSetupUploads(),
      sessions: createSetupSessions(),
      pageCopies: null,
      kitTracker: null,
    };
  }
  // Checked once, and the same answer given to both: the list offers document pictures only where they can be made.
  const quickLook = quickLookAvailable() ? { command: QUICK_LOOK_COMMAND } : null;
  const thumbs = createThumbnailer(config.dataDir, { brainRoot: path, quickLook });
  // Off (root null) when the data folder and the brain overlap; it logs why. It sweeps only once
  // started, after `listen`: a second `pnpm start` that finds the port taken must leave it alone.
  const uploads = createUploadStaging({ dataDir: config.dataDir, brainRoot: path, log });
  // Levels and helpers (plan 2026-11-14-skill-levels-and-helpers): the team file and each skill's own
  // setting are only read here; the chat levels are kept in the app's data folder, never the brain.
  const skillLevels = createSkillLevels(path);
  const levels: LevelSources = {
    teamLevels: () => skillLevels.read(),
    ownLevel: (skill) => ownLevel(path, skill),
  };
  const levelOptions = { levels, chatLevels: createChatLevelStore(config.dataDir) };
  const brain = createBrainReaders(path, { dataDir: config.dataDir, docThumbs: quickLook !== null });
  // Pages Claude writes (plan 2026-11-14-artifacts-in-app): copied into the app's data folder, kept per
  // brain, never in the brain. Sources may sit in Claude's temporary folder or the brain (each chat's
  // folder is the brain).
  const pageCopies: PageCopyStore = createPageCopies({
    dataDir: config.dataDir,
    brainRoot: path,
    roots: [path],
    log,
  });
  // Start-up kits in shadow mode (decisions 5-13): records which kit each chat would have needed and
  // switches nothing off. The kits and the brain's own servers are read fresh, read only.
  const appUsage = createAppUsage({
    brainRoot: () => path,
    dataDir: config.dataDir,
    appVersion: config.appVersion,
    log,
  });
  const kitTracker = createKitTracker({
    savings,
    store: createKitShadowStore(config.dataDir, log),
    handoff: (id, record) => appUsage.send(id, record),
    resolveKits: async () => {
      const [kits, servers] = await Promise.all([loadKits(path), projectServers(path)]);
      return { kits, keep: { projectServers: servers } };
    },
    log,
  });
  const sessions = createSessionManager({
    ...levelOptions,
    kitTracker,
    kits: () => loadKits(path),
    brain,
    brainRoot: path,
    claudePath: config.claudePath,
    engine,
    env: process.env,
    log,
    uploads,
    dataDir: config.dataDir,
    chatKinds: createChatKindStore(config.dataDir, log),
    // Each chat's newest context reading (plan 2026-11-14-context-management), in the data folder.
    contextReadings: createContextReadingStore(config.dataDir),
    pageCopies,
    // A branded copy's CDN scripts and Google Fonts, fetched once into the data folder (R8).
    assets: createAssetCache({ dataDir: config.dataDir }),
  });
  return { brain, thumbs, uploads, sessions, skillLevels, pageCopies, kitTracker };
}

const { brain, thumbs, uploads, sessions, skillLevels, pageCopies, kitTracker } = buildBrainSide(brainPath);
// The model and effort chosen in Settings reach new chats from the first one; never blocks start-up.
void store
  .get()
  .then((prefs) => {
    const { model, effort, levelMode } = prefs;
    return sessions.setEngineChoice({ model, effort, levelMode });
  })
  .catch(() => {});
const engineHealth = createEngineHealth(brainPath, config.claudePath, home, resolvePermissionMode);

const setup = createSetupService({
  env: process.env,
  home,
  appRoot: config.appRoot,
  dataDir: config.dataDir,
  underService: config.underService,
  current: decision.kind === 'ready' ? { path: decision.path, source: decision.source } : null,
  openChats: async () => (await sessions.list()).live.length,
  checkBrain,
  findBrainCandidates,
  mergeSettings,
  log,
  restart: () => void shutdown(),
});

const runner = createRunner();
const updater = createUpdater({
  appRoot: config.appRoot,
  clientDir: config.clientDir,
  dataDir: config.dataDir,
  currentVersion: config.appVersion,
  underService: config.underService,
  run: runner,
  nodeBinDir: dirname(process.execPath),
  nodePath: process.execPath,
  env: process.env,
  freeBytes: async (path) => {
    const s = await fsp.statfs(path);
    return Number(s.bavail) * Number(s.bsize);
  },
  openChats: async () => (await sessions.list()).live.length,
  restart: () => void shutdown(),
  log,
  now: () => new Date(),
});

const app = createAppServer({
  port: config.port,
  clientDir: config.clientDir,
  launchToken: config.launchToken,
  authCodes,
  appVersion: config.appVersion,
  changelog: createChangelogReader(config.appRoot),
  clientGuess: demoMode ? demoClientGuess : undefined,
  // Demo mode never updates itself: "Check for updates" would run git fetch, a network call.
  updater: demoMode ? undefined : updater,
  underService: config.underService,
  brain,
  store,
  sessions,
  skillLevels,
  thumbs,
  uploads,
  engineHealth,
  appState: appStateFor(decision),
  setup,
  log,
  clientPickTally: createClientPickTally(config.dataDir),
  savings,
});

app.server.on('error', (err: NodeJS.ErrnoException) => {
  app.stop();
  uploads.close();
  if (err.code === 'EADDRINUSE') {
    void codeFromRunningServer(config.port, config.launchToken).then((code) => {
      if (code) {
        log(`TDS Brain is already running at ${appUrl}. Opening it.`);
        openBrowser(signInUrl(config.port, code));
        setTimeout(() => process.exit(0), 1500).unref();
      } else {
        // Never send the launch token to some other program that happens to hold the port.
        log(
          `Port ${config.port} is in use by another program. Set TDS_BRAIN_APP_PORT to a free port and try again.`,
        );
        process.exit(1);
      }
    });
    return;
  }
  log(`Could not start the server (${err.code ?? 'unknown error'}).`);
  process.exit(1);
});

app.server.listen(config.port, APP_HOST, () => {
  uploads.start();
  sweepPageCopies();
  sweepTempFiles();
  // Chats not yet handed to the brain (decision 10): in the background, never holding up start-up.
  void kitTracker?.flushPending();
  updater.startTimer();
  // Deleted library files held for 30 days are erased once now and then daily; never in setup mode.
  startPurgeTimer({
    purge: () => brain.purgeDeletedFiles?.() ?? Promise.resolve(0),
    enabled: brainPath !== null,
    log,
  });
  log(`TDS Brain ${config.appVersion} is running at ${appUrl}`);
  log(config.claudePath ? 'Claude Code found.' : 'Claude Code was not found on this computer.');
  logBrainDecision(decision);
  if (!noOpen) {
    const code = authCodes.mint();
    if (code) openBrowser(signInUrl(config.port, code));
  }
});

const FROM = { env: 'from TDS_BRAIN_PATH', settings: 'from settings', default: 'the default' } as const;
const REFUSAL_LOG: Record<BrainRefusal, string> = {
  'not-absolute': 'not a full path',
  'not-found': 'no folder there',
  'outside-home': 'outside the home folder',
  'is-app-folder': 'the app folder',
  'is-data-folder': 'the data folder',
  'protected-folder': 'macOS refused access',
  'missing-roles': 'no .team-config/roles.json',
  'missing-whoami': 'no tools/whoami.cjs',
  'not-a-repo': 'not a git folder',
};

function logBrainDecision(d: BrainDecision): void {
  if (d.kind === 'ready') {
    const from = FROM[d.source];
    void brain.health().then(
      (h) => log(h.ok ? `Brain found at ${h.path} (${from})` : `Brain not ready at ${h.path} (${from})`),
      () => log('Could not check the brain folder.'),
    );
    return;
  }
  if (d.tried === null || d.source === null || d.reason === null) {
    log('No brain folder chosen yet. Waiting for one to be chosen in the app; Claude is off.');
    return;
  }
  log(
    `Brain folder ${JSON.stringify(d.tried)} (${FROM[d.source]}) can't be used (${REFUSAL_LOG[d.reason]}). Waiting for one to be chosen in the app; Claude is off.`,
  );
}

/**
 * Once started (a second `pnpm start` that finds the port taken leaves them alone): the pages of chats
 * whose history is gone go to the Bin. Skipped when the chats can't be listed, so a failed read never
 * sweeps everything.
 */
function sweepPageCopies(): void {
  if (!brainPath || !pageCopies) return;
  const store = pageCopies;
  void engine
    .listSessions({ dir: brainPath })
    .then((past) => store.sweep(new Set(past.map((p) => p.sessionId))))
    .then((moved) => {
      if (moved > 0) log(`Moved the pages of ${moved} deleted chat${moved === 1 ? '' : 's'} to the Bin.`);
    })
    .catch(() => log('Could not tidy the pages of deleted chats.'));
}

/** Leftover temporary files of a crash mid-save (page copies and the library cache); fire and forget. */
function sweepTempFiles(): void {
  void pageCopies
    ?.sweepTemps?.()
    .then((n) => {
      if (n > 0) log(`Removed ${n} leftover temporary page file${n === 1 ? '' : 's'}.`);
    })
    .catch(() => log('Could not tidy leftover temporary page files.'));
  void sweepAssetTemps(config.dataDir)
    .then((n) => {
      if (n > 0) log(`Removed ${n} leftover temporary library file${n === 1 ? '' : 's'}.`);
    })
    .catch(() => log('Could not tidy leftover temporary library files.'));
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Closing chats and stopping.');
  setTimeout(() => process.exit(1), 20_000).unref();
  // Stops the timer and any update, and lets a rollback finish; the 20 s timer above bounds it.
  await updater.abort().catch(() => {});
  runner.killAll();
  app.stop();
  uploads.close();
  app.server.close();
  await sessions.closeAll().catch(() => {});
  app.server.closeAllConnections();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
