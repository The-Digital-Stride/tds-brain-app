/**
 * The app's helpers (plan 2026-11-14-skill-levels-and-helpers, decisions 10–14).
 *
 * Three helpers Claude can hand parts of a job to, each on the cheapest tier that does its job well,
 * plus the pure rules of the one Agent hook that keeps every helper in line: helpers run in the
 * foreground, there are only so many at once and per reply, and (in automatic mode, on Deep) a
 * built-in helper that names no model doesn't silently run on the most expensive one.
 */
import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import {
  HELPER_NAMES,
  HELPERS_AT_ONCE_MAX,
  HELPERS_PER_REPLY_MAX,
  type HelperName,
  type HelperSpec,
  LEVEL_TIERS,
  type LevelMode,
  type LevelTier,
  OTHER_HELPER_TIER,
} from '../../shared/levels-contract.ts';

type Rec = Record<string, unknown>;

/** No helper may change files, start helpers of its own or (in `tools`) use Skill. */
const NO_WRITES = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent'];
const NO_SPAWNING = ['Workflow', 'CronCreate', 'ScheduleWakeup', 'RemoteTrigger', 'EnterWorktree'];
const READ_AND_WEB = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

/** Claude Code's own helper types. Agents from brain or personal agent files are not in this list. */
export const BUILT_IN_HELPERS: readonly string[] = ['general-purpose', 'Explore', 'Plan'];

const BASE_PROMPT = [
  'You are a helper in the TDS Brain app, working for the main chat on one part of a job.',
  'Work only on your brief. Never file, save or change anything in the brain: the main chat does any filing.',
  'When you are done, return a short report: what you found or did, with the brain path of every file you mention in backticks and the source of every fact or figure, plus anything you could not do and why.',
].join(' ');

export interface AppHelper extends HelperSpec {
  /** What Claude reads when it chooses a helper. */
  description: string;
  prompt: string;
}

export const APP_HELPERS: Record<HelperName, AppHelper> = {
  'tdsapp-scout': {
    tier: 'quick',
    label: 'Scout',
    description:
      'Quick look-ups: finds files, facts and figures in the brain or on the web and reports them back. Read-only. Use it for searching and gathering, not for judgement or changes.',
    prompt: `${BASE_PROMPT} Find what the brief asks for quickly and report it plainly; don't analyse beyond the brief.`,
    tools: READ_AND_WEB,
    disallowedTools: NO_WRITES,
    maxTurns: 15,
  },
  'tdsapp-worker': {
    tier: 'standard',
    label: 'Worker',
    description:
      "Does one self-contained part of a bigger job (for example one client, channel or source) and reports back. It can run commands and use the person's connectors, which still ask the person first, but it can't edit files or file anything in the brain. If the part follows a skill, name that skill's SKILL.md in the brief.",
    prompt: `${BASE_PROMPT} If your brief names a SKILL.md, read it first and follow its steps for your part only, leaving any filing to the main chat. Commands and connectors may ask the person first; if one is refused, say so in your report instead of finding another way round it.`,
    // `mcp__*` in `tools` is not honoured (spike 12): inherit the chat's tools and disallow the rest.
    tools: null,
    // It inherits every tool, so also block those that start agents or schedule work outside the caps.
    disallowedTools: [...NO_WRITES, 'Task', 'Skill', ...NO_SPAWNING],
    maxTurns: 30,
  },
  'tdsapp-expert': {
    tier: 'deep',
    label: 'Expert',
    description:
      'Careful checks and judgement: reviews work, weighs evidence and spots problems or risks. Read-only, with web access. Use it when a part of the job needs a considered verdict.',
    prompt: `${BASE_PROMPT} Check carefully and give a clear verdict with your reasons, most important first.`,
    tools: READ_AND_WEB,
    disallowedTools: NO_WRITES,
    maxTurns: 20,
  },
};

export function isAppHelper(v: unknown): v is HelperName {
  return typeof v === 'string' && (HELPER_NAMES as readonly string[]).includes(v);
}

/** `options.agents` for a chat. Fresh copies every time. Never `permissionMode` or `background`. */
export function helperAgents(): Record<HelperName, AgentDefinition> {
  const out = {} as Record<HelperName, AgentDefinition>;
  for (const name of HELPER_NAMES) {
    const h = APP_HELPERS[name];
    const tier = LEVEL_TIERS[h.tier];
    const def: AgentDefinition = {
      description: h.description,
      prompt: h.prompt,
      model: tier.model,
      effort: tier.effort,
      disallowedTools: [...h.disallowedTools],
      maxTurns: h.maxTurns,
    };
    if (h.tools) def.tools = [...h.tools];
    out[name] = def;
  }
  return out;
}

// ---------------------------------------------------------------------------
// When Claude uses helpers (decision 11)
// ---------------------------------------------------------------------------

