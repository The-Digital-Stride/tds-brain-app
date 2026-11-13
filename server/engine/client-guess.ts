/**
 * Works out which client a new chat's first message is for, before the chat starts
 * (`POST /api/client-guess`, plan 2026-11-13-client-picker-jev, decision 5).
 *
 * Step 1 is pure code: a client named in full (its name, its slug as words, or a `map.json` alias
 * that is a spelling of the name) is `sure`. Nicknames ("TDS", "Air Con") are only hints. Step 2
 * asks Jev one `choice` question through the injected `JevAsk`; anything short of the thresholds
 * becomes `ask`. Never throws, never writes anything.
 */
import type { ClientGuessResponse } from '../../shared/contract.ts';

export interface ClientAlias {
  slug: string;
  name: string;
  aliases: string[];
}

export type JevAsk = (
  state: string,
  criteria: Record<string, string>,
  signal: AbortSignal,
) => Promise<{ choice: string; confidence: number; probabilities: Record<string, number> } | null>;

/** Every number that decides `sure` / `none` / `ask`, in one place. */
export const CLIENT_GUESS_THRESHOLDS = {
  /** Jev's top client needs at least this probability… */
  sureProbability: 0.9,
  /** …and at least this confidence to be `sure`. */
  sureConfidence: 0.8,
  /** Jev's top answer `none` needs at least this probability to be `none`. */
  noneProbability: 0.8,
  /** Clients below this probability are not offered in `ask`. */
  optionProbability: 0.1,
  /** At most this many of Jev's clients are offered… */
  maxJevOptions: 2,
  /** …and at most this many options in all. */
  maxOptions: 3,
  /** Jev gets this long to answer. */
  timeoutMs: 2_000,
  /** After Jev fails, it is skipped for this long. */
  backoffMs: 60_000,
} as const;

/** Only this much of the message is matched or sent to Jev. */
export const CLIENT_GUESS_MAX_CHARS = 4_000;

/** The criterion key for "not client work". */
export const NONE_KEY = 'none';

const AGENCY_SLUG = 'the-digital-stride';
const AGENCY_CRITERION = "The Digital Stride's own marketing: its ads, website and SEO";
const NONE_CRITERION =
  'Not about any one client: internal agency work, admin, tools, hiring or general questions';

