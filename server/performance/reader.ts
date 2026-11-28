/**
 * Reads Claude Code's session logs for Settings → Performance (plan 2026-11-28-settings-performance, decisions
 * 1, 3 and 5). Read-only and streamed line by line. Numbers only: from each assistant entry it keeps the date,
 * model and token counts; per file it keeps the first `cwd` and `gitBranch` and whether the session called
 * `REPL` (Code Mode). Message text, tool input and tool output are never kept, logged or returned.
 */
import { createReadStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { PerformanceErrorCode } from '../../shared/performance-contract.ts';

/** Carries only a code: Node errors hold full paths, so the message is never passed on. */
export class PerformanceError extends Error {
  readonly code: PerformanceErrorCode;
  constructor(code: PerformanceErrorCode) {
    super(code);
    this.name = 'PerformanceError';
    this.code = code;
  }
}

/** [date, model, input, cache write 5m, cache write 1h, cache read, output]: one request. */
export type ReqRow = [string, string, number, number, number, number, number];

export interface FileRead {
  cwd?: string;
  gitBranch?: string;
  /** Any line of this session called the REPL tool. */
  codeMode: boolean;
  /** ISO time of the earliest request; '' when there are none. */
  firstTs: string;
  /** By message id; the last line for an id wins. */
  reqs: Map<string, ReqRow>;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The local calendar date of an ISO time (or Date), as YYYY-MM-DD. */
export function localDate(when: string | Date): string {
  const d = typeof when === 'string' ? new Date(when) : when;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
const ASSISTANT = '"type":"assistant"';
const short = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

export async function readLogFile(path: string): Promise<FileRead> {
  const out: FileRead = { codeMode: false, firstTs: '', reqs: new Map() };
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const text of lines) {
    if (!text.includes(ASSISTANT)) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(text);
    } catch {
      continue;
    }
    const e = entry as {
      type?: unknown;
      timestamp?: unknown;
      cwd?: unknown;
      gitBranch?: unknown;
      message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown>; content?: unknown };
    };
    if (e?.type !== 'assistant' || !e.message) continue;
    if (out.cwd === undefined) {
      out.cwd = short(e.cwd, 1024);
      out.gitBranch = short(e.gitBranch, 256);
    }
    const m = e.message;
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        const b = block as { type?: unknown; name?: unknown } | null;
        if (b?.type === 'tool_use' && b.name === 'REPL') out.codeMode = true;
      }
    }
    const id = short(m.id, 200);
    const model = short(m.model, 100);
    const ts = typeof e.timestamp === 'string' ? new Date(e.timestamp) : null;
    if (!id || !model || model === '<synthetic>' || !m.usage || !ts || Number.isNaN(ts.getTime())) continue;
    const u = m.usage;
    const cc = (u.cache_creation ?? null) as Record<string, unknown> | null;
    const w5 = cc ? num(cc.ephemeral_5m_input_tokens) : num(u.cache_creation_input_tokens);
    const w1 = cc ? num(cc.ephemeral_1h_input_tokens) : 0;
    const iso = ts.toISOString();
    if (out.firstTs === '' || iso < out.firstTs) out.firstTs = iso;
    out.reqs.set(id, [
      localDate(ts),
      model,
      num(u.input_tokens),
      w5,
      w1,
      num(u.cache_read_input_tokens),
      num(u.output_tokens),
    ]);
  }
  return out;
}

export interface LogFile {
  /** Path under the logs root, with `/`; the key in the stored history. */
  key: string;
  path: string;
  kind: 'main' | 'agent';
  /** The main session's id; for an agent, its parent's. */
  sessionId: string;
  agentId?: string;
  agentType?: string;
  size: number;
  mtimeMs: number;
}

async function readDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function agentTypeOf(jsonlPath: string): Promise<string | undefined> {
  try {
    const meta = JSON.parse(await fs.readFile(jsonlPath.replace(/\.jsonl$/, '.meta.json'), 'utf8')) as {
      agentType?: unknown;
    };
    const t = short(meta.agentType, 80);
    return t && /^[\w .:-]+$/.test(t) ? t : undefined;
  } catch {
    return undefined;
  }
}

/** Every main and subagent log under `<root>` (the `projects` folder). Throws `logs-missing` when there is none. */
export async function listLogFiles(root: string): Promise<LogFile[]> {
  let projects: import('node:fs').Dirent[];
  try {
    projects = await fs.readdir(root, { withFileTypes: true });
  } catch {
    throw new PerformanceError('logs-missing');
  }
  const files: LogFile[] = [];
  const add = async (path: string, key: string, rest: Omit<LogFile, 'key' | 'path' | 'size' | 'mtimeMs'>) => {
    try {
      const st = await fs.stat(path);
      files.push({ key, path, size: st.size, mtimeMs: Math.round(st.mtimeMs), ...rest });
    } catch {
      // gone between listing and stat
    }
  };
  for (const proj of projects) {
    if (!proj.isDirectory()) continue;
    for (const entry of await readDir(join(root, proj.name))) {
      const base = `${proj.name}/${entry.name}`;
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const sessionId = entry.name.slice(0, -'.jsonl'.length);
        await add(join(root, base), base, { kind: 'main', sessionId });
      } else if (entry.isDirectory()) {
        // Agents sit in `subagents/` and, for workflow runs, one level down in `subagents/workflows/<run>/`.
        const folders = ['subagents'];
        for (const w of await readDir(join(root, base, 'subagents', 'workflows'))) {
          if (w.isDirectory()) folders.push(join('subagents', 'workflows', w.name));
        }
        for (const folder of folders) {
          for (const a of await readDir(join(root, base, folder))) {
            if (!a.isFile() || !/^agent-.*\.jsonl$/.test(a.name)) continue;
            const path = join(root, base, folder, a.name);
            const agentType = await agentTypeOf(path);
            await add(path, `${base}/${folder}/${a.name}`, {
              kind: 'agent',
              sessionId: entry.name,
              agentId: a.name.slice(0, -'.jsonl'.length),
              ...(agentType ? { agentType } : {}),
            });
          }
        }
      }
    }
  }
  return files;
}
