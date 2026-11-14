import { describe, expect, it } from 'vitest';
import {
  HELPER_NAMES,
  HELPERS_AT_ONCE_MAX,
  HELPERS_PER_REPLY_MAX,
  LEVEL_TIERS,
  OTHER_HELPER_TIER,
} from '../../shared/levels-contract.ts';
import {
  type AgentCallContext,
  APP_HELPERS,
  AT_ONCE_REASON,
  agentCallProblem,
  appModelReason,
  BACKGROUND_REASON,
  DEEP_MODEL_REASON,
  decideAgentCall,
  HELPERS_LINE,
  HELPERS_NUDGE,
  helperActor,
  helperAgents,
  helperRowLabel,
  ISOLATION_REASON,
  isAppHelper,
  shouldNudge,
  withHelpersNudge,
  withoutHelpersNudge,
} from './helpers.ts';

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

describe('the three app helpers (decision 10)', () => {
  const agents = helperAgents();

  it('defines exactly the contract’s helpers', () => {
    expect(Object.keys(agents).sort()).toEqual([...HELPER_NAMES].sort());
  });

  it('takes models and efforts from the tier table', () => {
    expect(APP_HELPERS['tdsapp-scout'].tier).toBe('quick');
    expect(APP_HELPERS['tdsapp-worker'].tier).toBe('standard');
    expect(APP_HELPERS['tdsapp-expert'].tier).toBe('deep');
    for (const name of HELPER_NAMES) {
      const tier = LEVEL_TIERS[APP_HELPERS[name].tier];
      expect(agents[name]?.model).toBe(tier.model);
      expect(agents[name]?.effort).toBe(tier.effort);
    }
  });

  it('caps turns at 15 / 30 / 20', () => {
    expect(agents['tdsapp-scout']?.maxTurns).toBe(15);
    expect(agents['tdsapp-worker']?.maxTurns).toBe(30);
    expect(agents['tdsapp-expert']?.maxTurns).toBe(20);
  });

  it('never sets permissionMode or background', () => {
    for (const name of HELPER_NAMES) {
      const def = agents[name] as Record<string, unknown>;
      expect(def).not.toHaveProperty('permissionMode');
      expect(def).not.toHaveProperty('background');
    }
  });

  it('gives no helper a write tool, Agent or Skill', () => {
    for (const name of HELPER_NAMES) {
      const def = agents[name];
      for (const t of [...WRITE_TOOLS, 'Agent']) {
        expect(def?.tools ?? []).not.toContain(t);
        expect(def?.disallowedTools).toContain(t);
      }
      expect(def?.tools ?? []).not.toContain('Skill');
    }
  });

  it('scout and expert are read-only with web: no Bash and no connectors', () => {
    for (const name of ['tdsapp-scout', 'tdsapp-expert'] as const) {
      expect(agents[name]?.tools).toEqual(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch']);
    }
  });

  it('the worker inherits the chat’s tools (Bash and connectors) and disallows the rest', () => {
    // `mcp__*` in `tools` is not honoured (spike 12), so the worker leaves `tools` out.
    const worker = agents['tdsapp-worker'];
    expect(worker).not.toHaveProperty('tools');
    expect(APP_HELPERS['tdsapp-worker'].tools).toBeNull();
    expect(worker?.disallowedTools).toEqual([
      ...WRITE_TOOLS,
      'Agent',
      'Task',
      'Skill',
      'Workflow',
      'CronCreate',
      'ScheduleWakeup',
      'RemoteTrigger',
      'EnterWorktree',
    ]);
    expect(worker?.disallowedTools).not.toContain('Bash');
    expect(worker?.disallowedTools?.some((t) => t.startsWith('mcp__'))).toBe(false);
  });

  it('prompts keep helpers to their brief, out of the brain and short', () => {
    for (const name of HELPER_NAMES) {
      const p = agents[name]?.prompt ?? '';
      expect(p).toMatch(/only on your brief/i);
      expect(p).toMatch(/never file/i);
      expect(p).toMatch(/short report/i);
    }
    expect(agents['tdsapp-worker']?.prompt).toMatch(/SKILL\.md/);
  });

  it('copies the definitions, so a caller cannot change the table', () => {
    const a = helperAgents();
    a['tdsapp-scout']?.disallowedTools?.push('Read');
    expect(helperAgents()['tdsapp-scout']?.disallowedTools).not.toContain('Read');
  });

  it('knows its own helpers', () => {
    expect(isAppHelper('tdsapp-worker')).toBe(true);
    expect(isAppHelper('general-purpose')).toBe(false);
    expect(isAppHelper(undefined)).toBe(false);
  });
});

describe('when Claude uses helpers (decision 11)', () => {
  it('the instruction is short and says most requests need none', () => {
    expect(HELPERS_LINE.length).toBeLessThan(900);
    expect(HELPERS_LINE).toMatch(/most requests need no helpers/i);
    expect(HELPERS_LINE).toMatch(/two or more independent parts/);
    for (const name of HELPER_NAMES) expect(HELPERS_LINE).toContain(name);
    expect(HELPERS_LINE).toContain(String(HELPERS_AT_ONCE_MAX));
    expect(HELPERS_LINE).toContain(String(HELPERS_PER_REPLY_MAX));
  });

  it('the nudge is one line, between markers', () => {
    expect(HELPERS_NUDGE.split('\n')).toHaveLength(1);
    expect(HELPERS_NUDGE).toMatch(/^<tds-helpers>.*<\/tds-helpers>$/);
  });

  it('nudges a helpers pick once, never on Quick', () => {
    expect(shouldNudge({ helpers: true, turnTier: 'standard', nudged: false })).toBe(true);
    expect(shouldNudge({ helpers: true, turnTier: 'deep', nudged: false })).toBe(true);
    expect(shouldNudge({ helpers: true, turnTier: 'quick', nudged: false })).toBe(false);
    expect(shouldNudge({ helpers: true, turnTier: null, nudged: false })).toBe(false);
    expect(shouldNudge({ helpers: false, turnTier: 'deep', nudged: false })).toBe(false);
    expect(shouldNudge({ helpers: true, turnTier: 'deep', nudged: true })).toBe(false);
  });

  it('adds the nudge after the message and takes it off a stored turn', () => {
    const sent = withHelpersNudge('Audit all three clients');
    expect(sent).toBe(`Audit all three clients\n\n${HELPERS_NUDGE}`);
    expect(withoutHelpersNudge(sent)).toBe('Audit all three clients');
    expect(withHelpersNudge('')).toBe(HELPERS_NUDGE);
    expect(withoutHelpersNudge(HELPERS_NUDGE)).toBe('');
    // Only the exact block at the very end.
    expect(withoutHelpersNudge('a <tds-helpers>x</tds-helpers>')).toBe('a <tds-helpers>x</tds-helpers>');
    expect(withoutHelpersNudge(`${sent}\nmore`)).toBe(`${sent}\nmore`);
  });
});

describe('showing and naming helpers (decisions 13, 14)', () => {
  it('the tool row names the app helper and its level', () => {
    expect(helperRowLabel({ subagent_type: 'tdsapp-scout' })).toBe('Asking the scout · Quick');
    expect(helperRowLabel({ subagent_type: 'tdsapp-worker' })).toBe('Asking the worker · Standard');
    expect(helperRowLabel({ subagent_type: 'tdsapp-expert' })).toBe('Asking the expert · Deep');
    expect(helperRowLabel({ subagent_type: 'general-purpose' })).toBeNull();
    expect(helperRowLabel({})).toBeNull();
  });

  it('labels a helper’s cards by its type', () => {
    expect(helperActor('tdsapp-worker')).toBe('Worker');
    expect(helperActor('tdsapp-scout')).toBe('Scout');
    expect(helperActor('tdsapp-expert')).toBe('Expert');
    expect(helperActor('general-purpose')).toBe('A helper');
    expect(helperActor(null)).toBe('A helper');
  });
});

describe('the Agent hook (decision 12)', () => {
  const ctx = (over: Partial<AgentCallContext> = {}): AgentCallContext => ({
    mode: 'auto',
    turnTier: 'deep',
    running: 0,
    startedThisReply: 0,
    ...over,
  });
  const STANDARD_MODEL = LEVEL_TIERS[OTHER_HELPER_TIER].model;

  const problem = (
    input: Record<string, unknown>,
    mode: 'auto' | 'manual' = 'auto',
    turnTier: 'quick' | 'standard' | 'deep' | null = 'quick',
  ) => agentCallProblem({ run_in_background: false, ...input }, { mode, turnTier });

  it('allows a call that follows the rules exactly as written (never a rewrite)', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(problem({ subagent_type: 'tdsapp-scout', prompt: 'x' }, mode)).toBeNull();
      expect(problem({ subagent_type: 'Explore', prompt: 'x', run_in_background: false }, mode)).toBeNull();
      expect(problem({ prompt: 'x' }, mode)).toBeNull();
    }
    const d = decideAgentCall(
      { subagent_type: 'Explore', model: STANDARD_MODEL, run_in_background: false },
      ctx(),
    );
    expect(d).toEqual({ allow: true });
  });

  it('refuses a call that leaves run_in_background out, as it may then run in the background', () => {
    for (const mode of ['auto', 'manual'] as const) {
      const ask = { mode, turnTier: 'quick' as const };
      expect(agentCallProblem({ subagent_type: 'tdsapp-scout', prompt: 'x' }, ask)).toBe(BACKGROUND_REASON);
      expect(agentCallProblem({ prompt: 'x', run_in_background: 'false' }, ask)).toBe(BACKGROUND_REASON);
    }
    expect(BACKGROUND_REASON).toMatch(/run_in_background set to false/);
    expect(HELPERS_LINE).toMatch(/run_in_background set to false/);
  });

  it('refuses a background helper, telling Claude to run it in the foreground', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(problem({ subagent_type: 'my-agent', prompt: 'x', run_in_background: true }, mode)).toBe(
        BACKGROUND_REASON,
      );
    }
    expect(BACKGROUND_REASON).toMatch(/foreground/);
  });

  it('refuses isolation, so no helper runs remotely or in a git worktree of the brain', () => {
    for (const isolation of ['remote', 'worktree']) {
      expect(problem({ subagent_type: 'tdsapp-worker', prompt: 'x', isolation }, 'manual', null)).toBe(
        ISOLATION_REASON,
      );
      expect(problem({ subagent_type: 'Explore', prompt: 'x', isolation })).toBe(ISOLATION_REASON);
    }
  });

  it('runs an app helper on its own tier: no model or its own is fine, another is refused', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(problem({ subagent_type: 'tdsapp-worker' }, mode, 'deep')).toBeNull();
      expect(problem({ subagent_type: 'tdsapp-scout', model: 'haiku' }, mode, 'deep')).toBeNull();
      expect(problem({ subagent_type: 'tdsapp-scout', model: 'opus' }, mode, 'deep')).toBe(
        appModelReason('tdsapp-scout'),
      );
      expect(problem({ subagent_type: 'tdsapp-expert', model: 'haiku' }, mode, null)).toBe(
        appModelReason('tdsapp-expert'),
      );
    }
    expect(appModelReason('tdsapp-scout')).toMatch(/without a model/);
  });

  it('on Deep in auto, a built-in helper with no model is asked to name the other-helper model', () => {
    for (const type of [undefined, '', 'general-purpose', 'Explore', 'Plan']) {
      const input = type === undefined ? { prompt: 'x' } : { subagent_type: type, prompt: 'x' };
      expect(problem(input, 'auto', 'deep')).toBe(DEEP_MODEL_REASON);
    }
    expect(DEEP_MODEL_REASON).toContain(`"${STANDARD_MODEL}"`);
  });

  it('leaves the model to the call when it names one, the agent has its own, or not Deep/auto', () => {
    expect(problem({ subagent_type: 'Explore', model: 'opus' }, 'auto', 'deep')).toBeNull();
    expect(problem({ subagent_type: 'newsletter-idea-extractor' }, 'auto', 'deep')).toBeNull();
    expect(problem({ subagent_type: 'Explore' }, 'auto', 'standard')).toBeNull();
    expect(problem({ subagent_type: 'Explore' }, 'manual', 'deep')).toBeNull();
    expect(problem({}, 'auto', null)).toBeNull();
  });

  it('allows up to the caps', () => {
    expect(
      decideAgentCall(
        { model: STANDARD_MODEL, run_in_background: false },
        ctx({ running: HELPERS_AT_ONCE_MAX - 1, startedThisReply: HELPERS_PER_REPLY_MAX - 1 }),
      ).allow,
    ).toBe(true);
  });

  it('checks the caps before the rules', () => {
    const d = decideAgentCall({ run_in_background: true }, ctx({ running: HELPERS_AT_ONCE_MAX }));
    expect(d).toEqual({ allow: false, reason: AT_ONCE_REASON });
  });

  it('denies a helper over the at-once cap with a reason Claude can act on', () => {
    const d = decideAgentCall(
      {},
      ctx({ running: HELPERS_AT_ONCE_MAX, startedThisReply: HELPERS_AT_ONCE_MAX }),
    );
    expect(d.allow).toBe(false);
    if (d.allow) return;
    expect(d.reason).toContain(String(HELPERS_AT_ONCE_MAX));
    expect(d.reason).toMatch(/wait for one to finish/i);
  });

  it('denies a helper over the per-reply cap with a reason Claude can act on', () => {
    const d = decideAgentCall({}, ctx({ running: 0, startedThisReply: HELPERS_PER_REPLY_MAX }));
    expect(d.allow).toBe(false);
    if (d.allow) return;
    expect(d.reason).toContain(String(HELPERS_PER_REPLY_MAX));
    expect(d.reason).toMatch(/yourself/i);
  });
});
