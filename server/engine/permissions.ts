/**
 * Turning the engine's permission asks into plain cards (decision 5, amendment A1).
 *
 * "Allow for this chat" may only ever widen access for THIS session: anything that could become a
 * permanent rule, deny something, or switch to a looser mode is dropped here.
 */
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { ProposedChange } from '../../shared/contract.ts';
import { humaniseMcpServer } from './event-map.ts';
import { proposedChange } from './file-change.ts';

type Rec = Record<string, unknown>;

/** Longest detail the card shows in full (A12). A longer `Bash` command is refused, not shortened. */
export const MAX_DETAIL_CHARS = 20_000;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function isRules(v: unknown): v is { toolName: string; ruleContent?: string }[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (r) =>
        isRec(r) &&
        typeof r.toolName === 'string' &&
        (r.ruleContent === undefined || typeof r.ruleContent === 'string'),
    )
  );
}

/**
 * Keep only allow-`addRules`, `addDirectories` and `setMode: 'acceptEdits'`, each rewritten to the
 * `session` destination. Returns new objects; the input is not changed.
 */
export function narrowSuggestions(
  suggestions: readonly PermissionUpdate[] | undefined,
  suppressAlwaysAllowRule: boolean | undefined,
): PermissionUpdate[] {
  if (suppressAlwaysAllowRule || !Array.isArray(suggestions)) return [];
  const kept: PermissionUpdate[] = [];
  for (const u of suggestions as unknown[]) {
    if (!isRec(u)) continue;
    if (u.type === 'addRules' && u.behavior === 'allow' && isRules(u.rules)) {
      kept.push({
        type: 'addRules',
        behavior: 'allow',
        rules: u.rules.map((r) => (r.ruleContent === undefined ? { toolName: r.toolName } : { ...r })),
        destination: 'session',
      });
    } else if (
      u.type === 'addDirectories' &&
      Array.isArray(u.directories) &&
      u.directories.length > 0 &&
      u.directories.every((d) => typeof d === 'string')
    ) {
      kept.push({
        type: 'addDirectories',
        directories: [...(u.directories as string[])],
        destination: 'session',
      });
    } else if (u.type === 'setMode' && u.mode === 'acceptEdits') {
      kept.push({ type: 'setMode', mode: 'acceptEdits', destination: 'session' });
    }
  }
  return kept;
}

