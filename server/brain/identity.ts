import { execFile } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import type { Identity } from '../../shared/contract.ts';
import { humanise, mapRole, memberSlug, readText } from './util.ts';

/** Runs a command and returns its output; rejects on failure. Injectable so tests need no git. */
export type Runner = (
  file: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string }>;

export const defaultRunner: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 1_000_000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout) });
    });
  });

/** One entry in `.team-config/roles.json`. Every field is unchecked: the file is hand-edited. */
type Member = { email?: unknown; name?: unknown; role?: unknown };

/** The team list from the brain, or `[]` when it is missing or malformed. */
async function readMembers(root: string): Promise<Member[]> {
  try {
    const raw = await readText(join(root, '.team-config', 'roles.json'));
    const members = raw ? (JSON.parse(raw) as { members?: unknown }).members : null;
    return Array.isArray(members) ? members.filter((x): x is Member => !!x && typeof x === 'object') : [];
  } catch {
    return [];
  }
}

function sameEmail(a: unknown, b: string | null): boolean {
  return typeof a === 'string' && b !== null && a.toLowerCase() === b.toLowerCase();
}

function osName(): string {
  try {
    return userInfo().username || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function fromWhoami(root: string, run: Runner): Promise<Identity | null> {
  try {
    const { stdout } = await run(process.execPath, [join(root, 'tools', 'whoami.cjs'), '--json'], {
      cwd: root,
      timeoutMs: 5000,
    });
    const j = JSON.parse(stdout) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    const name = str(j.name);
    const slug = str(j.slug) ?? (name ? memberSlug(name) : null);
    if (!slug) return null;
    return {
      name: name ?? slug,
      slug,
      email: str(j.email),
      role: mapRole(j.role),
      knownMember: j.knownMember === true,
    };
  } catch {
    return null;
  }
}

async function fromGit(root: string, run: Runner): Promise<Identity | null> {
  let email: string | null = null;
  try {
    const { stdout } = await run('git', ['config', 'user.email'], { cwd: root, timeoutMs: 5000 });
    email = stdout.trim() || null;
  } catch {
    return null;
  }
  if (!email) return null;
  const m = (await readMembers(root)).find((x) => sameEmail(x.email, email));
  if (m && typeof m.name === 'string' && m.name.trim() !== '') {
    return {
      name: m.name,
      slug: memberSlug(m.name),
      email: m.email as string,
      role: mapRole(m.role),
      knownMember: true,
    };
  }
  const os = osName();
  return {
    name: os,
    slug: memberSlug(os) || 'unknown',
    email,
    role: 'unknown',
    knownMember: false,
  };
}

/** Who is using this copy of the brain. Never throws. */
export async function readIdentity(root: string, run: Runner): Promise<Identity> {
  const viaWhoami = await fromWhoami(root, run);
  if (viaWhoami) return viaWhoami;
  const viaGit = await fromGit(root, run);
  if (viaGit) return viaGit;
  const os = osName();
  return {
    name: humanise(os),
    slug: memberSlug(os) || 'unknown',
    email: null,
    role: 'unknown',
    knownMember: false,
  };
}
