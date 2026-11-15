/**
 * Context management (plan 2026-11-14-context-management): the pure rules the session manager builds
 * on. No I/O, no clock (callers pass `now`).
 *
 * - `shouldKeepModel` (decision 10): hold an automatic downward model switch that would re-read a
 *   long chat at real cost.
 * - `reanchorText` (decision 8): what Claude is told after a compaction.
 * - `contextReading` (decision 4): the engine's `getContextUsage` answer as a `context` event.
 * - `contextItems` (decisions 6 and 12): the engine's `detail: 'full'` answer as Inspector rows.
 */
import {
  CONTEXT_THRESHOLDS,
  type ContextEvent,
  type ContextItem,
  type ContextSource,
  REANCHOR_CLOSING_LINE,
  type ReanchorTextFn,
  type ShouldKeepModelFn,
} from '../../shared/context-contract.ts';
import { isHigherTier } from './levels.ts';

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

// ---------------------------------------------------------------------------
// Decision 10
// ---------------------------------------------------------------------------

export const shouldKeepModel: ShouldKeepModelFn = (i) => {
  // Upward and sideways always go ahead, and so does anything the person chose.
  if (i.explicit || !isHigherTier(i.fromTier, i.toTier)) return false;
  // Its own cache is still warm (spike S6), whatever the hook estimates.
  if (i.targetRecentlyUsed) return false;
  if (i.lowerWantedTurns >= CONTEXT_THRESHOLDS.keepModelMaxTurns) return false;
  if (!i.cacheWarm) return false;
  if (i.estimatedUsd !== null) return i.estimatedUsd >= CONTEXT_THRESHOLDS.keepModelMinUsd;
  // Fallback for engines without the hook: no price, so a size floor stands in for it.
  return i.usedTokens !== null && i.usedTokens >= CONTEXT_THRESHOLDS.fallbackMinTokens;
};

// ---------------------------------------------------------------------------
// Decision 8
// ---------------------------------------------------------------------------

export const reanchorText: ReanchorTextFn = (input) => {
  const max = CONTEXT_THRESHOLDS.reanchorMaxChars;
  // Room left for everything before the closing line (and the newline in front of it).
  let room = max - REANCHOR_CLOSING_LINE.length - 1;
  const lines: string[] = [];
  const add = (line: string): boolean => {
    if (line.length + 1 > room) return false;
    lines.push(line);
    room -= line.length + 1;
    return true;
  };
  if (input.todo) {
    const tail = ` (${input.todo.path})`;
    const head = 'To-do for this chat: ';
    const titleRoom = Math.max(0, room - 1 - head.length - tail.length);
    const title =
      input.todo.title.length > titleRoom
        ? `${input.todo.title.slice(0, Math.max(0, titleRoom - 1))}…`
        : input.todo.title;
    add(`${head}${title}${tail}`);
  }
  if (input.files.length > 0 && add('Brain files this chat used, newest first:')) {
    for (const f of input.files) if (!add(`- ${f}`)) break;
  }
  if (input.workingHelpers.length > 0) {
    const shown: string[] = [];
    for (const h of input.workingHelpers) {
      const next = `Helpers still working: ${[...shown, h].join('; ')}`;
      if (next.length + 1 > room) break;
      shown.push(h);
    }
    if (shown.length > 0) add(`Helpers still working: ${shown.join('; ')}`);
  }
  lines.push(REANCHOR_CLOSING_LINE);
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Decision 4
// ---------------------------------------------------------------------------

/** usedTokens / limitTokens × 100, rounded. */
export function percentOf(used: number, limit: number): number {
  return limit > 0 ? Math.round((used / limit) * 100) : 0;
}

/**
 * `getContextUsage` (`summary` or `full`) → a reading, or null when the answer is not usable. The
 * meter measures against the auto-summarise threshold, else the window when auto-summarising is off.
 */
export function contextReading(
  res: unknown,
  now: number,
  source: ContextSource = 'engine',
): ContextEvent | null {
  if (!isRec(res)) return null;
  const used = res.totalTokens;
  const windowTokens = count(res.rawMaxTokens);
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0 || windowTokens === 0) return null;
  const threshold = count(res.autoCompactThreshold);
  const autoCompact = res.isAutoCompactEnabled === true && threshold > 0;
  const limitTokens = autoCompact ? threshold : windowTokens;
  const usedTokens = Math.round(used);
  return {
    type: 'context',
    usedTokens,
    limitTokens,
    windowTokens,
    percent: percentOf(usedTokens, limitTokens),
    autoCompact,
    source,
    at: now,
  };
}

