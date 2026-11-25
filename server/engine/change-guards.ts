/**
 * App change guards and the merge-and-push card (plan 2026-11-25-app-change-guards).
 *
 * - Team members' Claude in a Cortex chat can't change TDS Cortex's own code (decisions 1-5, 15).
 * - Every merge or push from a Cortex chat is found here so the session manager can force the confirm
 *   card (decisions 6-8), except the brain's own plain push of `main`.
 *
 * Detection is pure: a small shell lexer (quotes, escapes, heredocs, command substitution) splits a Bash
 * command into segments. Repo facts are read with read-only git through `execFile`, never a shell, with
 * repo-controlled hooks and monitors turned off. Nothing here throws to its caller where it matters:
 * `teamAppRefusal`, `publishFacts` and `guardToolCall` fail closed.
 */

import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { PublishFacts, PublishKind, Role } from '../../shared/contract.ts';
import { INSTALLED_APP_DIR, SUPPORT_DIR_NAME } from '../../shared/install-contract.ts';
import { expandHomeFor, installedAppDir } from '../settings.ts';

export type { Role };

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// Wording (UK English: people and Claude read these)
// ---------------------------------------------------------------------------

/** The deny reason Claude gets (decision 5). */
export const TEAM_APP_REFUSAL =
  "Only owners and scouts can change TDS Cortex's code, so this was refused. Don't try another way. Tell the person that, and offer to add their idea as a feature request in the TDS Cortex Feedback project. Only if they say yes, agree the wording with them, then run the tdsapp-todo skill's add with client the-digital-stride, project the-digital-stride/tds-cortex-feedback, stage Feature Request, via TDS Cortex, and assignee the owner: from clients/the-digital-stride/projects/tds-cortex-feedback/project.md.";

/** The warning notice the person sees (decision 5). */
export const TEAM_APP_NOTICE =
  'Only owners and scouts can change TDS Cortex. Claude can add your idea as a feature request instead.';

/** Notice and deny reason when the role can't be read and no recent role is known (decision 15). */
export const UNKNOWN_ROLE_NOTICE =
  "Cortex couldn't tell who you are, so it didn't change the app. Ask an owner or scout to run /doctor-cortex for you.";

/** Notice and deny reason when the check itself failed (decision 7: fail closed). */
export const CHANGE_CHECK_FAILED =
  "Cortex couldn't check whether this changes its own code, so it didn't run it. Try again, or ask an owner or scout to run /doctor-cortex if it keeps happening.";

/** Standing instructions for every chat (decision 11). */
export const PUBLISH_LINE =
  "At the point you would ask whether to merge or push, don't ask in the chat, in text or with AskUserQuestion: say briefly what will go out and run the merge or push command, and TDS Cortex shows the person a card to confirm it. If they say no, stop and don't try another way.";
export const APP_CODE_LINE =
  "Only owners and scouts change TDS Cortex's own code (the installed app and any copy of the tds-brain-app repo). If someone on the team asks for a change to the app, say so and offer to add it as a Feature Request task in the TDS Cortex Feedback project with the tdsapp-todo skill.";

const DANGER_WARNING = {
  force: 'This is a force push: it can overwrite work already on GitHub.',
  delete: 'This deletes a branch on GitHub.',
  mirror: 'This mirror push can overwrite or delete branches on GitHub.',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppCodeContext {
  /** The running copy's folder (`config.appRoot`). */
  appRoot: string;
  /** The person's home folder (for `~` and `$HOME`, and the default install path). */
  home: string;
  /** The brain folder (for the brain-sync exemption, decision 6). */
  brainRoot: string;
}

/** One publish found in a Bash command (decision 6). */
export interface DetectedPublish {
  kind: PublishKind;
  /** Force push, `--delete` or `--mirror`. */
  dangerous: boolean;
  /** Which danger, for the card's warning. */
  danger: 'force' | 'delete' | 'mirror' | null;
  /** The repo folder by decision 8's rule: `git -C <p>`, else the last `cd <p>` before it, else null (use cwd). */
  repoDir: string | null;
  /** For `git merge X`: X. For `git push <remote> <refspec>`: the refspec. Else null. */
  ref: string | null;
  /** For `git push <remote>`: the remote. Else null. */
  remote: string | null;
  /** What does the publishing. */
  source: 'git' | 'wt-finish' | 'gh';
  /** Exactly one publish, a git push with no extra options, refspecs or config (the brain-sync rule). */
  plain: boolean;
}

export type CardFacts = PublishFacts & { warning: string | null };

// ---------------------------------------------------------------------------
// The lexer
// ---------------------------------------------------------------------------

interface Word {
  /** Quotes removed and escapes applied; `$NAME`, `${NAME}` and `$(…)` kept as written. */
  v: string;
  /** The text of every `$(…)` and backtick substitution in the word. */
  subs: string[];
  /** Arithmetic, process substitution or anything else the guards don't read. */
  bad: boolean;
}

interface Redir {
  op: string;
  target: Word | null;
  /** A heredoc's body (filled in when the lexer reaches it). */
  body?: string;
}

type Tok = { t: 'w'; w: Word } | { t: 'op'; v: string } | { t: 'r'; r: Redir; heredoc: boolean };

interface Seg {
  words: Word[];
  redirs: Redir[];
}

const WORD_END = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>']);
const REDIR_OPS = ['<<<', '<<-', '<<', '<&', '<>', '<', '>>', '>|', '>&', '>'];

/**
 * A heredoc's delimiter word, read from `i` (just after `<<` or `<<-` and any blanks), with quotes and
 * escapes removed: [delimiter, index after]. Null when it can't be read.
 */
function readDelim(src: string, start: number): [string, number] | null {
  let i = start;
  let delim = '';
  while (i < src.length && !WORD_END.has(src[i] as string)) {
    const c = src[i] as string;
    if (c === "'" || c === '"') {
      const e = src.indexOf(c, i + 1);
      if (e < 0) return null;
      delim += src.slice(i + 1, e);
      i = e + 1;
    } else if (c === '\\') {
      delim += src[i + 1] ?? '';
      i += 2;
    } else {
      delim += c;
      i++;
    }
  }
  return delim ? [delim, i] : null;
}

/**
 * The index of the `)` closing a `$(` or `(` whose body starts at `i`, or -1. Heredoc bodies are skipped up
 * to their delimiter line, as `lex` does, so an apostrophe in one doesn't read as a quote. `arith` is for
 * `$((…))`, where `<<` is a shift.
 */
function scanParen(src: string, start: number, arith = false): number {
  let depth = 1;
  let i = start;
  const heredocs: { delim: string; strip: boolean }[] = [];
  while (i < src.length) {
    const ch = src[i];
    if (!arith && ch === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      i += 2;
      const strip = src[i] === '-';
      if (strip) i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      const got = readDelim(src, i);
      if (!got) return -1;
      heredocs.push({ delim: got[0], strip });
      i = got[1];
    } else if (ch === '\n' && heredocs.length > 0) {
      i++;
      for (const h of heredocs.splice(0)) {
        let closed = false;
        while (i < src.length) {
          let end = src.indexOf('\n', i);
          if (end < 0) end = src.length;
          const line = src.slice(i, end);
          i = end < src.length ? end + 1 : src.length;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) {
            closed = true;
            break;
          }
        }
        if (!closed) return -1;
      }
    } else if (ch === '\\') {
      i += 2;
    } else if (ch === "'") {
      const e = src.indexOf("'", i + 1);
      if (e < 0) return -1;
      i = e + 1;
    } else if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i += 2;
        else if (src[i] === '$' && src[i + 1] === '(') {
          const e = scanParen(src, i + 2, src[i + 2] === '(');
          if (e < 0) return -1;
          i = e + 1;
        } else i++;
      }
      if (i >= src.length) return -1;
      i++;
    } else if (ch === '`') {
      const e = scanBacktick(src, i + 1);
      if (e < 0) return -1;
      i = e + 1;
    } else if (ch === '(') {
      depth++;
      i++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
      i++;
    } else {
      i++;
    }
  }
  return -1;
}

