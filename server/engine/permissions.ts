/**
 * Turning the engine's permission asks into plain cards (decision 5, amendment A1).
 *
 * "Allow for this chat" may only ever widen access for THIS session: anything that could become a
 * permanent rule, deny something, or switch to a looser mode is dropped here.
 */
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { humaniseMcpServer } from './event-map.ts';

type Rec = Record<string, unknown>;

const MAX_DETAIL = 2000;

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
    return mcp[2] ? `${mcp[2]} from ${server}` : `everything from ${server}`;
  }
  switch (toolName) {
    case 'Bash': {
      if (!content) return 'any command';
      const prefix = /^(.*?)(?::\*| \*)$/.exec(content)?.[1];
      if (prefix !== undefined) {
        const shown = prefix.endsWith('/') ? `${prefix}...` : prefix;
        return `\`${shown}\` commands`;
      }
      return `the command \`${content}\``;
    }
    case 'Read':
      return content ? `reading ${content}` : 'reading files';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return content ? `editing ${content}` : 'file edits';
    case 'WebFetch': {
      const domain = content?.startsWith('domain:') ? content.slice('domain:'.length) : content;
      return domain ? `opening pages on ${domain}` : 'opening web pages';
    }
    case 'WebSearch':
      return 'web searches';
    case 'Glob':
    case 'Grep':
      return 'searching files';
    case 'Skill':
      return content ? `the ${content} skill` : 'skills';
    default:
      return content ? `${toolName}(${content})` : toolName;
  }
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The plain sentence shown under "Allow for this chat", or null when nothing safe is offered. */
export function describeSessionAllow(kept: readonly PermissionUpdate[]): string | null {
  const parts: string[] = [];
  for (const u of kept) {
    if (u.type === 'addRules') {
      for (const r of u.rules) parts.push(describeRule(r.toolName, r.ruleContent));
    } else if (u.type === 'addDirectories') {
      parts.push(`access to files in ${u.directories.join(', ')}`);
    } else if (u.type === 'setMode' && u.mode === 'acceptEdits') {
      parts.push('file edits without asking');
    }
  }
  const unique = [...new Set(parts)];
  if (unique.length === 0) return null;
  return `Also allow ${joinList(unique)} in this chat`;
}

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL)}…` : text;
}

function stringifyInput(input: Rec): string {
  try {
    return JSON.stringify(input, null, 2) ?? '';
  } catch {
    return '';
  }
}

export interface PermissionCardContext {
  title?: string;
  blockedPath?: string;
}

/** The card's plain-text title and detail. Nothing here is rendered as markdown or HTML. */
export function permissionCard(
  toolName: string,
  input: Rec,
  ctx: PermissionCardContext,
): { title: string; detail: string } {
  const file = str(input.file_path) ?? str(input.notebook_path);
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
    case 'Read':
      title = 'Claude wants to read a file';
      detail = file ?? str(input.path) ?? stringifyInput(input);
      break;
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
    case 'Grep':
      title = 'Claude wants to search files';
      detail = [str(input.pattern), str(input.path)].filter(Boolean).join('\n') || stringifyInput(input);
      break;
    case 'Skill': {
      const name = str(input.skill) ?? 'a';
      title = `Claude wants to use the ${name.replace(/^\//, '')} skill`;
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
  if (blocked && !detail.includes(blocked)) detail = detail ? `${detail}\n\nPath: ${blocked}` : blocked;
  return { title, detail: clip(detail) };
}
