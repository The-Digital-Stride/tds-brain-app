/**
 * Which helpers a chat's current or last reply started (plan 2026-11-14-helpers-in-chats-drawer).
 *
 * A pure tracker, fed by the Agent hooks and by every raw engine message. Everything is keyed by the
 * Agent step's tool use id and merges in either order, so a hook call and a stream message for the same
 * id make one row. Status only moves forward: working, then done / failed / stopped. Only the main
 * chat's helpers are listed, never a helper's own helpers.
 */
import type { LiveHelper, LiveHelperStatus } from '../../shared/contract.ts';
import { LEVEL_TIERS, type LevelTier } from '../../shared/levels-contract.ts';
import { toolLabel } from './event-map.ts';
import { APP_HELPERS, isAppHelper } from './helpers.ts';

type Rec = Record<string, unknown>;

export interface HelperTracker {
  /** Agent PreToolUse hook, allow path only, with the call as it will run. */
  started(toolUseId: string, input: Record<string, unknown>, now?: Date): void;
  /** Agent end hooks. Unknown ids are ignored; an ended helper never changes again. */
  ended(toolUseId: string, how: 'done' | 'failed' | 'stopped', now?: Date): void;
  /** The call was refused before it ran: remove its row. */
  dropped(toolUseId: string): void;
  /** Every raw engine message, in order. 'now': notify at once; 'soon': progress changed; null: nothing. */
  observe(raw: unknown, now?: Date): 'now' | 'soon' | null;
  /** The reply ended, the engine died or the chat closed: working ones become 'stopped'. True if any changed. */
  stopAll(now?: Date): boolean;
  /** A new message was sent: forget the last reply's helpers. */
  clear(): void;
  /** Start order, oldest first; fresh copies. */
  list(): LiveHelper[];
  workingCount(): number;
}

const BRIEF_MAX = 120;

interface Row {
  helper: LiveHelper;
  /** The agent type the call named, if any. */
  type: string | null;
  stepIds: Set<string>;
}

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function briefOf(description: unknown): string {
  const one = typeof description === 'string' ? description.replace(/\s+/g, ' ').trim() : '';
  return one.length > BRIEF_MAX ? `${one.slice(0, BRIEF_MAX - 1).trimEnd()}…` : one;
}

function nameOf(type: string | null): string {
  if (isAppHelper(type)) return APP_HELPERS[type].label;
  return type ? `Helper (${type})` : 'Helper';
}

/** An app helper's own tier. Any other helper has no app level: Claude or its agent file picks its model. */
function tierOf(type: string | null): LevelTier | null {
  return isAppHelper(type) ? APP_HELPERS[type].tier : null;
}

/** The model a call runs on before its first message says: the one named, else an app helper's own. */
function modelOf(type: string | null, named: string | null): string | null {
  return named ?? (isAppHelper(type) ? LEVEL_TIERS[APP_HELPERS[type].tier].model : null);
}

