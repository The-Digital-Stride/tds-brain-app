import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { type AppPrefs, type AppStore, DEFAULT_PREFS } from '../../shared/contract.ts';

const MAX_PINS = 100;
const MAX_TEXT = 200;

function cleanPins(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x === 'string' && x !== '' && x.length <= MAX_TEXT) seen.add(x);
    if (seen.size >= MAX_PINS) break;
  }
  return [...seen];
}

/** Keeps only known keys with valid values; anything else falls back to `base`. */
function sanitise(input: unknown, base: AppPrefs): AppPrefs {
  const o =
    input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const lastClient = o.lastClient;
  return {
    pins: cleanPins(o.pins) ?? [...base.pins],
    lastClient:
      lastClient === null ||
      (typeof lastClient === 'string' && lastClient !== '' && lastClient.length <= MAX_TEXT)
        ? (lastClient as string | null)
        : base.lastClient,
    todoPanelOpen: typeof o.todoPanelOpen === 'boolean' ? o.todoPanelOpen : base.todoPanelOpen,
    directWrites: typeof o.directWrites === 'boolean' ? o.directWrites : base.directWrites,
  };
}

export function createAppStore(dataDir: string): AppStore {
  const file = join(dataDir, 'prefs.json');
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<AppPrefs> {
    try {
      return sanitise(JSON.parse(await fs.readFile(file, 'utf8')), DEFAULT_PREFS);
    } catch {
      return sanitise({}, DEFAULT_PREFS);
    }
  }

  async function write(prefs: AppPrefs): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tmp, `${JSON.stringify(prefs, null, 2)}\n`);
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  }

  return {
    get: () => serial(read),
    update: (patch) =>
      serial(async () => {
        const current = await read();
        const next = sanitise({ ...current, ...(patch as object) }, current);
        await write(next);
        return next;
      }),
  };
}
