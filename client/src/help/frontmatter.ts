import {
  HELP_AREAS,
  HELP_SUMMARY_MAX,
  type HelpArea,
  type HelpRoles,
  type HelpTopic,
  type ParseHelpFile,
} from './contract.ts';

type Value = string | string[];

/** Splits a help file into its frontmatter (`key: value`, `[a, b]` lists, `#` comments) and the Markdown body. */
export function splitFrontmatter(raw: string): { data: Record<string, Value>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!m) return null;
  const data: Record<string, Value> = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    const value = t
      .slice(i + 1)
      .replace(/(^|\s)#.*$/, '')
      .trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      data[key] = value.replace(/^(["'])(.*)\1$/, '$2');
    }
  }
  return { data, body: raw.slice(m[0].length).replace(/^\s*\n/, '') };
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const parseHelpFile: ParseHelpFile = (fileName, raw) => {
  const split = splitFrontmatter(raw);
  if (!split)
    return { ok: false, errors: [`${fileName}: the file has no frontmatter block between --- lines.`] };
  const { data, body } = split;
  const errors: string[] = [];
  const str = (key: string): string => {
    const v = data[key];
    if (typeof v !== 'string' || v === '') {
      errors.push(`${fileName}: "${key}" is missing.`);
      return '';
    }
    return v;
  };

  const id = str('id');
  if (id && !ID.test(id)) errors.push(`${fileName}: "id" must be kebab-case.`);
  if (id && `${id}.md` !== fileName) errors.push(`${fileName}: "id" (${id}) must match the file name.`);
  const title = str('title');
  const areaRaw = str('area');
  if (areaRaw && !(HELP_AREAS as readonly string[]).includes(areaRaw))
    errors.push(`${fileName}: "area" (${areaRaw}) is not one of ${HELP_AREAS.join(', ')}.`);
  const orderRaw = str('order');
  const order = Number(orderRaw);
  if (orderRaw && !/^\d+$/.test(orderRaw)) errors.push(`${fileName}: "order" must be a whole number.`);
  const summary = str('summary');
  if (summary.length > HELP_SUMMARY_MAX)
    errors.push(`${fileName}: "summary" is ${summary.length} characters; the limit is ${HELP_SUMMARY_MAX}.`);
  const benefit = str('benefit');
  const since = str('since');
  if (since && !/^\d+\.\d+\.\d+$/.test(since)) errors.push(`${fileName}: "since" must look like 0.36.0.`);
  const reviewed = str('reviewed');
  if (reviewed && !/^\d{4}-\d{2}-\d{2}$/.test(reviewed))
    errors.push(`${fileName}: "reviewed" must be a date like 2026-11-20.`);

  let roles: HelpRoles = 'all';
  const rolesRaw = data.roles;
  if (rolesRaw === undefined) errors.push(`${fileName}: "roles" is missing.`);
  else if (rolesRaw !== 'all') {
    if (
      Array.isArray(rolesRaw) &&
      rolesRaw.length > 0 &&
      rolesRaw.every((r) => r === 'owner' || r === 'scout')
    )
      roles = rolesRaw as ('owner' | 'scout')[];
    else errors.push(`${fileName}: "roles" must be all, or a list of owner and scout.`);
  }
  let related: string[] = [];
  const relatedRaw = data.related;
  if (relatedRaw === undefined) related = [];
  else if (Array.isArray(relatedRaw)) related = relatedRaw;
  else errors.push(`${fileName}: "related" must be a list like [a, b].`);

  if (errors.length > 0) return { ok: false, errors };
  const topic: HelpTopic = {
    id,
    title,
    area: areaRaw as HelpArea,
    order,
    summary,
    benefit,
    roles,
    related,
    since,
    reviewed,
    body,
  };
  return { ok: true, topic };
};
