import { join } from 'node:path';
import {
  BRAIN_REFUSAL_TEXT,
  type BrainCheck,
  type DoctorCheck,
  type DoctorReport,
  type DoctorResult,
  MIN_NODE_VERSION,
  type SettingSource,
} from '../../shared/install-contract.ts';
import { decideBrain } from '../brain/decide.ts';

/** Every probe is injected, so tests need no Mac, no launchctl and no network. */
export interface DoctorDeps {
  appRoot: string;
  port: number;
  /** Null when runtime.json does not exist (not installed). Never created here. */
  launchToken: string | null;
  /** `resolveBrainPath`'s answer, unchecked: doctor makes the same decision as the server's start-up. */
  brainCandidate: { path: string; source: SettingSource };
  /** The service's PATH, not the terminal's. */
  servicePath: string[];
  logFile: string;
  signinAppDir: string;
  claudePath: string | null;
  /** Version the node launcher picks, like `24.15.0`, or null when it finds none. */
  nodeVersion(): Promise<string | null>;
  /** True when `tool` is an executable file in one of `dirs`. */
  which(tool: string, dirs: string[]): boolean;
  checkBrain(path: string): Promise<BrainCheck>;
  exists(path: string): boolean;
  isLoaded(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  /** Name of the program listening on the port, or null when it is free. */
  portOwner(port: number): Promise<string | null>;
  isOurServer(port: number, token: string): Promise<boolean>;
  readLogTail(file: string, lines: number): string[];
}

export const SERVICE_TOOLS = ['node', 'bash', 'git', 'jq', 'python3'] as const;

const meets = (version: string, min: string): boolean => {
  const a = version.replace(/^v/, '').split(/[.-]/).slice(0, 3).map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
};

export async function runDoctor(d: DoctorDeps): Promise<DoctorReport> {
  const results: DoctorResult[] = [];
  const add = (check: DoctorCheck, ok: boolean, good: string, bad: string) =>
    results.push({ check, ok, message: ok ? good : bad });

  const node = await d.nodeVersion();
  add(
    'node',
    node !== null && meets(node, MIN_NODE_VERSION),
    `Node ${node} is ready.`,
    node === null
      ? `The app could not find Node ${MIN_NODE_VERSION} or newer, so install it from nodejs.org or with nvm.`
      : `Node ${node} is too old, so install ${MIN_NODE_VERSION} or newer.`,
  );

  const missing = SERVICE_TOOLS.filter((t) => !d.which(t, d.servicePath));
  add(
    'tools',
    missing.length === 0,
    'The tools the brain needs are all available to the app.',
    `The app cannot find ${missing.join(', ')} on its own PATH, so install ${missing.length === 1 ? 'it' : 'them'} (for example with Homebrew).`,
  );

  add(
    'claude',
    d.claudePath !== null,
    'Claude Code is installed.',
    'Claude Code was not found, so install it and sign in before using chat.',
  );

  const decision = await decideBrain(d.brainCandidate, d.checkBrain);
  if (decision.kind === 'ready') {
    add('brain', true, 'The brain folder is ready.', '');
  } else if (decision.tried === null || decision.reason === null) {
    add('brain', false, '', 'No brain folder chosen yet; open TDS Brain to choose one.');
  } else {
    const where = decision.source === 'env' ? `${decision.tried}, set by TDS_BRAIN_PATH` : decision.tried;
    add('brain', false, '', `${BRAIN_REFUSAL_TEXT[decision.reason]} (${where})`);
  }

  add(
    'build',
    d.exists(join(d.appRoot, 'dist', 'client', 'index.html')),
    'The app is built.',
    'The app has not been built, so run "pnpm build" in the app folder.',
  );

  const loaded = await d.isLoaded();
  add(
    'agent-loaded',
    loaded,
    'The app is set to start when you log in.',
    'The app is not set to start at login, so run "tds-brain install --brain <folder>" again.',
  );

  const ours = d.launchToken !== null && (await d.isOurServer(d.port, d.launchToken));
  const owner = await d.portOwner(d.port);
  const foreign = !ours && owner !== null;
  add(
    'port',
    !foreign,
    ours ? `Port ${d.port} is being used by the app.` : `Port ${d.port} is free.`,
    `Another program (${owner}) is using port ${d.port}, so quit it and run "tds-brain restart".`,
  );
  add(
    'answering',
    ours,
    'The app is running and answering.',
    d.launchToken === null
      ? 'TDS Brain has not been installed here yet, so run "tds-brain install --brain <folder>".'
      : 'The app is not answering, so run "tds-brain restart".',
  );

  add(
    'login-item',
    !(await d.isDisabled()),
    'The login item is switched on.',
    'The login item is switched off, so switch "TDS Brain Sign-in" on in System Settings, General, Login Items.',
  );

  const bundle = join(d.signinAppDir, 'Contents', 'MacOS');
  add(
    'signin-app',
    d.exists(join(bundle, 'signin')) && d.exists(join(bundle, 'tds-brain-service')),
    'The Sign-in app is in place.',
    'The Sign-in app is missing or damaged, so run "tds-brain install --brain <folder>" again.',
  );

  const ok = results.every((r) => r.ok);
  return { ok, results, logTail: ok ? [] : d.readLogTail(d.logFile, 20) };
}