// ---------------------------------------------------------------------------
// Decisions 6 and 12
// ---------------------------------------------------------------------------

const ITEMS_MAX = 12;
/** Advice only for person-owned items above this (decision 12). */
const ADVICE_MIN_TOKENS = 2_000;
/** `messageBreakdown.attachmentsByType` rows that are start-up hook output (spike baseline). */
const HOOK_ATTACHMENTS = new Set(['hook_success', 'hook_additional_context']);

function aboutK(tokens: number): string {
  return `about ${Math.max(1, Math.round(tokens / 1000))}k tokens`;
}

/** One key per connector, whichever way the engine spells its name (`claude_ai_Gmail`, `claude.ai Gmail`). */
function serverKey(name: string): string {
  return serverLabel(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function serverLabel(name: string): string {
  const cleaned = name
    .replace(/^claude[._ ]ai[_ ]/i, '')
    .replace(/^plugin_[^_]+_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\bcom$/i, '')
    .trim();
  return cleaned || name;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** The engine's `detail: 'full'` answer → Inspector rows. Grouped from `id`/`kind`, never `name`. */
export function contextItems(res: unknown): ContextItem[] {
  if (!isRec(res) || !Array.isArray(res.categories)) return [];
  const items: ContextItem[] = [];
  const breakdown = isRec(res.messageBreakdown) ? res.messageBreakdown : {};
  const hookTokens = (Array.isArray(breakdown.attachmentsByType) ? breakdown.attachmentsByType : [])
    .filter((a): a is Rec => isRec(a) && typeof a.name === 'string' && HOOK_ATTACHMENTS.has(a.name))
    .reduce((n, a) => n + count(a.tokens), 0);

  // Connectors: loaded tool schemas and instructions per server; deferred schemas per server.
  const connectors = new Map<string, { label: string; tokens: number; deferred: number }>();
  const server = (name: string) => {
    const key = serverKey(name);
    let row = connectors.get(key);
    if (!row) {
      row = { label: serverLabel(name), tokens: 0, deferred: 0 };
      connectors.set(key, row);
    }
    return row;
  };
  const mcpTools = Array.isArray(res.mcpTools) ? res.mcpTools.filter(isRec) : null;
  const mcpInstructions = Array.isArray(res.mcpInstructions) ? res.mcpInstructions.filter(isRec) : null;
  for (const t of mcpTools ?? []) {
    if (typeof t.serverName !== 'string') continue;
    const row = server(t.serverName);
    if (t.isLoaded === false) row.deferred += count(t.tokens);
    else row.tokens += count(t.tokens);
  }
  for (const t of mcpInstructions ?? []) {
    if (typeof t.serverName === 'string') server(t.serverName).tokens += count(t.tokens);
  }

  for (const c of res.categories) {
    if (!isRec(c)) continue;
    const tokens = count(c.tokens);
    const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Other';
    switch (c.id) {
      case 'messages':
        items.push({ name: 'Messages', tokens: Math.max(0, tokens - hookTokens), group: 'messages' });
        break;
      case 'system_prompt':
        items.push({ name: 'System prompt', tokens, group: 'system' });
        break;
      case 'system_tools':
        items.push({ name: 'Built-in tools', tokens, group: 'tools' });
        break;
      case 'system_tools_deferred':
        items.push({ name: 'Built-in tools, not loaded until used', tokens, group: 'tools', deferred: true });
        break;
      case 'mcp_tools':
        if (!mcpTools) items.push({ name: 'Connector tools', tokens, group: 'connectors' });
        break;
      case 'mcp_instructions':
        if (!mcpInstructions) items.push({ name: 'Connector instructions', tokens, group: 'connectors' });
        break;
      case 'mcp_tools_deferred':
        if (!mcpTools)
          items.push({
            name: 'Connector tools, not loaded until used',
            tokens,
            group: 'tools',
            deferred: true,
          });
        break;
      case 'custom_agents':
        items.push({ name: 'Helper agents', tokens, group: 'agents' });
        break;
      case 'memory_files':
        if (!Array.isArray(res.memoryFiles)) items.push({ name: 'Memory files', tokens, group: 'memory' });
        break;
      case 'skills':
        items.push(skillRow(count(isRec(res.skills) ? res.skills.tokens : 0) || tokens));
        break;
      case 'free_space':
      case 'autocompact_buffer':
      case 'compact_buffer':
        // Room, not something filling the chat: the reading already says how much is left.
        break;
      default:
        // An id this app doesn't know yet: classify on `kind`; the name is only shown.
        if (c.kind === 'free' || c.kind === 'buffer') break;
        if (c.kind === 'deferred') items.push({ name, tokens, group: 'tools', deferred: true });
        else items.push({ name, tokens, group: 'system' });
    }
  }

  if (hookTokens > 0) {
    items.push({
      name: 'Start-up text from plugins and hooks',
      tokens: hookTokens,
      group: 'system',
      ...(hookTokens > ADVICE_MIN_TOKENS
        ? {
            advice: `Start-up text from your plugins: ${aboutK(hookTokens)} in every chat. If you don't need a plugin here, turn it off in Claude's settings.`,
          }
        : {}),
    });
  }
  for (const row of connectors.values()) {
    if (row.tokens > 0) {
      items.push({
        name: `${row.label} connector`,
        tokens: row.tokens,
        group: 'connectors',
        ...(row.tokens > ADVICE_MIN_TOKENS
          ? {
              advice: `The ${row.label} connector: ${aboutK(row.tokens)} in every chat. If you don't need it here, turn it off in Claude's settings.`,
            }
          : {}),
      });
    }
    if (row.deferred > 0) {
      items.push({
        name: `${row.label} connector tools, not loaded until used`,
        tokens: row.deferred,
        group: 'tools',
        deferred: true,
      });
    }
  }
  if (Array.isArray(res.memoryFiles)) {
    for (const m of res.memoryFiles) {
      if (!isRec(m) || typeof m.path !== 'string') continue;
      const tokens = count(m.tokens);
      const type = typeof m.type === 'string' ? m.type : '';
      // Only the person's own memory is theirs to trim: the brain's files are never the app's to advise on.
      const personal = /user/i.test(type);
      items.push({
        name: personal ? `Your memory file (${baseName(m.path)})` : `Memory file (${baseName(m.path)})`,
        tokens,
        group: 'memory',
        ...(personal && tokens > ADVICE_MIN_TOKENS
          ? {
              advice: `Your own memory file: ${aboutK(tokens)} in every chat. Keeping it short leaves more room for the conversation.`,
            }
          : {}),
      });
    }
  }

  // What fills the chat first (the heaviest ITEMS_MAX), then what loads only when used, so held-back
  // connector schemas never push the rows that carry advice out of the list.
  const largestFirst = (a: ContextItem, b: ContextItem) => b.tokens - a.tokens;
  const shown = items.filter((i) => i.tokens > 0);
  return [
    ...shown
      .filter((i) => !i.deferred)
      .sort(largestFirst)
      .slice(0, ITEMS_MAX),
    ...shown.filter((i) => i.deferred).sort(largestFirst),
  ];
}

function skillRow(tokens: number): ContextItem {
  return {
    name: 'Skill list',
    tokens,
    group: 'skills',
    ...(tokens > ADVICE_MIN_TOKENS
      ? {
          advice: `Your skill list: ${aboutK(tokens)} in every chat. If you don't use some of your own skills or plugins here, turn them off in Claude's settings.`,
        }
      : {}),
  };
}