export function createHelperTracker(): HelperTracker {
  const rows = new Map<string, Row>();

  function add(id: string, type: string | null, description: unknown, model: string | null, now: Date): Row {
    const row: Row = {
      type,
      stepIds: new Set(),
      helper: {
        id,
        name: nameOf(type),
        brief: briefOf(description),
        tier: tierOf(type),
        model: modelOf(type, model),
        status: 'working',
        startedAt: now.toISOString(),
        endedAt: null,
        steps: 0,
        lastStep: null,
      },
    };
    rows.set(id, row);
    return row;
  }

  /** Fill what a row doesn't know yet; never overwrite. True if anything changed. */
  function fill(row: Row, type: string | null, description: unknown, model: string | null): boolean {
    const h = row.helper;
    if (h.status !== 'working') return false;
    let changed = false;
    if (!row.type && type) {
      row.type = type;
      h.name = nameOf(type);
      changed = true;
    }
    if (!h.brief) {
      const brief = briefOf(description);
      if (brief) {
        h.brief = brief;
        changed = true;
      }
    }
    const known = modelOf(row.type, model);
    if (!h.model && known) {
      h.model = known;
      changed = true;
    }
    const tier = h.tier ?? tierOf(row.type);
    if (tier !== h.tier) {
      h.tier = tier;
      changed = true;
    }
    return changed;
  }

  function end(row: Row, how: LiveHelperStatus, now: Date): boolean {
    if (row.helper.status !== 'working') return false;
    row.helper.status = how;
    row.helper.endedAt = now.toISOString();
    return true;
  }

  function onTaskStarted(raw: Rec, now: Date): 'now' | null {
    if (raw.task_type !== 'local_agent') return null;
    if (raw.ambient === true || raw.skip_transcript === true) return null;
    if (typeof raw.spawn_depth === 'number' && raw.spawn_depth > 1) return null;
    if (raw.parent_task_id !== undefined && raw.parent_task_id !== null) return null;
    const id = str(raw.tool_use_id);
    if (!id) return null;
    const type = str(raw.subagent_type);
    const existing = rows.get(id);
    if (existing) return fill(existing, type, raw.description, null) ? 'now' : null;
    add(id, type, raw.description, null, now);
    return 'now';
  }

  function onTaskProgress(raw: Rec): 'soon' | null {
    const row = rows.get(str(raw.tool_use_id) ?? '');
    if (row?.helper.status !== 'working') return null;
    let changed = false;
    const uses = isRec(raw.usage) ? raw.usage.tool_uses : null;
    if (typeof uses === 'number' && uses > row.helper.steps) {
      row.helper.steps = uses;
      changed = true;
    }
    const tool = str(raw.last_tool_name);
    if (tool && !row.helper.lastStep) {
      row.helper.lastStep = toolLabel(tool, {});
      changed = true;
    }
    return changed ? 'soon' : null;
  }

  function onNotification(raw: Rec, now: Date): 'now' | null {
    const row = rows.get(str(raw.tool_use_id) ?? '');
    if (!row) return null;
    if (raw.status === 'failed') return end(row, 'failed', now) ? 'now' : null;
    if (raw.status === 'stopped') return end(row, 'stopped', now) ? 'now' : null;
    return null;
  }

  function onAssistant(raw: Rec): 'soon' | null {
    const row = rows.get(str(raw.parent_tool_use_id) ?? '');
    if (row?.helper.status !== 'working' || !isRec(raw.message)) return null;
    let changed = false;
    // Only a real model id: Claude Code's own error and interrupt messages say "<synthetic>".
    const model = str(raw.message.model);
    if (model?.startsWith('claude-') && model !== row.helper.model) {
      row.helper.model = model;
      changed = true;
    }
    if (Array.isArray(raw.message.content)) {
      for (const block of raw.message.content) {
        if (!isRec(block) || block.type !== 'tool_use') continue;
        const id = str(block.id);
        const tool = str(block.name);
        if (!id || !tool || row.stepIds.has(id)) continue;
        row.stepIds.add(id);
        row.helper.steps = Math.max(row.helper.steps + 1, row.stepIds.size);
        row.helper.lastStep = toolLabel(tool, isRec(block.input) ? block.input : {});
        changed = true;
      }
    }
    return changed ? 'soon' : null;
  }

  function onUser(raw: Rec, now: Date): 'now' | null {
    if (raw.parent_tool_use_id !== undefined && raw.parent_tool_use_id !== null) return null;
    if (!isRec(raw.message) || !Array.isArray(raw.message.content)) return null;
    let ended = false;
    for (const block of raw.message.content) {
      if (!isRec(block) || block.type !== 'tool_result') continue;
      const row = rows.get(str(block.tool_use_id) ?? '');
      if (row && end(row, block.is_error === true ? 'failed' : 'done', now)) ended = true;
    }
    return ended ? 'now' : null;
  }

  return {
    started(id, input, now = new Date()) {
      if (!id) return;
      const type = str(input.subagent_type);
      const model = str(input.model);
      const existing = rows.get(id);
      if (existing) fill(existing, type, input.description, model);
      else add(id, type, input.description, model, now);
    },
    ended(id, how, now = new Date()) {
      const row = rows.get(id);
      if (row) end(row, how, now);
    },
    dropped(id) {
      rows.delete(id);
    },
    observe(raw, now = new Date()) {
      if (!isRec(raw)) return null;
      if (raw.type === 'system') {
        if (raw.subtype === 'task_started') return onTaskStarted(raw, now);
        if (raw.subtype === 'task_progress') return onTaskProgress(raw);
        if (raw.subtype === 'task_notification') return onNotification(raw, now);
        return null;
      }
      if (raw.type === 'assistant') return onAssistant(raw);
      if (raw.type === 'user') return onUser(raw, now);
      return null;
    },
    stopAll(now = new Date()) {
      let changed = false;
      for (const row of rows.values()) if (end(row, 'stopped', now)) changed = true;
      return changed;
    },
    clear() {
      rows.clear();
    },
    list() {
      return [...rows.values()].map((r) => ({ ...r.helper }));
    },
    workingCount() {
      let n = 0;
      for (const r of rows.values()) if (r.helper.status === 'working') n++;
      return n;
    },
  };
}