function scanBacktick(src: string, start: number): number {
  let i = start;
  while (i < src.length) {
    if (src[i] === '\\') i += 2;
    else if (src[i] === '`') return i;
    else i++;
  }
  return -1;
}

const ANSI_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  '\\': '\\',
  "'": "'",
  '"': '"',
  e: '\x1b',
};

/** `$'…'` with its escapes decoded, so `$'\x67it'` reads as `git`. Returns [text, index after]. */
function readAnsi(src: string, start: number): [string, number] | null {
  let out = '';
  let i = start;
  while (i < src.length) {
    const ch = src[i] as string;
    if (ch === "'") return [out, i + 1];
    if (ch === '\\') {
      const nx = src[i + 1] ?? '';
      const hex = /^x([0-9a-fA-F]{1,2})/.exec(src.slice(i + 1, i + 4));
      const oct = /^([0-7]{1,3})/.exec(src.slice(i + 1, i + 4));
      if (hex?.[1]) {
        out += String.fromCharCode(Number.parseInt(hex[1], 16));
        i += 1 + hex[0].length;
      } else if (oct?.[1]) {
        out += String.fromCharCode(Number.parseInt(oct[1], 8));
        i += 1 + oct[0].length;
      } else {
        out += ANSI_ESCAPES[nx] ?? nx;
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return null;
}

/**
 * Tokenises a Bash command. Backslash-newlines are joined first; heredoc bodies are taken out of the token
 * stream (kept on their redirect). Null when the command can't be read (an unclosed quote, a process
 * substitution): callers then fail closed.
 */
function lex(input: string): Tok[] | null {
  const src = input.replace(/\\\r?\n/g, '');
  const n = src.length;
  const toks: Tok[] = [];
  const pending: { delim: string; strip: boolean; r: Redir }[] = [];
  let wantDelim: { strip: boolean; r: Redir } | null = null;
  let i = 0;
  while (i < n) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      toks.push({ t: 'op', v: '\n' });
      i++;
      for (const h of pending.splice(0)) {
        const lines: string[] = [];
        while (i < n) {
          let end = src.indexOf('\n', i);
          if (end < 0) end = n;
          const line = src.slice(i, end);
          i = end < n ? end + 1 : n;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
          lines.push(line);
        }
        h.r.body = lines.join('\n');
      }
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === ';;') {
      toks.push({ t: 'op', v: two === ';;' ? ';' : two });
      i += 2;
      continue;
    }
    if (two === '|&') {
      toks.push({ t: 'op', v: '|' });
      i += 2;
      continue;
    }
    if (two === '&>') {
      const op = src.slice(i, i + 3) === '&>>' ? '&>>' : '&>';
      toks.push({ t: 'r', r: { op, target: null }, heredoc: false });
      i += op.length;
      continue;
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')') {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '<' || c === '>') {
      if (src[i + 1] === '(') return null;
      const op = REDIR_OPS.find((o) => src.startsWith(o, i)) ?? c;
      const r: Redir = { op, target: null };
      const heredoc = op === '<<' || op === '<<-';
      toks.push({ t: 'r', r, heredoc });
      if (heredoc) wantDelim = { strip: op === '<<-', r };
      i += op.length;
      continue;
    }
    // A word.
    const w: Word = { v: '', subs: [], bad: false };
    let quoted = false;
    while (i < n && !WORD_END.has(src[i] as string)) {
      const ch = src[i] as string;
      if (ch === '\\') {
        w.v += src[i + 1] ?? '';
        i += 2;
        quoted = true;
      } else if (ch === "'") {
        const e = src.indexOf("'", i + 1);
        if (e < 0) return null;
        w.v += src.slice(i + 1, e);
        i = e + 1;
        quoted = true;
      } else if (ch === '"') {
        i++;
        quoted = true;
        let closed = false;
        while (i < n) {
          const d = src[i] as string;
          if (d === '"') {
            closed = true;
            i++;
            break;
          }
          if (d === '\\') {
            const nx = src[i + 1] ?? '';
            w.v += '$`"\\'.includes(nx) ? nx : `\\${nx}`;
            i += 2;
          } else if (d === '$' && src[i + 1] === '(') {
            const e = src[i + 2] === '(' ? -2 : scanParen(src, i + 2);
            if (e === -2) {
              w.bad = true;
              const close = scanParen(src, i + 2, true);
              if (close < 0) return null;
              w.v += src.slice(i, close + 1);
              i = close + 1;
              continue;
            }
            if (e < 0) return null;
            w.subs.push(src.slice(i + 2, e));
            w.v += src.slice(i, e + 1);
            i = e + 1;
          } else if (d === '`') {
            const e = scanBacktick(src, i + 1);
            if (e < 0) return null;
            w.subs.push(src.slice(i + 1, e).replace(/\\`/g, '`'));
            w.v += src.slice(i, e + 1);
            i = e + 1;
          } else {
            w.v += d;
            i++;
          }
        }
        if (!closed) return null;
      } else if (ch === '`') {
        const e = scanBacktick(src, i + 1);
        if (e < 0) return null;
        w.subs.push(src.slice(i + 1, e).replace(/\\`/g, '`'));
        w.v += src.slice(i, e + 1);
        i = e + 1;
      } else if (ch === '$' && src[i + 1] === '(') {
        if (src[i + 2] === '(') {
          w.bad = true;
          const close = scanParen(src, i + 2, true);
          if (close < 0) return null;
          w.v += src.slice(i, close + 1);
          i = close + 1;
          continue;
        }
        const e = scanParen(src, i + 2);
        if (e < 0) return null;
        w.subs.push(src.slice(i + 2, e));
        w.v += src.slice(i, e + 1);
        i = e + 1;
      } else if (ch === '$' && src[i + 1] === '{') {
        const e = src.indexOf('}', i + 2);
        if (e < 0) return null;
        w.v += src.slice(i, e + 1);
        i = e + 1;
      } else if (ch === '$' && src[i + 1] === "'") {
        const got = readAnsi(src, i + 2);
        if (!got) return null;
        w.v += got[0];
        i = got[1];
        quoted = true;
      } else {
        w.v += ch;
        i++;
      }
    }
    // `2>`: the digits name a stream, they're not a word.
    if (!quoted && /^\d+$/.test(w.v) && (src[i] === '<' || src[i] === '>')) continue;
    if (wantDelim) {
      pending.push({ delim: w.v, strip: wantDelim.strip, r: wantDelim.r });
      wantDelim = null;
      continue;
    }
    toks.push({ t: 'w', w });
  }
  if (wantDelim) return null;
  for (const h of pending) h.r.body = '';
  return toks;
}

function segmentsOf(toks: Tok[]): Seg[] {
  const out: Seg[] = [];
  let cur: Seg = { words: [], redirs: [] };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k] as Tok;
    if (t.t === 'op') {
      if (cur.words.length || cur.redirs.length) out.push(cur);
      cur = { words: [], redirs: [] };
    } else if (t.t === 'r') {
      const next = toks[k + 1];
      if (!t.heredoc && next?.t === 'w') {
        t.r.target = next.w;
        k++;
      }
      cur.redirs.push(t.r);
    } else {
      cur.words.push(t.w);
    }
  }
  if (cur.words.length || cur.redirs.length) out.push(cur);
  return out;
}

const RESERVED = new Set([
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
  '}',
  'time',
  'fi',
  'done',
  'esac',
]);

function commandWords(words: Word[]): Word[] {
  let k = 0;
  while (k < words.length && RESERVED.has((words[k] as Word).v)) k++;
  return words.slice(k);
}

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/;

interface ShellState {
  vars: Map<string, string | null>;
  /** The folder the last `cd` went to (relative when nothing absolute is known), else null. */
  dir: string | null;
  /** For `~` and `$HOME`; null leaves them as written. */
  home: string | null;
  /** The folder before the last `cd`, `pushd` or `popd` (for `cd -`); undefined when there was none. */
  prev: string | null | undefined;
  /** The folders `pushd` left, for `popd`. */
  stack: (string | null)[];
}

/** Where a `cd -`, `popd` or argument-less `pushd` goes when nothing before it says: no real folder. */
const UNKNOWN_DIR = '/nonexistent/cortex-unknown-folder';

function expand(v: string, st: ShellState): string {
  let out = v.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (m, a?: string, b?: string) => {
      const name = (a ?? b) as string;
      if (st.vars.has(name)) return st.vars.get(name) ?? m;
      if (name === 'HOME' && st.home) return st.home;
      return m;
    },
  );
  if (st.home && (out === '~' || out.startsWith('~/'))) out = st.home + out.slice(1);
  return out;
}

/** Applies a segment's standalone assignments, `export`s, `cd`, `pushd` and `popd` to the state. */
function track(words: Word[], st: ShellState): void {
  const vals = words.map((w) => w.v);
  const cmd = vals[0];
  if (vals.length > 0 && vals.every((v) => ASSIGNMENT.test(v))) {
    for (const w of words) setVar(w, st);
  } else if (cmd === 'export') {
    for (const w of words.slice(1)) if (ASSIGNMENT.test(w.v)) setVar(w, st);
  } else if (cmd === 'cd' || cmd === 'pushd' || cmd === 'popd') {
    const before = st.dir;
    let a = 1;
    while (a < vals.length && /^-[LPe@]+$/.test(vals[a] as string)) a++;
    const arg = vals[a];
    if (cmd === 'popd') {
      st.dir = st.stack.length > 0 ? (st.stack.pop() ?? null) : UNKNOWN_DIR;
    } else if (arg === undefined) {
      st.dir = cmd === 'cd' ? (st.home ?? '~') : UNKNOWN_DIR;
    } else if (arg === '-' && cmd === 'cd') {
      st.dir = st.prev === undefined ? UNKNOWN_DIR : st.prev;
    } else {
      const to = expand(arg, st);
      st.dir = st.dir && !isAbsolute(to) ? posix.join(st.dir, to) : to;
    }
    if (cmd === 'pushd') st.stack.push(before);
    st.prev = before;
  }
}

function setVar(w: Word, st: ShellState): void {
  const m = ASSIGNMENT.exec(w.v);
  if (!m) return;
  st.vars.set(m[1] as string, w.subs.length || w.bad ? null : expand(m[2] as string, st));
}

const freshState = (home: string | null): ShellState => ({
  vars: new Map(),
  dir: null,
  home,
  prev: undefined,
  stack: [],
});

// ---------------------------------------------------------------------------
// Publish detection (decision 6)
// ---------------------------------------------------------------------------

type Found = Omit<DetectedPublish, 'dangerous'>;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 4;

/** Last resort for text the lexer can't read or a shell reading its input: anything that looks like one. */
function coarse(text: string): Found | null {
  const base = { danger: null, repoDir: null, ref: null, remote: null, plain: false } as const;
  const merge = /\bgit\b[\s\S]*?\bmerge\b(?!-)|\bgh\b[\s\S]*?\bmerge/.test(text);
  const push = /\bgit\b[\s\S]*?\bpush\b/.test(text);
  const wt = /\bwt-finish\b[\s\S]*?--(merge|push)\b/.test(text);
  if (!merge && !push && !wt) return null;
  const kind: PublishKind = (merge || wt) && push ? 'merge-and-push' : merge || wt ? 'merge' : 'push';
  return { ...base, kind, source: wt ? 'wt-finish' : 'git' };
}

const PLAIN_PUSH_FLAGS = new Set([
  '-u',
  '--set-upstream',
  '-q',
  '--quiet',
  '-v',
  '--verbose',
  '--progress',
  '--no-verify',
]);

function parsePush(args: string[]): Pick<Found, 'danger' | 'ref' | 'remote' | 'plain'> | null {
  let danger: Found['danger'] = null;
  let plain = true;
  let remote: string | null = null;
  const pos: string[] = [];
  const hit = (d: NonNullable<Found['danger']>) => {
    danger ??= d;
  };
  for (let k = 0; k < args.length; k++) {
    const a = args[k] as string;
    if (a === '--') {
      pos.push(...args.slice(k + 1));
      break;
    }
    if (a === '--dry-run') return null;
    if (/^-[a-zA-Z]+$/.test(a)) {
      if (a.includes('n')) return null;
      if (a.includes('f')) hit('force');
      if (a.includes('d')) hit('delete');
      if (!PLAIN_PUSH_FLAGS.has(a)) plain = false;
      if (a.endsWith('o')) k++;
      continue;
    }
    if (a === '--force' || a.startsWith('--force-with-lease')) hit('force');
    else if (a === '--delete' || a === '--prune') hit('delete');
    else if (a === '--mirror') hit('mirror');
    else if (['--repo', '--push-option', '--receive-pack', '--exec'].includes(a)) {
      if (a === '--repo') remote = args[k + 1] ?? null;
      k++;
    } else if (a.startsWith('--repo=')) remote = a.slice('--repo='.length);
    if (a.startsWith('-')) {
      if (!PLAIN_PUSH_FLAGS.has(a)) plain = false;
      continue;
    }
    pos.push(a);
  }
  remote ??= pos[0] ?? null;
  const specs = pos.slice(remote === pos[0] ? 1 : 0);
  for (const s of specs) {
    if (s.startsWith('+')) hit('force');
    else if (s.startsWith(':')) hit('delete');
  }
  if (specs.length > 1) plain = false;
  const ref = specs.length === 1 ? (specs[0] as string).replace(/^\+/, '') : null;
  return { danger, ref, remote, plain };
}

const MERGE_VALUE_OPTS = new Set([
  '-m',
  '-F',
  '-s',
  '-X',
  '--strategy',
  '--strategy-option',
  '--file',
  '--message',
  '--into-name',
]);

function parseMerge(args: string[]): { ref: string | null } | null {
  if (args.length === 1 && (args[0] === '--abort' || args[0] === '--quit')) return null;
  for (let k = 0; k < args.length; k++) {
    const a = args[k] as string;
    if (a === '--') return { ref: args[k + 1] ?? null };
    if (MERGE_VALUE_OPTS.has(a)) {
      k++;
      continue;
    }
    if (a.startsWith('-')) continue;
    return { ref: a };
  }
  return { ref: null };
}

const GIT_VALUE_OPTS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--config-env',
  '--super-prefix',
]);

