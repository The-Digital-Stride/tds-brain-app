import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Identity, Role, SkillInfo } from '../../shared/contract.ts';
import { asString, parseFrontmatter } from './frontmatter.ts';
import { humanise, mapRole, readText } from './util.ts';

interface Entry {
  info: SkillInfo;
  userInvocable: boolean;
}

function parseRoles(raw: string): Role[] | null {
  if (raw.trim() === '') return null;
  const roles = raw
    .split(/[,\s]+/)
    .map((r) => mapRole(r))
    .filter((r) => r !== 'unknown');
  return [...new Set(roles)];
}

/** The first sentence of `text`, or about 200 characters, whichever is shorter. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(flat);
  const s = m?.[1] ?? flat;
  return s.length > 200 ? `${s.slice(0, 197).trimEnd()}...` : s;
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (t !== '' && !t.startsWith('#') && !t.startsWith('---')) return firstSentence(t);
  }
  return '';
}

function build(name: string, kind: 'skill' | 'command', text: string): Entry {
  const { data, body } = parseFrontmatter(text);
  const mat = (asString(data.maturity) || asString(data.status)).toLowerCase();
  const description = asString(data.description).replace(/\s+/g, ' ').trim();
  return {
    info: {
      name,
      title: humanise(name),
      description: description || (kind === 'command' ? firstParagraph(body) : ''),
      kind,
      maturity: mat === 'draft' || mat === 'live' || mat === 'trusted' ? mat : null,
      argumentHint: asString(data['argument-hint']).trim() || null,
      restrictedTo: parseRoles(asString(data.roles)),
    },
    userInvocable: asString(data['user-invocable']).trim().toLowerCase() !== 'false',
  };
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}

/** Every skill and command in the brain, hidden ones included. A skill beats a command of the same name. */
async function loadAll(root: string): Promise<Map<string, Entry>> {
  const all = new Map<string, Entry>();
  for (const name of await listNames(join(root, '.claude', 'commands'))) {
    if (!name.endsWith('.md')) continue;
    const text = await readText(join(root, '.claude', 'commands', name));
    if (text !== null) all.set(name.slice(0, -3), build(name.slice(0, -3), 'command', text));
  }
  for (const name of await listNames(join(root, '.claude', 'skills'))) {
    const text = await readText(join(root, '.claude', 'skills', name, 'SKILL.md'));
    if (text !== null) all.set(name, build(name, 'skill', text));
  }
  return all;
}

function effectiveRole(identity: Identity): Role {
  return identity.role === 'unknown' ? 'team' : identity.role;
}

function mayRun(e: Entry, identity: Identity): boolean {
  return e.info.restrictedTo === null || e.info.restrictedTo.includes(effectiveRole(identity));
}

export async function listSkills(root: string, identity: Identity): Promise<SkillInfo[]> {
  const all = await loadAll(root);
  return [...all.values()]
    .filter((e) => e.userInvocable && mayRun(e, identity))
    .map((e) => e.info)
    .sort(
      (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name),
    );
}

export async function skillAccess(
  root: string,
  identity: Identity,
  name: string,
): Promise<'allowed' | 'restricted' | 'unknown-skill'> {
  const e = (await loadAll(root)).get(name);
  if (!e) return 'unknown-skill';
  return mayRun(e, identity) ? 'allowed' : 'restricted';
}