/** Added to every levelled chat's system-prompt line. */
export const HELPERS_LINE = [
  'Helpers: most requests need no helpers, so do the work yourself.',
  'Use helpers only when the job splits into two or more independent parts, such as several clients, channels or sources.',
  "Then prefer the app's own: tdsapp-scout to find files, facts and figures, tdsapp-worker to do one part of the job, tdsapp-expert for checks and judgement.",
  'Give each a self-contained brief, naming any SKILL.md it should follow.',
  'Check and combine their reports yourself, and do any filing in the brain yourself.',
  `At most ${HELPERS_AT_ONCE_MAX} helpers at once and ${HELPERS_PER_REPLY_MAX} in one reply.`,
].join(' ');

const NUDGE_OPEN = '<tds-helpers>';
const NUDGE_CLOSE = '</tds-helpers>';

/** One line on the first message of a chat whose pick said `helpers: true`. */
export const HELPERS_NUDGE = `${NUDGE_OPEN}This request may split into independent parts. If it does, give each part to an app helper with a self-contained brief, then check and combine their reports.${NUDGE_CLOSE}`;

/** Only a pick that asked for helpers, once per chat, and never on Quick (the chat is at least Standard). */
export function shouldNudge(i: { helpers: boolean; turnTier: LevelTier | null; nudged: boolean }): boolean {
  return i.helpers && !i.nudged && (i.turnTier === 'standard' || i.turnTier === 'deep');
}

/** What the engine is sent: the message, a blank line, then the nudge. */
export function withHelpersNudge(message: string): string {
  return message ? `${message}\n\n${HELPERS_NUDGE}` : HELPERS_NUDGE;
}

/** A stored turn without the nudge the app added. Only the exact block at the very end is taken off. */
export function withoutHelpersNudge(text: string): string {
  if (text === HELPERS_NUDGE) return '';
  const tail = `\n\n${HELPERS_NUDGE}`;
  return text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}

/** A past chat's title source: everything from the nudge on is dropped (the stored copy may be cut short). */
export function beforeHelpersNudge(text: string): string {
  const at = text.indexOf(NUDGE_OPEN);
  return at < 0 ? text : text.slice(0, at).trimEnd();
}

// ---------------------------------------------------------------------------
// Showing and naming helpers (decisions 13, 14)
// ---------------------------------------------------------------------------

/** "Asking the scout · Quick" for an app helper's tool row; null for any other helper. */
export function helperRowLabel(input: Rec): string | null {
  const type = input.subagent_type;
  if (!isAppHelper(type)) return null;
  const h = APP_HELPERS[type];
  return `Asking the ${h.label.toLowerCase()} · ${LEVEL_TIERS[h.tier].label}`;
}

/** Who a helper's card says is asking: "Worker", or "A helper" for any other or unknown type. */
export function helperActor(agentType: string | null | undefined): string {
  return isAppHelper(agentType) ? APP_HELPERS[agentType].label : 'A helper';
}

// ---------------------------------------------------------------------------
// The Agent hook (decision 12)
// ---------------------------------------------------------------------------

export interface AgentCallContext {
  mode: LevelMode;
  /** The tier the current reply runs at; null for a manual or skill-own reply. */
  turnTier: LevelTier | null;
  /** Helpers started and not yet finished. */
  running: number;
  /** Helpers started in this reply so far. */
  startedThisReply: number;
}

export type AgentCallDecision = { allow: true; input: Rec } | { allow: false; reason: string };

export const AT_ONCE_REASON = `Only ${HELPERS_AT_ONCE_MAX} helpers can run at once, and that many are running. Wait for one to finish before you start another, or do this part yourself.`;
export const PER_REPLY_REASON = `This reply has already started ${HELPERS_PER_REPLY_MAX} helpers, the most allowed in one reply. Finish the job yourself with the reports you have.`;

/**
 * The call as it should run, as a new object: always in the foreground (the app ends a turn on
 * `result`, which would cut off a background helper's cards), and in automatic mode on Deep a
 * built-in helper that names no model gets OTHER_HELPER_TIER. Agents with their own model keep it.
 */
export function rewriteAgentInput(input: Rec, ctx: Pick<AgentCallContext, 'mode' | 'turnTier'>): Rec {
  const out: Rec = { ...input, run_in_background: false };
  // Remote helpers always run in the background and worktree helpers run git in the brain.
  delete out.isolation;
  const type = input.subagent_type;
  // The app's helpers always run on their own tier, whatever model the call names.
  if (isAppHelper(type)) {
    out.model = LEVEL_TIERS[APP_HELPERS[type].tier].model;
    return out;
  }
  const builtIn =
    type === undefined || type === null || type === '' || BUILT_IN_HELPERS.includes(type as string);
  const named = typeof input.model === 'string' && input.model.length > 0;
  if (ctx.mode === 'auto' && ctx.turnTier === 'deep' && builtIn && !named) {
    out.model = LEVEL_TIERS[OTHER_HELPER_TIER].model;
  }
  return out;
}

/** Caps first (per reply, then at once), then the rewrite. */
export function decideAgentCall(input: Rec, ctx: AgentCallContext): AgentCallDecision {
  if (ctx.startedThisReply >= HELPERS_PER_REPLY_MAX) return { allow: false, reason: PER_REPLY_REASON };
  if (ctx.running >= HELPERS_AT_ONCE_MAX) return { allow: false, reason: AT_ONCE_REASON };
  return { allow: true, input: rewriteAgentInput(input, ctx) };
}