function describeRule(toolName: string, content: string | undefined): string {
  const mcp = /^mcp__(.+?)(?:__(.+))?$/.exec(toolName);
  if (mcp?.[1]) {
    const server = humaniseMcpServer(mcp[1]);
    return mcp[2] ? `using ${mcp[2]} from ${server}` : `using everything from ${server}`;
  }
  switch (toolName) {
    case 'Bash': {
      if (!content) return 'running any command';
      const prefix = /^(.*?)(?::\*| \*)$/.exec(content)?.[1];
      if (prefix !== undefined) {
        const shown = prefix.endsWith('/') ? `${prefix}...` : prefix;
        return `running \`${shown}\` commands`;
      }
      return `running the command \`${content}\``;
    }
    case 'Read':
      return content ? `reading ${content}` : 'reading files';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return content ? `changing ${content}` : 'changing files';
    case 'WebFetch': {
      const domain = content?.startsWith('domain:') ? content.slice('domain:'.length) : content;
      return domain ? `opening pages on ${domain}` : 'opening web pages';
    }
    case 'WebSearch':
      return 'searching the web';
    case 'Glob':
    case 'Grep':
      return 'searching files';
    case 'Skill':
      return content ? `using the ${content} skill` : 'using skills';
    default:
      return content ? `using ${toolName}(${content})` : `using ${toolName}`;
  }
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * The full sentence shown beside "Allow for this chat" (A13), or null when nothing safe is offered.
 * Edit mode is described by all it lets through: it also auto-approves rm, mv, cp, sed, mkdir and touch.
 */
export function describeSessionAllow(kept: readonly PermissionUpdate[]): string | null {
  const parts: string[] = [];
  for (const u of kept) {
    if (u.type === 'addRules') {
      for (const r of u.rules) parts.push(describeRule(r.toolName, r.ruleContent));
    } else if (u.type === 'addDirectories') {
      parts.push(`using files in ${u.directories.join(', ')}`);
    } else if (u.type === 'setMode' && u.mode === 'acceptEdits') {
      parts.push('creating, changing, moving and deleting files in the brain folder');
    }
  }
  const unique = [...new Set(parts)];
  if (unique.length === 0) return null;
  return `For the rest of this chat, Claude won't ask before ${joinList(unique)}.`;
}

function stringifyInput(input: Rec): string {
  try {
    return JSON.stringify(input, null, 2) ?? '';
  } catch {
    return '';
  }
}

export const OUTSIDE_BRAIN_WARNING = 'This file is outside the brain folder.';
export const LONG_COMMAND_WARNING = 'This is a long command. Scroll to the end before you allow it.';
export const HIDDEN_CHARS_WARNING =
  'This change has hidden characters that can make text look different from what is saved. They are shown as codes such as ⟨U+202E⟩. Only allow it if you expected them.';
const LONG_COMMAND_CHARS = 600;
const LONG_COMMAND_LINES = 8;

/** A root as written and as the disk resolves it (e.g. /tmp vs /private/tmp on macOS). */
function brainRoots(brainRoot: string): string[] {
  const roots = [resolve(brainRoot)];
  try {
    const real = realpathSync.native(brainRoot);
    if (!roots.includes(real)) roots.push(real);
  } catch {
    // the folder may not exist (tests); the resolved path is enough
  }
  return roots;
}

/**
 * A path inside the brain folder is shown relative to it; one in the app's attachments folder by its
 * file name (decision 10); one anywhere else keeps its full (resolved) path. Resolving first means
 * `brain/../elsewhere` cannot pass as inside.
 */
function placePath(p: string, roots: string[], uploads: string[]): { shown: string; outside: boolean } {
  const first = roots[0] ?? '/';
  const full = isAbsolute(p) ? resolve(p) : resolve(first, p);
  for (const root of uploads) {
    if (full === root || full.startsWith(root + sep)) {
      const parts = relative(root, full).split(sep).filter(Boolean);
      const name = parts.length >= 2 ? parts[parts.length - 1] : null;
      return { shown: name ? `Attached file: ${name}` : 'Attached files', outside: false };
    }
  }
  for (const root of roots) {
    if (full === root) return { shown: '.', outside: false };
    if (full.startsWith(root + sep)) return { shown: relative(root, full), outside: false };
  }
  return { shown: full, outside: true };
}

export interface PermissionCardContext {
  title?: string;
  blockedPath?: string;
  /** The brain folder: files inside it are shown relative to it, files outside get a warning. */
  brainRoot: string;
  /** The app's attachments folder (a real path), or null when uploads are off. */
  uploadsRoot?: string | null;
}

export interface PermissionCard {
  title: string;
  /** Plain text. Never shortened unless `warning` says so. */
  detail: string;
  warning: string | null;
  /** True for a `Bash` command too long to show in full: refuse it instead of asking (A12). */
  refuse: boolean;
  /** For Write, Edit and MultiEdit: the lines removed and added. Null for anything else. */
  change: ProposedChange | null;
}

/** The card's plain-text title, detail and warning. Nothing here is rendered as markdown or HTML. */
export function permissionCard(toolName: string, input: Rec, ctx: PermissionCardContext): PermissionCard {
  const roots = brainRoots(ctx.brainRoot);
  const uploads = ctx.uploadsRoot ? brainRoots(ctx.uploadsRoot) : [];
  let outside = false;
  const place = (p: string): string => {
    const r = placePath(p, roots, uploads);
    if (r.outside) outside = true;
    return r.shown;
  };
  const filePath = str(input.file_path) ?? str(input.notebook_path);
  const file = filePath ? place(filePath) : null;
  let title: string;
  let detail: string;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  switch (toolName) {
    case 'Write':
      title = 'Claude wants to save a file';
      detail = file ?? stringifyInput(input);
      break;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      title = 'Claude wants to change a file';
      detail = file ?? stringifyInput(input);
      break;
    case 'Read': {
      const p = str(input.path);
      title = 'Claude wants to read a file';
      detail = file ?? (p ? place(p) : stringifyInput(input));
      break;
    }
    case 'Bash':
      title = 'Claude wants to run a command';
      detail = str(input.command) ?? stringifyInput(input);
      break;
    case 'WebFetch':
      title = 'Claude wants to open a web page';
      detail = str(input.url) ?? stringifyInput(input);
      break;
    case 'WebSearch':
      title = 'Claude wants to search the web';
      detail = str(input.query) ?? stringifyInput(input);
      break;
    case 'Glob':
    case 'Grep': {
      const p = str(input.path);
      title = 'Claude wants to search files';
      detail = [str(input.pattern), p ? place(p) : null].filter(Boolean).join('\n') || stringifyInput(input);
      break;
    }
    case 'Skill': {
      const name = str(input.skill)?.replace(/^\//, '');
      title = name ? `Claude wants to use the ${name} skill` : 'Claude wants to use a skill';
      detail = str(input.args) ?? '';
      break;
    }
    case 'Agent':
    case 'Task':
      title = 'Claude wants to start a helper';
      detail = str(input.description) ?? '';
      break;
    default:
      title =
        mcp?.[1] && mcp[2]
          ? `Claude wants to use ${mcp[2]} from ${humaniseMcpServer(mcp[1])}`
          : `Claude wants to use ${toolName}`;
      detail = stringifyInput(input);
  }
  const engineTitle = str(ctx.title);
  if (engineTitle) title = engineTitle;

  const blocked = str(ctx.blockedPath);
  if (blocked) {
    const shown = place(blocked);
    if (!detail.includes(shown) && !detail.includes(blocked))
      detail = detail ? `${detail}\n\nPath: ${shown}` : shown;
  }

  const command = toolName === 'Bash' ? str(input.command) : null;
  const refuse = command !== null && command.length > MAX_DETAIL_CHARS;

  // Only whether the file is there is checked; its contents are never read (see file-change.ts).
  const fileExists =
    toolName === 'Write' && filePath !== null && existsSync(resolve(roots[0] ?? '/', filePath));
  const { change, cut, hiddenChars } = proposedChange(toolName, input, fileExists);

  const warnings: string[] = [];
  if (outside) warnings.push(OUTSIDE_BRAIN_WARNING);
  if (
    command !== null &&
    !refuse &&
    (command.length > LONG_COMMAND_CHARS || command.split('\n').length > LONG_COMMAND_LINES)
  ) {
    warnings.push(LONG_COMMAND_WARNING);
  }
  if (!refuse && detail.length > MAX_DETAIL_CHARS) {
    const n = detail.length.toLocaleString('en-GB');
    detail = `${detail.slice(0, MAX_DETAIL_CHARS)}…`;
    warnings.push(
      `This is too long to show in full (${n} characters). Only allow it if you know what Claude is doing.`,
    );
  }
  if (cut !== null) {
    const lines = cut.lines === 1 ? '1 line' : `${cut.lines.toLocaleString('en-GB')} lines`;
    warnings.push(
      `This change is too long to show in full (${lines}, ${cut.chars.toLocaleString('en-GB')} characters). Only allow it if you know what Claude is doing.`,
    );
  }
  if (hiddenChars) warnings.push(HIDDEN_CHARS_WARNING);
  return { title, detail, warning: warnings.length > 0 ? warnings.join(' ') : null, refuse, change };
}
