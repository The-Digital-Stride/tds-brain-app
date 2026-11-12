/**
 * The Settings health panel's logic: what the page already knows (the boot data, the live event
 * stream, the to-do and chat lists, the last brain sync) turned into plain checks and one summary line.
 * Pure, so every message can be tested.
 */
import type { Bootstrap } from '../../../shared/contract.ts';
import { syncWords } from '../shell/words.ts';

/** `note` is worth knowing but isn't wrong; `checking` has no answer yet. */
export type CheckState = 'ok' | 'problem' | 'note' | 'checking';

export type ListState = 'loading' | 'loaded' | 'failed';

export interface HealthCheck {
  id: 'connection' | 'brain' | 'claude' | 'sync' | 'lists' | 'service' | 'signin';
  label: string;
  state: CheckState;
  /** One or two plain sentences (UK English): what's true, or what's wrong and what to do. */
  text: string;
  /** A path shown in code type under the text, if any. */
  detail?: string;
}

export interface HealthInput {
  boot: Bootstrap;
  /** False while the live event stream is down and being retried. */
  streamUp: boolean;
  lists: { todos: ListState; chats: ListState };
  /** As SyncStamp has it: undefined until the first answer, null when no good sync was seen. */
  lastSync: string | null | undefined;
  now: number;
}

const ASK = 'restart your Mac or tell whoever looks after TDS Brain';

export function healthChecks({ boot, streamUp, lists, lastSync, now }: HealthInput): HealthCheck[] {
  const checks: HealthCheck[] = [];

  checks.push(
    streamUp
      ? {
          id: 'connection',
          label: 'Connection',
          state: 'ok',
          text: 'Connected. Changes in the brain show here as they happen.',
        }
      : {
          id: 'connection',
          label: 'Connection',
          state: 'problem',
          text: `Lost the live connection. Changes in the brain won't show until it's back. If this lasts more than a minute, ${ASK}.`,
        },
  );

  checks.push({
    id: 'brain',
    label: 'Brain folder',
    state: boot.brain.ok ? 'ok' : 'problem',
    text: boot.brain.ok
      ? 'Found, with everything the app needs.'
      : [...boot.brain.problems.map(sentence), 'Tell whoever looks after TDS Brain.'].join(' '),
    detail: boot.brain.path,
  });

  checks.push(
    boot.engine.ok
      ? {
          id: 'claude',
          label: 'Claude Code',
          state: 'ok',
          text: 'Ready to start chats.',
          ...(boot.engine.claudePath ? { detail: boot.engine.claudePath } : {}),
        }
      : {
          id: 'claude',
          label: 'Claude Code',
          state: 'problem',
          text: boot.engine.problem ?? "Claude Code isn't ready.",
        },
  );

  if (lastSync === undefined) {
    checks.push({ id: 'sync', label: 'Brain sync', state: 'checking', text: 'Checking…' });
  } else {
    const w = syncWords(lastSync, now);
    checks.push({
      id: 'sync',
      label: 'Brain sync',
      state: w.stale ? 'problem' : 'ok',
      text: w.stale ? w.spoken : `Synced recently. Last sync at ${w.time} on ${w.date}.`,
    });
  }

  const failed = [lists.todos === 'failed' && 'to-dos', lists.chats === 'failed' && 'chats'].filter(Boolean);
  if (failed.length > 0) {
    const which = failed.join(' and ');
    checks.push({
      id: 'lists',
      label: 'To-dos and chats',
      state: 'problem',
      text: `Your ${which} couldn't be loaded. Press Command and R to try again.`,
    });
  } else if (lists.todos === 'loading' || lists.chats === 'loading') {
    checks.push({ id: 'lists', label: 'To-dos and chats', state: 'checking', text: 'Loading…' });
  } else {
    checks.push({ id: 'lists', label: 'To-dos and chats', state: 'ok', text: 'Loaded.' });
  }

  checks.push(
    boot.service.underService
      ? {
          id: 'service',
          label: 'Starts by itself',
          state: 'ok',
          text: 'Yes. TDS Brain starts when you log in to your Mac and restarts if it stops.',
        }
      : {
          id: 'service',
          label: 'Starts by itself',
          state: 'note',
          text: "No. This copy was started from a Terminal window, so it stops when that window closes and won't restart on its own.",
        },
  );

  // The page can only load with a valid sign-in, and loading it renews the sign-in.
  checks.push({
    id: 'signin',
    label: 'Sign-in',
    state: 'ok',
    text: 'Signed in on this computer. Using TDS Brain renews it, so you stay signed in.',
  });

  return checks;
}

/** Words shown beside each row's dot, so colour is never the only signal. */
export const STATE_WORDS: Record<CheckState, string> = {
  ok: 'OK',
  problem: 'Needs attention',
  note: 'Note',
  checking: 'Checking',
};

/** "A", "A and B", "A, B and C". */
function listWords(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Ends a sentence with a full stop if it has no closing mark. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export function healthSummary(checks: HealthCheck[]): { state: 'ok' | 'problem' | 'checking'; text: string } {
  const problems = checks.filter((c) => c.state === 'problem').map((c) => c.label);
  if (problems.length > 0) {
    const count = problems.length === 1 ? '1 thing needs' : `${problems.length} things need`;
    return { state: 'problem', text: `${count} attention: ${listWords(problems)}.` };
  }
  if (checks.some((c) => c.state === 'checking'))
    return { state: 'checking', text: 'Checking everything is connected…' };
  return { state: 'ok', text: 'Everything is connected and working.' };
}