const ALIAS_SETTING = /^alias\.([^=]+)=([\s\S]*)$/i;

/** A `!` (shell) alias: whatever it mentions. */
function shellAlias(value: string, repoDir: string | null): Found | null {
  const push = /\bpush\b/.test(value);
  const merge = /\bmerge\b(?!-)/.test(value);
  if (!push && !merge) return null;
  const kind: PublishKind = push && merge ? 'merge-and-push' : merge ? 'merge' : 'push';
  return { kind, source: 'git', repoDir, ref: null, remote: null, danger: null, plain: false };
}

/**
 * A `git` command at `vals[i]`. Plain (the brain-sync rule) only when nothing comes before `git` in the
 * segment and there are no global options at all.
 */
function gitAt(vals: string[], i: number, dir: string | null): Found | null {
  let k = i + 1;
  let repoDir: string | null = null;
  // Aliases set on the command line; null when the value comes from the environment (`--config-env`).
  const aliases = new Map<string, string | null>();
  const alias = (setting: string, value: boolean) => {
    const m = ALIAS_SETTING.exec(setting);
    if (m) aliases.set((m[1] as string).toLowerCase(), value ? (m[2] as string) : null);
  };
  while (k < vals.length && (vals[k] as string).startsWith('-')) {
    const a = vals[k] as string;
    if (a === '-C') {
      const p = vals[k + 1] ?? '';
      repoDir = repoDir && !isAbsolute(p) ? posix.join(repoDir, p) : p;
      k += 2;
      continue;
    }
    if (a === '-c' || a === '--config-env') alias(vals[k + 1] ?? '', a === '-c');
    else if (a.startsWith('--config-env=')) alias(a.slice('--config-env='.length), false);
    k += GIT_VALUE_OPTS.has(a) ? 2 : 1;
  }
  if (repoDir && dir && !isAbsolute(repoDir)) repoDir = posix.join(dir, repoDir);
  repoDir ??= dir;
  const bare = i === 0 && vals[i] === 'git' && k === i + 1;
  const sub = vals[k];
  const args = vals.slice(k + 1);
  if (sub === 'push') {
    const p = parsePush(args);
    if (!p) return null;
    return { kind: 'push', source: 'git', repoDir, ...p, plain: p.plain && bare };
  }
  if (sub === 'merge') {
    const m = parseMerge(args);
    if (!m) return null;
    return { kind: 'merge', source: 'git', repoDir, ref: m.ref, remote: null, danger: null, plain: false };
  }
  if (sub === 'subtree' && args.includes('push')) {
    return { kind: 'push', source: 'git', repoDir, ref: null, remote: null, danger: null, plain: false };
  }
  // `git $(echo push)` or `git ${X:-push}`: the subcommand can't be read, so it counts.
  if (sub?.includes('$'))
    return { kind: 'push', source: 'git', repoDir, ref: null, remote: null, danger: null, plain: false };
  const key = sub?.toLowerCase();
  if (key !== undefined && aliases.has(key)) {
    const value = aliases.get(key);
    // Set from the environment: it can't be read, so it counts.
    if (value === null || value === undefined)
      return { kind: 'push', source: 'git', repoDir, ref: null, remote: null, danger: null, plain: false };
    if (value.trimStart().startsWith('!')) return shellAlias(value, repoDir);
    const f = gitAt(['git', ...value.split(/\s+/).filter(Boolean), ...args], 0, repoDir);
    return f ? { ...f, plain: false } : null;
  }
  return null;
}

