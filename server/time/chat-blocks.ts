/**
 * My day (plan decisions 7, 17, 28): chat time from prompt and answer times. Pure.
 *
 * 1. Each prompt is active from `leadMinutes` before it to min(last answer before the next prompt +
 *    `tailMinutes`, prompt + `maxRunMinutes`); a prompt with no answer, to prompt + `tailMinutes`.
 * 2. One chat's intervals less than `mergeGapMinutes` apart merge.
 * 3. Edges round to whole minutes. Each minute of the day goes to the chat whose latest prompt (counting
 *    from its lead) is latest; ties go to a chat with a place, then the lower chat id. Personal chats take
 *    part, so their time is never credited to a client.
 * 4. Each chat's minutes form blocks again, cut at London midnight (only `workDate` is answered).
 * 5. Personal chats' blocks and blocks under `minBlockMinutes` are dropped.
 * `claudeMinutes` is Claude's run time (prompt to last answer) inside the block: evidence, not time.
 */
import { CHAT_TIME, type ChatBlock, type ChatInput, type ChatPlace } from '../../shared/time-contract.ts';
import { isWorkDate, londonDayBounds } from './day-store.ts';

const MIN = 60_000;

export type ChatTimeRules = {
  readonly [K in
    | 'leadMinutes'
    | 'tailMinutes'
    | 'maxRunMinutes'
    | 'mergeGapMinutes'
    | 'minBlockMinutes']: number;
};

interface Prompt {
  at: number;
  /** Interval start, whole minutes since the epoch. */
  startMin: number;
  /** Claude's run: prompt to last answer (ms), or null when none came. */
  runEnd: number | null;
}

interface Chat {
  chatId: string;
  hasPlace: boolean;
  personal: boolean;
  prompts: Prompt[];
  /** Merged intervals in whole minutes, [start, end). */
  spans: Array<[number, number]>;
}

const hasPlace = (place: ChatPlace | null) =>
  place !== null && (place.client !== null || place.project !== null);

function buildChat(chatId: string, inputs: readonly ChatInput[], rules: ChatTimeRules): Chat {
  const marks = inputs
    .flatMap((i) => i.marks)
    .map((m) => ({ at: Date.parse(m.at), kind: m.kind }))
    .filter((m) => Number.isFinite(m.at))
    .sort((x, y) => x.at - y.at || (x.kind === y.kind ? 0 : x.kind === 'prompt' ? -1 : 1));

  const prompts: Prompt[] = [];
  const intervals: Array<[number, number]> = [];
  let current: { at: number; lastAnswer: number | null } | null = null;
  const close = () => {
    if (!current) return;
    const { at, lastAnswer } = current;
    const end =
      lastAnswer === null
        ? at + rules.tailMinutes * MIN
        : Math.min(lastAnswer + rules.tailMinutes * MIN, at + rules.maxRunMinutes * MIN);
    const start = at - rules.leadMinutes * MIN;
    prompts.push({ at, startMin: Math.round(start / MIN), runEnd: lastAnswer });
    intervals.push([start, end]);
  };
  for (const m of marks) {
    if (m.kind === 'prompt') {
      close();
      current = { at: m.at, lastAnswer: null };
    } else if (current) {
      current.lastAnswer = m.at;
    }
  }
  close();

  const merged: Array<[number, number]> = [];
  for (const [s, e] of intervals.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && s - last[1] < rules.mergeGapMinutes * MIN) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const spans = merged
    .map(([s, e]): [number, number] => [Math.round(s / MIN), Math.round(e / MIN)])
    .filter(([s, e]) => e > s);

  return {
    chatId,
    hasPlace: inputs.some((i) => hasPlace(i.place)),
    personal: inputs.some((i) => i.personal),
    prompts,
    spans,
  };
}

/** The latest prompt (by time) whose interval has started by minute `m`, or -Infinity. */
function keyAt(chat: Chat, m: number): number {
  let lo = 0;
  let hi = chat.prompts.length - 1;
  let best = Number.NEGATIVE_INFINITY;
  // startMin rises with `at`, so binary search on it.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const prompt = chat.prompts[mid] as Prompt;
    if (prompt.startMin <= m) {
      best = prompt.at;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** True when chat `a` takes a tied minute from chat `b`. */
const winsTie = (a: Chat, b: Chat) => (a.hasPlace !== b.hasPlace ? a.hasPlace : a.chatId < b.chatId);

export function chatBlocks(
  inputs: readonly ChatInput[],
  workDate: string,
  rules: ChatTimeRules = CHAT_TIME,
): ChatBlock[] {
  if (!isWorkDate(workDate)) return [];
  const { start, end } = londonDayBounds(workDate);
  const dayStart = start / MIN;
  const dayEnd = end / MIN;

  const byId = new Map<string, ChatInput[]>();
  for (const input of inputs) {
    const list = byId.get(input.chatId);
    if (list) list.push(input);
    else byId.set(input.chatId, [input]);
  }
  const chats = [...byId].map(([id, list]) => buildChat(id, list, rules));

  // Minute ownership for the day.
  const size = dayEnd - dayStart;
  const owner = new Int32Array(size).fill(-1);
  const ownerKey = new Float64Array(size).fill(Number.NEGATIVE_INFINITY);
  chats.forEach((chat, ci) => {
    for (const [s, e] of chat.spans) {
      for (let m = Math.max(s, dayStart); m < Math.min(e, dayEnd); m++) {
        const i = m - dayStart;
        const key = keyAt(chat, m);
        const held = owner[i] as number;
        const heldKey = ownerKey[i] as number;
        if (held === -1 || key > heldKey || (key === heldKey && winsTie(chat, chats[held] as Chat))) {
          owner[i] = ci;
          ownerKey[i] = key;
        }
      }
    }
  });

  const blocks: ChatBlock[] = [];
  let i = 0;
  while (i < size) {
    const ci = owner[i] as number;
    if (ci === -1) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < size && owner[j] === ci) j++;
    const chat = chats[ci] as Chat;
    const minutes = j - i;
    if (!chat.personal && minutes >= rules.minBlockMinutes) {
      const bs = (dayStart + i) * MIN;
      const be = (dayStart + j) * MIN;
      let run = 0;
      let prompts = 0;
      for (const p of chat.prompts) {
        if (p.at >= bs && p.at < be) prompts++;
        if (p.runEnd !== null) run += Math.max(0, Math.min(p.runEnd, be) - Math.max(p.at, bs));
      }
      const startAt = new Date(bs).toISOString();
      blocks.push({
        chatId: chat.chatId,
        captureKey: `${chat.chatId}@${startAt}`,
        workDate,
        startAt,
        endAt: new Date(be).toISOString(),
        minutes,
        claudeMinutes: Math.round(run / MIN),
        prompts,
      });
    }
    i = j;
  }
  return blocks;
}