/** Lower-case letters and digits only: "H2O Restorations" → "h2orestorations". */
function letters(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole words, with any run of spaces, `_` or `-` between them. Null for a phrase with no words. */
function phraseRe(phrase: string, ignoreCase: boolean): RegExp | null {
  const words = phrase.split(/[\s_-]+/).filter(Boolean);
  if (words.length === 0) return null;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${words.map(escapeRe).join('[\\s_-]+')}(?![\\p{L}\\p{N}])`,
    ignoreCase ? 'giu' : 'gu',
  );
}

type Span = [number, number];

function spans(text: string, re: RegExp | null): Span[] {
  if (!re) return [];
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length] as Span);
}

/** Splits a client's aliases into spellings of its name and nicknames (decision 5). */
function splitAliases(c: ClientAlias): { names: string[]; nicknames: string[] } {
  const keys = [letters(c.name), letters(c.slug)].filter(Boolean);
  const names = [c.name, c.slug.replace(/-/g, ' ')];
  const nicknames: string[] = [];
  for (const alias of c.aliases) {
    const k = letters(alias);
    if (!k) continue;
    if (keys.some((n) => n.includes(k) || k.includes(n))) names.push(alias);
    else nicknames.push(alias);
  }
  return { names, nicknames };
}

/** Short (3 characters or fewer) or all-capital nicknames must match their exact case. */
function exactCase(alias: string): boolean {
  const trimmed = alias.trim();
  return trimmed.length <= 3 || (trimmed === trimmed.toUpperCase() && trimmed !== trimmed.toLowerCase());
}

/**
 * Clients the text names (`named`) and clients only a nickname points at (`hinted`), both in the
 * order `clients` is given. A name found only inside a longer match of another client's name
 * ("Weightmans" in "Weightmans Litigation") does not count.
 */
export function nameMatches(text: string, clients: ClientAlias[]): { named: string[]; hinted: string[] } {
  const found = clients.map((c) => {
    const { names, nicknames } = splitAliases(c);
    return {
      slug: c.slug,
      named: names.flatMap((n) => spans(text, phraseRe(n, true))),
      hinted: nicknames.some((n) => spans(text, phraseRe(n, !exactCase(n))).length > 0),
    };
  });
  const inside = (s: Span, t: Span) => t[0] <= s[0] && s[1] <= t[1] && t[1] - t[0] > s[1] - s[0];
  const named: string[] = [];
  for (const f of found) {
    if (f.named.length === 0) continue;
    const others = found.filter((o) => o !== f).flatMap((o) => o.named);
    if (f.named.some((s) => !others.some((t) => inside(s, t)))) named.push(f.slug);
  }
  const hinted = found.filter((f) => f.hinted && !named.includes(f.slug)).map((f) => f.slug);
  return { named, hinted };
}

/** Jev's criteria: each client slug, plus `none`. */
export function clientCriteria(clients: ClientAlias[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of clients) {
    if (c.slug === NONE_KEY) continue;
    if (c.slug === AGENCY_SLUG) {
      out[c.slug] = AGENCY_CRITERION;
      continue;
    }
    const seen = new Set([c.name.trim().toLowerCase()]);
    const also: string[] = [];
    for (const raw of c.aliases) {
      const a = raw.trim();
      if (!a || /[_-]/.test(a) || seen.has(a.toLowerCase())) continue;
      seen.add(a.toLowerCase());
      also.push(a);
    }
    out[c.slug] = `The client ${c.name}${also.length ? ` (also called ${also.join(', ')})` : ''}`;
  }
  out[NONE_KEY] = NONE_CRITERION;
  return out;
}

/** The text worth matching: a leading `/skill` name dropped, cut to the limit, trimmed. */
function prepare(text: string): string {
  let t = text.trimStart().replace(/^\/[\w.:-]+/, '');
  t = t.trim().slice(0, CLIENT_GUESS_MAX_CHARS);
  // don't end on half of a surrogate pair
  if (/[\uD800-\uDBFF]$/.test(t)) t = t.slice(0, -1);
  return t.trim();
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

type JevAnswer = NonNullable<Awaited<ReturnType<JevAsk>>>;

/** Runs the ask with a deadline; resolves null on timeout or any failure. */
async function withDeadline(
  ask: JevAsk,
  state: string,
  criteria: Record<string, string>,
  timeoutMs: number,
): Promise<JevAnswer | null> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      ac.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([ask(state, criteria, ac.signal).catch(() => null), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function createClientGuesser(opts: {
  ask: JevAsk | null;
  timeoutMs?: number;
  backoffMs?: number;
  now?: () => number;
}): (text: string, clients: ClientAlias[]) => Promise<ClientGuessResponse> {
  const T = CLIENT_GUESS_THRESHOLDS;
  const timeoutMs = opts.timeoutMs ?? T.timeoutMs;
  const backoffMs = opts.backoffMs ?? T.backoffMs;
  const now = opts.now ?? Date.now;
  let skipUntil = Number.NEGATIVE_INFINITY;

  return async (text, clients) => {
    try {
      const state = prepare(typeof text === 'string' ? text : '');
      if (!state || clients.length === 0) return { kind: 'none' };
      const { named, hinted } = nameMatches(state, clients);
      const [only] = named;
      if (only !== undefined && named.length === 1) return { kind: 'sure', client: only, how: 'named' };
      if (named.length > 1) return { kind: 'ask', options: named.slice(0, T.maxOptions) };

      const fallback: ClientGuessResponse = { kind: 'ask', options: hinted.slice(0, T.maxOptions) };
      if (!opts.ask || now() < skipUntil) return fallback;

      const criteria = clientCriteria(clients);
      const r = await withDeadline(opts.ask, state, criteria, timeoutMs);
      if (!r || typeof r.choice !== 'string' || !Object.hasOwn(criteria, r.choice)) {
        skipUntil = now() + backoffMs;
        return fallback;
      }

      const probs = r.probabilities && typeof r.probabilities === 'object' ? r.probabilities : {};
      const p = (key: string) => {
        const v = Object.hasOwn(probs, key) ? probs[key] : undefined;
        return typeof v === 'number' && Number.isFinite(v) ? v : 0;
      };
      const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : 0;
      if (r.choice === NONE_KEY) {
        if (p(NONE_KEY) >= T.noneProbability) return { kind: 'none' };
      } else if (p(r.choice) >= T.sureProbability && confidence >= T.sureConfidence) {
        return { kind: 'sure', client: r.choice, how: 'jev' };
      }

      const fromJev = Object.keys(criteria)
        .filter((k) => k !== NONE_KEY && !hinted.includes(k) && p(k) >= T.optionProbability)
        .sort((a, b) => p(b) - p(a))
        .slice(0, T.maxJevOptions);
      return { kind: 'ask', options: unique([...hinted, ...fromJev]).slice(0, T.maxOptions) };
    } catch {
      return { kind: 'ask', options: [] };
    }
  };
}