const GH_BODY_OPTS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

function ghAt(vals: string[], i: number, dir: string | null): Found | null {
  const rest: string[] = [];
  let method: string | null = null;
  let body = false;
  for (let k = i + 1; k < vals.length; k++) {
    const a = vals[k] as string;
    if (a === '-R' || a === '--repo') {
      k++;
    } else if (a === '-X' || a === '--method') {
      method = vals[k + 1] ?? null;
      k++;
    } else if (a.startsWith('--method=')) {
      method = a.slice('--method='.length);
    } else if (/^-X./.test(a)) {
      method = a.slice(2);
    } else if (GH_BODY_OPTS.has(a)) {
      body = true;
      k++;
    } else if (/^(?:-[fF].|--(?:field|raw-field|input)=)/.test(a)) {
      body = true;
    } else {
      rest.push(a);
    }
  }
  const plainArgs = rest.filter((a) => !a.startsWith('-'));
  const found = (kind: PublishKind): Found => ({
    kind,
    source: 'gh',
    repoDir: dir,
    ref: null,
    remote: null,
    danger: null,
    plain: false,
  });
  if (plainArgs[0] === 'pr' && plainArgs[1] === 'merge') return found('merge');
  if (plainArgs[0] !== 'api') return null;
  if (rest.some((a) => /\/merges?(?:[?#]|$)/.test(a))) return found('merge');
  // Fields imply POST unless a method is named.
  const verb = (method ?? (body ? 'POST' : 'GET')).toUpperCase();
  const writes = verb !== 'GET' && verb !== 'HEAD';
  if (writes && rest.some((a) => /\/contents(?:\/|$)|\/git\/refs(?:\/|[?#]|$)/.test(a))) return found('push');
  return null;
}

function wtFinishAt(vals: string[], i: number, dir: string | null): Found | null {
  const args = vals.slice(i + 1);
  const merge = args.includes('--merge');
  const push = args.includes('--push');
  if (!merge && !push) return null;
  const kind: PublishKind = merge && push ? 'merge-and-push' : merge ? 'merge' : 'push';
  return { kind, source: 'wt-finish', repoDir: dir, ref: null, remote: null, danger: null, plain: false };
}

function findPublishes(text: string, st: ShellState, depth: number): Found[] {
  if (depth > MAX_DEPTH) {
    const c = coarse(text);
    return c ? [c] : [];
  }
  const toks = lex(text);
  if (!toks) {
    const c = coarse(text);
    return c ? [c] : [];
  }
  const found: Found[] = [];
  for (const seg of segmentsOf(toks)) {
    const words = commandWords(seg.words);
    for (const w of seg.words) for (const sub of w.subs) found.push(...findPublishes(sub, st, depth + 1));
    for (const r of seg.redirs)
      for (const sub of r.target?.subs ?? []) found.push(...findPublishes(sub, st, depth + 1));
    const vals = words.map((w) => expand(w.v, st));
    for (let i = 0; i < vals.length; i++) {
      const name = basename(vals[i] as string);
      let f: Found | null = null;
      if (name === 'git') f = gitAt(vals, i, st.dir);
      else if (name === 'gh') f = ghAt(vals, i, st.dir);
      else if (name === 'wt-finish') f = wtFinishAt(vals, i, st.dir);
      else if (SHELLS.has(name)) {
        const flag = vals.slice(i + 1).findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
        const script = flag >= 0 ? vals[i + 1 + flag + 1] : undefined;
        if (script !== undefined) found.push(...findPublishes(script, st, depth + 1));
        else {
          // A shell reading its input or a script: look at what it might read.
          for (const r of seg.redirs) if (r.body) found.push(...findPublishes(r.body, st, depth + 1));
          const c = coarse(text);
          if (c) found.push(c);
        }
      } else if (name === 'eval') {
        found.push(...findPublishes(vals.slice(i + 1).join(' '), st, depth + 1));
        break;
      }
      if (f) found.push(f);
    }
    track(words, st);
  }
  return found;
}

/**
 * Anything that can point a push at another repo without showing in its own segment: a `GIT_*` variable
 * (set, exported or passed through `env`) or the folder stack. A plain push never has any of these.
 */
const REDIRECTS_GIT = /GIT_[A-Za-z0-9_]|\b(?:pushd|popd)\b/;

/** The git steps of the brain's daily sync (`/gm`, `/sync`), with no options before the subcommand. */
const SYNC_GIT_STEPS = new Set(['push', 'pull', 'fetch', 'add', 'commit', 'status', 'diff', 'log', 'stash']);
const SYNC_OTHER_STEPS = new Set(['echo', 'cat', 'printf', 'true']);
const SYNC_MAX_DEPTH = 3;

/**
 * True when every segment of the command (substitutions included) is a bare daily-sync git step or
 * `echo`/`cat`. Anything else before a push (`git remote set-url`, `git config`, `git checkout`, `cd`,
 * `builtin cd`, `source`) could point it somewhere else, so it gets the card (overseer sign-off B2).
 */
function onlySyncSteps(text: string, depth: number): boolean {
  if (depth > SYNC_MAX_DEPTH) return false;
  const toks = lex(text);
  if (!toks) return false;
  for (const seg of segmentsOf(toks)) {
    const words = seg.words;
    const first = words[0]?.v;
    if (first === undefined || words.some((w) => w.bad)) return false;
    // Options that run a command (`fetch --upload-pack=…`, `--exec`, `-c core.sshCommand=…`).
    if (words.some((w) => /^(?:--upload-pack|--receive-pack|--exec|-c$|--config-env)/.test(w.v)))
      return false;
    const ok = first === 'git' ? SYNC_GIT_STEPS.has(words[1]?.v ?? '') : SYNC_OTHER_STEPS.has(first);
    if (!ok) return false;
    for (const w of words) for (const sub of w.subs) if (!onlySyncSteps(sub, depth + 1)) return false;
    for (const r of seg.redirs) {
      if (r.op.startsWith('<<') && r.op !== '<<<') continue;
      const t = r.target?.v;
      if (!(t === '/dev/null' || ((r.op === '>&' || r.op === '<&') && (t === '1' || t === '2'))))
        return false;
    }
  }
  return true;
}

/** Pure: the publish in a Bash command, or null. Heredoc bodies stripped, quotes respected. */
export function detectPublish(command: string): DetectedPublish | null {
  const list = findPublishes(command, freshState(null), 0);
  if (list.length === 0) return null;
  const isMerge = (f: Found) => f.kind !== 'push';
  const isPush = (f: Found) => f.kind !== 'merge';
  const kind: PublishKind =
    list.some(isMerge) && list.some(isPush) ? 'merge-and-push' : list.some(isMerge) ? 'merge' : 'push';
  const primary = list.find(isMerge) ?? (list[0] as Found);
  const danger = list.find((f) => f.danger)?.danger ?? null;
  return {
    ...primary,
    kind,
    danger,
    dangerous: danger !== null,
    plain: list.length === 1 && primary.plain && !REDIRECTS_GIT.test(command) && onlySyncSteps(command, 0),
  };
}

const PUBLISH_TOOL = /^mcp__.*github.*__.*(merge|push|create_or_update_file|delete_file)/i;

/** Pure: whether an MCP tool name is a merge or push (decision 6). */
export function isPublishTool(toolName: string): PublishKind | null {
  const m = PUBLISH_TOOL.exec(toolName);
  if (!m) return null;
  return (m[1] as string).toLowerCase() === 'merge' ? 'merge' : 'push';
}

// ---------------------------------------------------------------------------
// App code (decision 2)
// ---------------------------------------------------------------------------

const APP_ORIGIN = /[/:]the-digital-stride\/tds-brain-app(?:\.git)?\/?$/i;
const appRepoCache = new Map<string, boolean>();

/** The real path, or for one that doesn't exist yet, its nearest real ancestor plus the rest. */
async function realish(p: string): Promise<string> {
  const abs = resolve(p);
  let cur = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await fsp.realpath(cur);
      return rest.length ? join(real, ...rest.reverse()) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return abs;
      rest.push(basename(cur));
      cur = parent;
    }
  }
}

function inside(p: string, root: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
}

/** The repo's shared git folder, read in Node (a worktree's `gitdir:` and `commondir` followed). */
async function commonGitDir(repoRoot: string): Promise<string | null> {
  const dotGit = join(repoRoot, '.git');
  const st = await fsp.stat(dotGit).catch(() => null);
  if (!st) return null;
  let gitDir = dotGit;
  if (st.isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(await fsp.readFile(dotGit, 'utf8'));
    if (!m?.[1]) return null;
    gitDir = resolve(repoRoot, m[1].trim());
  }
  const common = await fsp.readFile(join(gitDir, 'commondir'), 'utf8').catch(() => null);
  return common ? resolve(gitDir, common.trim()) : gitDir;
}

/** `remote.origin.url` from a git config file's text. */
export function originFromConfig(text: string): string | null {
  let inOrigin = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/.exec(line);
    if (sec) {
      const name = (sec[1] as string).toLowerCase();
      inOrigin = (name === 'remote' && sec[2] === 'origin') || name === 'remote.origin';
      continue;
    }
    const m = inOrigin ? /^url\s*=\s*(.*)$/i.exec(line) : null;
    if (m) return (m[1] as string).replace(/^"(.*)"$/, '$1').trim();
  }
  return null;
}

async function originUrl(repoRoot: string): Promise<string | null> {
  const dir = await commonGitDir(repoRoot);
  if (!dir) return null;
  const text = await fsp.readFile(join(dir, 'config'), 'utf8').catch(() => null);
  return text === null ? null : originFromConfig(text);
}

async function repoIsApp(repoRoot: string): Promise<boolean> {
  const known = appRepoCache.get(repoRoot);
  if (known !== undefined) return known;
  const url = await originUrl(repoRoot);
  const is = url !== null && APP_ORIGIN.test(url);
  appRepoCache.set(repoRoot, is);
  return is;
}

/** Async (files only, cached per repo root): whether a path is inside app code (decision 2). */
export async function isAppCodePath(path: string, ctx: AppCodeContext): Promise<boolean> {
  const p = await realish(path);
  for (const root of [ctx.appRoot, installedAppDir(ctx.home)]) {
    if (inside(p, await realish(root))) return true;
  }
  let d = p;
  for (;;) {
    if (await fsp.lstat(join(d, '.git')).catch(() => null)) {
      if (await repoIsApp(d)) return true;
    }
    const parent = dirname(d);
    if (parent === d) return false;
    d = parent;
  }
}

// ---------------------------------------------------------------------------
// Touching app code (decision 4) and the team allowlist (decision 3)
// ---------------------------------------------------------------------------

const MARKERS = [
  // `TDS Brain/app`: the installed app's folder.
  new RegExp(`${SUPPORT_DIR_NAME}/${INSTALLED_APP_DIR}`, 'i'),
  /\$\{?APP\b/,
  // The repo's GitHub address only: the brain's project key `the-digital-stride/tds-brain-app` isn't app code.
  /github\.com[:/]the-digital-stride\/tds-brain-app/i,
];
const MAX_PATHS = 200;

function pathLike(v: string): boolean {
  return v.startsWith('/') || v.startsWith('~') || v.startsWith('.') || v.includes('/');
}

/** For a word with glob characters, the folder before the first one (what the glob can reach); else the word. */
function globBase(v: string): string {
  const at = v.search(/[*?[]/);
  if (at < 0) return v;
  const slash = v.lastIndexOf('/', at);
  return slash < 0 ? '.' : slash === 0 ? '/' : v.slice(0, slash);
}

/**
 * Whether a command's path touches app code: inside it (`isAppCodePath`), or a folder holding an app root
 * (`rm -rf` on its parent). Home itself, `/` and the folders above home don't count as holding it.
 */
async function touchesAppPath(path: string, ctx: AppCodeContext): Promise<boolean> {
  if (await isAppCodePath(path, ctx)) return true;
  const p = await realish(path);
  if (inside(await realish(ctx.home), p)) return false;
  for (const root of [ctx.appRoot, installedAppDir(ctx.home)]) {
    if (inside(await realish(root), p)) return true;
  }
  return false;
}

/** Every path-like word in a command, made absolute against the `cd`s before it. Null when unreadable. */
function pathsIn(text: string, st: ShellState, base: string, out: Set<string>, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  const toks = lex(text);
  if (!toks) return false;
  for (const seg of segmentsOf(toks)) {
    const words = [...seg.words, ...seg.redirs.flatMap((r) => (r.target ? [r.target] : []))];
    for (const w of words) {
      for (const sub of w.subs) if (!pathsIn(sub, st, base, out, depth + 1)) return false;
      let v = expand(w.v, st);
      const eq = v.indexOf('=');
      if (eq > 0 && (v.startsWith('-') || ASSIGNMENT.test(v))) v = v.slice(eq + 1);
      if (!pathLike(v)) continue;
      out.add(resolve(base, st.dir ?? '.', globBase(v)));
    }
    for (const r of seg.redirs) if (r.body && !pathsIn(r.body, st, base, out, depth + 1)) return false;
    track(commandWords(seg.words), st);
    // The folder each `cd` lands in counts too: `cd <parent> && cd app && sed -i …`.
    if (st.dir) out.add(resolve(base, st.dir));
  }
  return true;
}

/** Text with quotes and backslash escapes taken out, heredoc bodies dropped: what the markers look at. */
function flatText(command: string): string {
  const toks = lex(command);
  if (!toks) return command.replace(/["'\\]/g, '');
  return toks.map((t) => (t.t === 'w' ? t.w.v : t.t === 'op' ? t.v : t.r.op)).join(' ');
}

/** Whether a Bash command touches app code (decision 4). */
export async function touchesAppCode(command: string, cwd: string, ctx: AppCodeContext): Promise<boolean> {
  if (await touchesAppPath(cwd, ctx)) return true;
  const flat = flatText(command);
  if (MARKERS.some((m) => m.test(flat) || m.test(command))) return true;
  const paths = new Set<string>();
  if (!pathsIn(command, freshState(ctx.home), cwd, paths, 0)) {
    // Unreadable: check each whitespace-separated piece that looks like a path.
    for (const piece of command.split(/\s+/)) {
      const v = piece.replace(/["'\\]/g, '');
      if (pathLike(v)) paths.add(resolve(cwd, globBase(v.startsWith('~') ? ctx.home + v.slice(1) : v)));
    }
  }
  if (paths.size > MAX_PATHS) return true;
  for (const p of paths) if (await touchesAppPath(p, ctx)) return true;
  return false;
}

const OFFICIAL_URL = /^https:\/\/github\.com\/the-digital-stride\/tds-brain-app(?:\.git)?\/?$/i;
const SAFE_ENV = new Set(['GIT_TERMINAL_PROMPT']);
const RISKY_ENV =
  /^(GIT_|NODE_|NPM_|npm_|PNPM_|LD_|DYLD_|BASH_ENV$|ENV$|SHELLOPTS$|BASHOPTS$|PS4$|PROMPT_COMMAND$|EDITOR$|VISUAL$|PAGER$|LESS|SSH_|IFS$|COREPACK_|XDG_CONFIG)/;
const READ_ONLY = new Set([
  'test',
  '[',
  'ls',
  'cat',
  'head',
  'tail',
  'echo',
  'printf',
  'printenv',
  'stat',
  'pwd',
]);
const READ_GIT = new Set(['log', 'show', 'rev-parse', 'ls-remote', 'status']);

function safeName(name: string): boolean {
  return SAFE_ENV.has(name) || !RISKY_ENV.test(name);
}

function gitForbidden(a: string): boolean {
  return a === '-c' || /^--(config-env|upload-pack|exec|output|receive-pack)/.test(a);
}

function teamGitOk(args: string[]): boolean {
  let k = 0;
  while (k < args.length && (args[k] as string).startsWith('-')) {
    const a = args[k] as string;
    if (a === '-C' && k + 1 < args.length) k += 2;
    else if (a === '--no-pager') k++;
    else return a === '--version' && args.length === 1;
  }
  const sub = args[k];
  const rest = args.slice(k + 1);
  if (rest.some(gitForbidden)) return false;
  switch (sub) {
    case 'fetch':
      return rest.every((a) => a === '--quiet' || a === '-q');
    case 'pull':
      return rest.includes('--ff-only') && rest.every((a) => ['--ff-only', '--quiet', '-q'].includes(a));
    case 'clone': {
      const pos = rest.filter((a) => a !== '--quiet' && a !== '-q');
      return pos.length === 2 && OFFICIAL_URL.test(pos[0] as string) && !(pos[1] as string).startsWith('-');
    }
    case 'ls-remote':
      return rest.every((a) => !a.includes('::') && a !== '-u');
    default:
      return sub !== undefined && READ_GIT.has(sub);
  }
}

function pnpmOk(vals: string[]): boolean {
  let a = vals;
  if (a[0] === 'npx') {
    if (a[1] !== '--yes' && a[1] !== '-y') return false;
    a = a.slice(2);
  }
  if (a[0] !== 'pnpm' && a[0] !== 'pnpm@10') return false;
  const rest = a.slice(1);
  return (
    (rest.length === 2 && rest[0] === 'install' && rest[1] === '--frozen-lockfile') ||
    (rest.length === 1 && rest[0] === 'build')
  );
}

function redirOk(r: Redir): boolean {
  if (r.op === '<<' || r.op === '<<-' || r.op === '<<<' || r.op === '<' || r.op === '<&') return true;
  const target = r.target?.v ?? null;
  if (r.op === '>&') return target === '1' || target === '2';
  if (['>', '>>', '>|', '&>', '&>>'].includes(r.op)) return target === '/dev/null';
  return false;
}

interface TeamCtx {
  appRoots: string[];
}

function teamCheck(text: string, st: ShellState, tc: TeamCtx, depth: number): boolean {
  if (depth > MAX_DEPTH) return false;
  const toks = lex(text);
  if (!toks) return false;
  for (const seg of segmentsOf(toks)) {
    if (!seg.redirs.every(redirOk)) return false;
    const all = [...seg.words, ...seg.redirs.flatMap((r) => (r.target ? [r.target] : []))];
    for (const w of all) {
      if (w.bad) return false;
      for (const sub of w.subs) if (!teamCheck(sub, st, tc, depth + 1)) return false;
    }
    const words = commandWords(seg.words);
    let k = 0;
    while (k < words.length && ASSIGNMENT.test((words[k] as Word).v)) {
      if (!safeName((ASSIGNMENT.exec((words[k] as Word).v) as RegExpExecArray)[1] as string)) return false;
      k++;
    }
    const vals = words.slice(k).map((w) => expand(w.v, st));
    if (vals.length > 0 && !commandOk(vals, st, tc)) return false;
    track(words, st);
  }
  return true;
}

function commandOk(vals: string[], st: ShellState, tc: TeamCtx): boolean {
  const [cmd, ...args] = vals as [string, ...string[]];
  if (cmd === 'cd') return args.length <= 1;
  if (cmd === 'export') {
    return args.every((a) => {
      const m = ASSIGNMENT.exec(a);
      return m !== null && safeName(m[1] as string);
    });
  }
  if (cmd === 'git') return teamGitOk(args);
  if (cmd === 'npx' || cmd === 'pnpm' || cmd === 'pnpm@10') return pnpmOk(vals);
  if (READ_ONLY.has(cmd)) return true;
  if (cmd === 'mkdir') return args.includes('-p') && args.every((a) => a === '-p' || !a.startsWith('-'));
  if (cmd === 'node') {
    if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) return true;
    return args.length === 3 && args[0] === '-p' && args[1] === 'require(process.argv[1]).version';
  }
  if (cmd.endsWith('/bin/tds-brain')) {
    const root = dirname(dirname(resolve(st.dir ?? '/', cmd)));
    return tc.appRoots.includes(root);
  }
  return false;
}

/**
 * Pure: true when every segment of a command is on the update allowlist (decision 3). `ctx` names the app
 * roots a `<root>/bin/tds-brain` may run from and the home for `~` and `$HOME` (default: this Mac account's).
 */
export function teamMayRun(
  command: string,
  ctx?: Partial<Pick<AppCodeContext, 'appRoot' | 'home'>>,
): boolean {
  try {
    const home = ctx?.home ?? homedir();
    const appRoots = [installedAppDir(home), ...(ctx?.appRoot ? [resolve(ctx.appRoot)] : [])];
    return teamCheck(command, freshState(home), { appRoots }, 0);
  } catch {
    return false;
  }
}

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * The whole team check for one tool call: null when allowed, else what to deny with. `getRole` is called
 * only once the call touches app code and isn't on the update allowlist. Never throws: an internal error
 * returns a refusal (fail closed).
 */
export async function teamAppRefusal(
  getRole: () => Promise<Role>,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  ctx: AppCodeContext,
): Promise<{ reason: string; notice: string } | null> {
  try {
    if (EDIT_TOOLS.has(toolName)) {
      const raw = toolName === 'NotebookEdit' ? input.notebook_path : input.file_path;
      if (typeof raw !== 'string' || !raw) return null;
      if (!(await isAppCodePath(resolve(cwd, expandHomeFor(raw, ctx.home)), ctx))) return null;
    } else if (toolName === 'Bash') {
      const command = typeof input.command === 'string' ? input.command : '';
      if (!(await touchesAppCode(command, cwd, ctx))) return null;
      if (teamMayRun(command, ctx)) return null;
    } else {
      return null;
    }
    const role = await getRole();
    if (role === 'owner' || role === 'scout') return null;
    if (role === 'team') return { reason: TEAM_APP_REFUSAL, notice: TEAM_APP_NOTICE };
    return { reason: UNKNOWN_ROLE_NOTICE, notice: UNKNOWN_ROLE_NOTICE };
  } catch {
    return { reason: CHANGE_CHECK_FAILED, notice: CHANGE_CHECK_FAILED };
  }
}

// ---------------------------------------------------------------------------
// Card facts (decision 8) and the brain-sync exemption
// ---------------------------------------------------------------------------

const GIT_TIMEOUT_MS = 3000;
const COMMITS_SHOWN = 20;

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0' };
}

/** Read-only git, never a shell; only the subcommands decision 8 allows. Null on any failure. */
async function gitRead(dir: string, args: string[]): Promise<string | null> {
  const [sub, first] = args;
  const allowed =
    sub === 'rev-parse' ||
    sub === 'symbolic-ref' ||
    sub === 'rev-list' ||
    (sub === 'config' && first === '--get') ||
    (sub === 'log' && first === '--no-show-signature');
  if (!allowed) return null;
  try {
    const { stdout } = await run(
      'git',
      ['--no-pager', '-c', 'log.showSignature=false', '-c', 'core.fsmonitor=false', ...args],
      { cwd: dir, timeout: GIT_TIMEOUT_MS, env: gitEnv(), maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/** A branch or ref name that can't be read as an option or a range. */
function safeRef(r: string | null): r is string {
  return r !== null && /^[A-Za-z0-9._/@{}^~-]+$/.test(r) && !r.startsWith('-') && !r.includes('..');
}

function repoDirFor(d: DetectedPublish, cwd: string, home: string): string {
  if (!d.repoDir) return cwd;
  const st = freshState(home);
  return resolve(cwd, expand(d.repoDir, st));
}

function repoName(url: string | null): string | null {
  if (!url) return null;
  const m = /[:/]([^/:]+)\/([^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

async function readVersion(top: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fsp.readFile(join(top, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

function bareFacts(kind: PublishKind, command: string, danger: DetectedPublish['danger']): CardFacts {
  return {
    kind,
    repo: null,
    isApp: false,
    branch: null,
    target: null,
    version: null,
    commits: null,
    commitCount: null,
    command,
    warning: danger ? DANGER_WARNING[danger] : null,
  };
}

/** Pure: card facts from the call alone (no repo reads), or null when it isn't a merge or push. */
export function quickPublishFacts(toolName: string, input: Record<string, unknown>): CardFacts | null {
  if (toolName === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    const d = detectPublish(command);
    return d ? bareFacts(d.kind, command, d.danger) : null;
  }
  const kind = isPublishTool(toolName);
  return kind ? bareFacts(kind, toolName, null) : null;
}

/** The remote a push names when it isn't origin (a remote name, URL or path), else null. */
function otherRemote(d: DetectedPublish): string | null {
  return d.source === 'git' && d.kind === 'push' && d.remote !== null && d.remote !== 'origin'
    ? d.remote
    : null;
}

/** Where the publish goes and which commits it carries: [branch, target, range]. */
async function rangeFor(
  d: DetectedPublish,
  top: string,
  cur: string | null,
): Promise<[string | null, string | null, string | null]> {
  if (d.source === 'gh') return [null, null, null];
  if (d.source === 'wt-finish') {
    const head = await gitRead(top, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
    const def = head?.startsWith('refs/remotes/origin/') ? head.slice('refs/remotes/origin/'.length) : 'main';
    return [cur, def, safeRef(def) ? `origin/${def}..HEAD` : null];
  }
  if (d.kind === 'push') {
    const other = otherRemote(d);
    // A URL or path: no remote-tracking branch to compare with.
    const named = other === null || safeRef(other);
    if (d.ref === null || d.ref === 'HEAD') {
      if (other !== null) {
        if (!named) return [cur, cur, null];
        const push = await gitRead(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{push}']);
        if (push?.startsWith(`${other}/`)) return [cur, push.slice(other.length + 1), '@{push}..HEAD'];
        return [cur, cur, safeRef(cur) ? `${other}/${cur}..HEAD` : null];
      }
      const up = await gitRead(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
      if (up) return [cur, up.slice(up.indexOf('/') + 1), '@{upstream}..HEAD'];
      return [cur, cur, safeRef(cur) ? `origin/${cur}..HEAD` : null];
    }
    const spec = d.ref.replace(/^\+/, '');
    const [src, dst] = spec.includes(':') ? (spec.split(':', 2) as [string, string]) : [spec, spec];
    const fromHead = src === 'HEAD' || src === '';
    const branch = fromHead ? cur : src;
    // The commits going out are the pushed ref's own, not HEAD's: `git push origin other` from main.
    const tip = fromHead ? 'HEAD' : src;
    const remote = other ?? 'origin';
    return [branch, dst || null, named && safeRef(dst) && safeRef(tip) ? `${remote}/${dst}..${tip}` : null];
  }
  return [d.ref, cur, safeRef(d.ref) ? `HEAD..${d.ref}` : null];
}

/** Async, read-only, best effort: the card's facts (decision 8). Never throws. */
export async function publishFacts(
  d: DetectedPublish,
  command: string,
  cwd: string,
  ctx: AppCodeContext,
): Promise<CardFacts> {
  const facts = bareFacts(d.kind, command, d.danger);
  try {
    const top = await gitRead(repoDirFor(d, cwd, ctx.home), ['rev-parse', '--show-toplevel']);
    if (!top) return facts;
    facts.isApp = await isAppCodePath(top, ctx).catch(() => false);
    const other = otherRemote(d);
    if (other === null) {
      facts.repo = repoName(
        (await originUrl(top).catch(() => null)) ??
          (await gitRead(top, ['config', '--get', 'remote.origin.url'])),
      );
    } else if (other.includes(':')) {
      // A URL (or `host:path`) given in place of a remote name.
      facts.repo = repoName(other);
    } else if (safeRef(other)) {
      facts.repo = repoName(await gitRead(top, ['config', '--get', `remote.${other}.url`]));
    }
    if (facts.isApp) facts.version = await readVersion(top);
    const cur = (await gitRead(top, ['symbolic-ref', '--short', '-q', 'HEAD'])) || null;
    const [branch, target, range] = await rangeFor(d, top, cur);
    facts.branch = branch;
    facts.target = target;
    if (range) {
      const log = await gitRead(top, [
        'log',
        '--no-show-signature',
        '--format=%h %s',
        '-n',
        String(COMMITS_SHOWN),
        '--end-of-options',
        range,
      ]);
      const count = await gitRead(top, ['rev-list', '--count', '--end-of-options', range]);
      facts.commits = log === null ? null : log.split('\n').filter(Boolean);
      facts.commitCount = count !== null && /^\d+$/.test(count) ? Number(count) : null;
    }
    return facts;
  } catch {
    return facts;
  }
}

/** True when a detected publish is the brain's own plain push of `main` (no card, decision 6). */
export async function isBrainSync(d: DetectedPublish, cwd: string, ctx: AppCodeContext): Promise<boolean> {
  if (d.kind !== 'push' || d.source !== 'git' || d.dangerous || !d.plain) return false;
  if (d.remote !== null && d.remote !== 'origin') return false;
  const top = await gitRead(repoDirFor(d, cwd, ctx.home), ['rev-parse', '--show-toplevel']);
  if (!top) return false;
  if ((await realish(top)) !== (await realish(ctx.brainRoot))) return false;
  const cur = (await gitRead(top, ['symbolic-ref', '--short', '-q', 'HEAD'])) || null;
  let src: string | null;
  let dst: string | null;
  if (d.ref) {
    const [a, b] = d.ref.includes(':') ? (d.ref.split(':', 2) as [string, string]) : [d.ref, d.ref];
    src = a === 'HEAD' ? cur : a;
    dst = b === 'HEAD' ? cur : b;
  } else {
    src = cur;
    const up = await gitRead(top, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    dst = up === null ? cur : up === 'origin/main' ? 'main' : null;
  }
  return src === 'main' && dst === 'main';
}

// ---------------------------------------------------------------------------
// The whole hook decision (decision 7)
// ---------------------------------------------------------------------------

export interface GuardDeps {
  getRole: () => Promise<Role>;
  ctx: AppCodeContext;
  /** Injectable for tests; default the real ones. */
  refusal?: typeof teamAppRefusal;
  facts?: typeof publishFacts;
  brainSync?: typeof isBrainSync;
  /** Injectable for tests: the time budgets in ms (defaults SYNC_BUDGET_MS and FACTS_BUDGET_MS). */
  budgetMs?: { sync?: number; facts?: number };
}

export type GuardAnswer =
  | { decision: 'continue' }
  /** The brain's own sync: no card is forced. */
  | { decision: 'exempt' }
  | { decision: 'deny'; reason: string; notice: string }
  /** `facts` is null only when detection itself failed: the ordinary card is shown. */
  | { decision: 'ask'; facts: CardFacts | null };

/**
 * One PreToolUse decision. Never throws. Team refusals run first; an error there denies. Detection is pure;
 * an error after a publish was found still asks (with just the command).
 */
/**
 * Time allowed for the brain-sync check and the card facts. Together well under the SDK's 60 s hook
 * timeout: a hook that runs out of time may let the call through with no card, as a thrown one does.
 * Running out means no exemption and bare facts, so the card still shows.
 */
const SYNC_BUDGET_MS = 3_000;
const FACTS_BUDGET_MS = 5_000;

/** The promise's answer, or `fallback` once `ms` has passed. */
function withinBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

export async function guardToolCall(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  deps: GuardDeps,
): Promise<GuardAnswer> {
  try {
    const refused = await (deps.refusal ?? teamAppRefusal)(deps.getRole, toolName, input, cwd, deps.ctx);
    if (refused) return { decision: 'deny', ...refused };
  } catch {
    return { decision: 'deny', reason: CHANGE_CHECK_FAILED, notice: CHANGE_CHECK_FAILED };
  }
  let d: DetectedPublish | null = null;
  let toolKind: PublishKind | null = null;
  const command = toolName === 'Bash' && typeof input.command === 'string' ? input.command : null;
  try {
    if (command !== null) d = detectPublish(command);
    else toolKind = isPublishTool(toolName);
  } catch {
    return { decision: 'ask', facts: null };
  }
  if (!d && !toolKind) return { decision: 'continue' };
  const bare = bareFacts(d?.kind ?? (toolKind as PublishKind), command ?? toolName, d?.danger ?? null);
  if (!d || command === null) return { decision: 'ask', facts: bare };
  try {
    const sync = (deps.brainSync ?? isBrainSync)(d, cwd, deps.ctx);
    if (await withinBudget(sync, deps.budgetMs?.sync ?? SYNC_BUDGET_MS, false)) return { decision: 'exempt' };
  } catch {
    return { decision: 'ask', facts: bare };
  }
  try {
    const facts = (deps.facts ?? publishFacts)(d, command, cwd, deps.ctx);
    return {
      decision: 'ask',
      facts: await withinBudget(facts, deps.budgetMs?.facts ?? FACTS_BUDGET_MS, bare),
    };
  } catch {
    return { decision: 'ask', facts: bare };
  }
}
