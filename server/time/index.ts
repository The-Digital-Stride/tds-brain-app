/**
 * My day (plan docs/plans/2026-11-28-time-my-day.md): the `TimeService` the routes and the loopback
 * callback use. It joins the Toolbox connection (connect, connection, toolbox-client, token-store) to the
 * day engine (day-store, changes, submit, links, chat-blocks, transcript-times, merge-capture, day-view).
 *
 * Every change to a day is a pure function applied inside the day store's queue (`update`), so two
 * requests for one day can't interleave. Slow work (Toolbox, transcripts) happens before, outside the queue.
 * Nothing here logs entry text, tokens, codes or submission bodies.
 */

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChatScope } from '../../shared/chat-places-contract.ts';
import type { AppSettings } from '../../shared/install-contract.ts';
import type { ProjectKey } from '../../shared/projects-contract.ts';
import {
  type AddEntryRequest,
  type ChatInput,
  type ChatPlace,
  type ConfirmAnswer,
  type DayDraft,
  type DayResult,
  type DaySubmission,
  type DayView,
  type EntryDeleteQuery,
  type EntryPatchRequest,
  MAX_CHANGE_AGE_DAYS,
  type StoredDay,
  TIME_WORK_ITEMS_FILE,
  type TimeService,
  type TimeServiceError,
  type TimeStatus,
  type TokenStore,
  type ToolboxCall,
  type WireWorkItem,
  type WorkItemsAnswer,
} from '../../shared/time-contract.ts';
import { addEntry, deleteEntry, type EditResult, editEntry } from './changes.ts';
import { chatBlocks } from './chat-blocks.ts';
import type { ChatTitleSource } from './chat-titles.ts';
import { createConnectFlow } from './connect.ts';
import { createConnection } from './connection.ts';
import { createDayStore, emptyDraft, isWorkDate, londonDate } from './day-store.ts';
import { dayView } from './day-view.ts';
import { applyRemember, assign, createLinksStore } from './links.ts';
import { type CaptureBlock, canAutoRefresh, mergeCapture } from './merge-capture.ts';
import { adoptStoredDay, applyResult, buildSubmission, markPending } from './submit.ts';
import { createKeychainTokenStore } from './token-store.ts';
import { createToolboxClient } from './toolbox-client.ts';
import { createTranscriptReader, type TranscriptTimes } from './transcript-times.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const MSG_NO_ADDRESS = 'Set the Toolbox address in Settings first.';
const MSG_BAD_ADDRESS =
  "That isn't an address Cortex can use. Use https://… or http://localhost:<port>, with no path.";
const MSG_ENV_ADDRESS =
  "The Toolbox address is set on this Mac by TDS_TOOLBOX_URL, so it can't be changed here.";
const MSG_BAD_DAY = 'Pick a day from the last 62 days, up to today.';
const MSG_NOT_CONNECTED = 'Connect to Toolbox to confirm this day.';
const MSG_NOT_SENT = 'Not sent. Your day is kept on this Mac; try again.';
const NOT_SENT_BY_KIND: Record<string, string> = {
  network: "Not sent: Toolbox couldn't be reached. Your day is kept on this Mac; try again.",
  server: 'Not sent: Toolbox had a problem. Your day is kept on this Mac; try again.',
  'rate-limited': 'Not sent: Toolbox is busy. Try again in a few minutes.',
  off: "Not sent: Toolbox's time tool is switched off. Your day is kept on this Mac.",
  forbidden: "Toolbox didn't let this account confirm time.",
  'too-large': 'Not sent: the day is too large for Toolbox. Remove or shorten some entries.',
};

/** The parts of a chat-places / chat-kinds store this service reads. */
export interface TimeServiceDeps {
  dataDir: string;
  brainRoot: string;
  env: Record<string, string | undefined>;
  /** The port Cortex listens on (Toolbox sends the browser back here). */
  port: number;
  personName: () => Promise<string | null>;
  readSettings: () => AppSettings;
  mergeSettings: (patch: AppSettings) => void;
  chatPlaces: { all(): Promise<Map<string, ChatScope>> };
  chatKinds: { personal(): Promise<Set<string>> };
  projectTitle: (key: ProjectKey) => Promise<string | null>;
  /**
   * Decision 32 and A: the chats Cortex still lists (sdkSessionId → what its title is made from), from
   * Claude Code's sessions list. Read only to show a title hint and open the chat; nothing from it is stored,
   * logged or sent. Absent or failing: no hints, no chat links.
   */
  chatTitles?: () => Promise<Map<string, ChatTitleSource>>;
  /** A project card says `visibility: restricted`. Absent or failing counts as restricted (no one-click use). */
  projectRestricted?: (key: ProjectKey) => Promise<boolean>;
  clientNames: () => Promise<Map<string, string>>;
  openBrowser: (url: string) => void;
  /** Tests. */
  tokens?: TokenStore;
  fetch?: typeof fetch;
  readTranscripts?: (brainRoot: string, workDate: string) => Promise<TranscriptTimes>;
  now?: () => Date;
  newId?: () => string;
  log?: (line: string) => void;
}

function serviceError(code: TimeServiceError['code'], message: string): TimeServiceError {
  return { code, message };
}

const isPersonalProject = (place: ChatPlace | null): boolean =>
  !!place?.project && place.project.startsWith('personal/');

export function createTimeService(deps: TimeServiceDeps): TimeService {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const log = deps.log ?? (() => {});
  const tokens = deps.tokens ?? createKeychainTokenStore();
  const days = createDayStore(deps.dataDir, { now, log });
  const links = createLinksStore(deps.dataDir, { now, log });
  const readTranscripts = deps.readTranscripts ?? createTranscriptReader({ env: deps.env, log });

  // The three connection parts need each other; closures break the circle (Builder A's wiring).
  // biome-ignore lint/style/useConst: assigned once below, referenced by closures created first.
  let client: ReturnType<typeof createToolboxClient>;
  // biome-ignore lint/style/useConst: as above.
  let flow: ReturnType<typeof createConnectFlow>;
  const connection = createConnection({
    dataDir: deps.dataDir,
    env: deps.env,
    readSettings: deps.readSettings,
    mergeSettings: deps.mergeSettings,
    tokens,
    revokeToken: (origin, token) => client.revokeToken(origin, token),
    hasPending: () => flow.hasPending(),
    cancelPending: () => flow.cancel(),
    now,
    log,
  });
  client = createToolboxClient({
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    tokens,
    origin: () => connection.connectedOrigin(),
    onUnauthorised: (cause) => connection.markLost(cause === 'missing-token' ? 'refused' : undefined),
    log,
  });
  flow = createConnectFlow({
    port: deps.port,
    exchange: (origin, code, verifier) => client.exchange(origin, code, verifier),
    save: (origin, answer) => connection.save(origin, answer),
    revokeToken: (origin, token) => client.revokeToken(origin, token),
    now: () => now().getTime(),
    log,
  });

  // ─── Work items: the last list from Toolbox, kept in memory and on disk (decision 26) ────────────────

  let items: WireWorkItem[] | null = null;
  let itemsFetchedAt: string | null = null;
  /** The list is fetched once per run of the app (then on Refresh), and read from disk before that. */
  let fetchedThisRun = false;
  const itemsFile = join(deps.dataDir, TIME_WORK_ITEMS_FILE);

  async function loadItemsFromDisk(): Promise<void> {
    if (items !== null) return;
    try {
      const raw = JSON.parse(await fsp.readFile(itemsFile, 'utf8')) as {
        origin?: unknown;
        items?: unknown;
        fetchedAt?: unknown;
      };
      // A list from another Toolbox (the address changed) is never offered (review, 2026-11-28).
      if (raw.origin !== connection.address().url) return;
      if (Array.isArray(raw.items)) {
        items = raw.items.filter(
          (w): w is WireWorkItem =>
            !!w && typeof (w as WireWorkItem).id === 'string' && typeof (w as WireWorkItem).name === 'string',
        );
        itemsFetchedAt = typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null;
      }
    } catch {
      // None saved yet, or unreadable: the next fetch replaces it.
    }
  }

  async function saveItems(list: WireWorkItem[], at: string): Promise<void> {
    try {
      await fsp.mkdir(dirname(itemsFile), { recursive: true, mode: 0o700 });
      const tmp = `${itemsFile}.${process.pid}.tmp`;
      const origin = connection.connectedOrigin();
      await fsp.writeFile(tmp, JSON.stringify({ origin, items: list, fetchedAt: at }), { mode: 0o600 });
      await fsp.chmod(tmp, 0o600);
      await fsp.rename(tmp, itemsFile);
    } catch {
      log('The Toolbox work item list could not be saved on this Mac.');
    }
  }

  async function workItemsList(refresh: boolean): Promise<WireWorkItem[]> {
    await loadItemsFromDisk();
    if (connection.connectedOrigin() !== null && (refresh || itemsFetchedAt === null || !fetchedThisRun)) {
      const answer = await client.workItems();
      if (answer.ok) {
        items = answer.value;
        itemsFetchedAt = now().toISOString();
        fetchedThisRun = true;
        await saveItems(items, itemsFetchedAt);
      }
    }
    return items ?? [];
  }

  // ─── Days ────────────────────────────────────────────────────────────────────────────────────────────

  function range(): { earliest: string; today: string } {
    const t = now();
    return { today: londonDate(t), earliest: londonDate(t.getTime() - MAX_CHANGE_AGE_DAYS * DAY_MS) };
  }

  function checkDay(workDate: string): void {
    const { earliest, today } = range();
    if (!isWorkDate(workDate) || workDate < earliest || workDate > today) {
      throw serviceError('bad-request', MSG_BAD_DAY);
    }
  }

  /** Capture notes per day, from the last read of the transcripts (shown, never stored). */
  const captureNotes = new Map<string, string[]>();

  async function captureBlocks(workDate: string): Promise<{
    blocks: CaptureBlock[];
    personal: Set<string>;
  }> {
    const [times, places, personalKinds] = await Promise.all([
      readTranscripts(deps.brainRoot, workDate),
      deps.chatPlaces.all(),
      deps.chatKinds.personal(),
    ]);
    captureNotes.set(workDate, times.notes);
    const personal = new Set(personalKinds);
    const inputs: ChatInput[] = times.chats.map((chat) => {
      const scope = places.get(chat.chatId);
      const place: ChatPlace | null = scope ? { client: scope.client, project: scope.project } : null;
      const isPersonal = personalKinds.has(chat.chatId) || isPersonalProject(place);
      if (isPersonal) personal.add(chat.chatId);
      return { ...chat, place, personal: isPersonal };
    });
    const placeOf = new Map(inputs.map((i) => [i.chatId, i.place]));
    const blocks = chatBlocks(inputs, workDate).map(
      (b): CaptureBlock => ({ ...b, place: placeOf.get(b.chatId) ?? null }),
    );
    return { blocks, personal };
  }

  /**
   * Read what capture needs (slow: transcripts, places, links) and return the pure merge to run inside the
   * day's queue, so an edit saved meanwhile is never overwritten.
   */
  async function capture(workDate: string, list: WireWorkItem[]): Promise<(d: DayDraft) => DayDraft> {
    const [{ blocks, personal }, saved] = await Promise.all([captureBlocks(workDate), links.read()]);
    return (d) =>
      mergeCapture(d, blocks, (place) => assign(place, saved, list), now(), {
        personalChatIds: personal,
        newId,
      });
  }

  async function view(draft: DayDraft, list: WireWorkItem[], extraNotes: string[] = []): Promise<DayView> {
    const [names, titles, chats, restricted] = await Promise.all([
      deps.clientNames(),
      projectTitles(draft),
      chatTitles(draft),
      restrictedProjects(draft),
    ]);
    const labelFor = (place: ChatPlace): string | null => {
      if (place.project) return titles.get(place.project) ?? null;
      return place.client ? (names.get(place.client) ?? place.client) : null;
    };
    return dayView(draft, list, labelFor, now(), {
      connected: connection.connectedOrigin() !== null,
      captureNotes: [...extraNotes, ...(captureNotes.get(draft.workDate) ?? [])],
      workItemsKnown: items !== null,
      chats,
      restricted: (place) => !!place.project && restricted.has(place.project),
    });
  }

  /** The day's chats Cortex still lists (decision A), with their title sources (decision 32). View only. */
  async function chatTitles(draft: DayDraft): Promise<Map<string, ChatTitleSource>> {
    const out = new Map<string, ChatTitleSource>();
    const wanted = new Set<string>();
    for (const e of draft.entries) if (!e.deleted && e.captured) wanted.add(e.captured.chatId);
    if (wanted.size === 0 || !deps.chatTitles) return out;
    const all = await deps.chatTitles().catch(() => new Map<string, ChatTitleSource>());
    for (const id of wanted) {
      const source = all.get(id);
      if (source) out.set(id, source);
    }
    return out;
  }

  /** The day's restricted projects (decision 32.4). A failed lookup counts as restricted. */
  async function restrictedProjects(draft: DayDraft): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const e of draft.entries) if (!e.deleted && e.place?.project) keys.add(e.place.project);
    const out = new Set<string>();
    await Promise.all(
      [...keys].map(async (k) => {
        const restricted = deps.projectRestricted ? await deps.projectRestricted(k).catch(() => true) : true;
        if (restricted) out.add(k);
      }),
    );
    return out;
  }

  async function projectTitles(draft: DayDraft): Promise<Map<string, string>> {
    const keys = new Set<string>();
    for (const e of draft.entries) if (e.place?.project) keys.add(e.place.project);
    const out = new Map<string, string>();
    await Promise.all(
      [...keys].map(async (k) => {
        const title = await deps.projectTitle(k).catch(() => null);
        if (title) out.set(k, title);
      }),
    );
    return out;
  }

  /** Read a day, creating an empty one in memory when none is saved. */
  async function current(workDate: string): Promise<{ draft: DayDraft; note: string | null }> {
    const read = await days.read(workDate);
    return { draft: read.draft ?? emptyDraft(workDate, now()), note: read.note };
  }

  /** Apply a pure change inside the day's queue and save it. */
  async function save(workDate: string, change: (d: DayDraft) => DayDraft): Promise<DayDraft> {
    const saved = await days.update(workDate, (cur) => change(cur ?? emptyDraft(workDate, now())));
    return saved ?? emptyDraft(workDate, now());
  }

  async function edit(
    workDate: string,
    run: (d: DayDraft, list: WireWorkItem[]) => EditResult,
  ): Promise<{ draft: DayDraft; entry: EditResult & { ok: true } }> {
    checkDay(workDate);
    const list = await workItemsList(false);
    let outcome: EditResult | null = null;
    const draft = await days.update(workDate, (cur) => {
      outcome = run(cur ?? emptyDraft(workDate, now()), list);
      return outcome.ok ? outcome.draft : null;
    });
    const result = outcome as EditResult | null;
    if (!result || !result.ok) {
      throw serviceError(
        result?.code ?? 'not-found',
        result?.message ?? "That entry isn't in this day any more.",
      );
    }
    return { draft: draft ?? result.draft, entry: result };
  }

  async function status(): Promise<TimeStatus> {
    return { connection: connection.state(), address: connection.address(), ...range() };
  }

  function notSentMessage(result: ToolboxCall<DayResult>): string {
    if (result.ok) return MSG_NOT_SENT;
    if (result.kind === 'error') return MSG_NOT_SENT;
    return NOT_SENT_BY_KIND[result.kind] ?? MSG_NOT_SENT;
  }

  return {
    status,

    async connect() {
      const address = connection.address();
      if (address.url === null) throw serviceError('bad-request', MSG_NO_ADDRESS);
      const answer = flow.start(address.url, await deps.personName().catch(() => null));
      try {
        deps.openBrowser(answer.url);
      } catch {
        // The screen shows the link as a fallback.
      }
      return answer;
    },

    async disconnect() {
      await connection.disconnect();
      items = null;
      itemsFetchedAt = null;
      fetchedThisRun = false;
      return status();
    },

    async setAddress(url) {
      const before = connection.address().url;
      const result = await connection.setAddress(url);
      if (result === 'invalid') throw serviceError('bad-request', MSG_BAD_ADDRESS);
      if (result === 'env') throw serviceError('bad-request', MSG_ENV_ADDRESS);
      if (connection.address().url !== before) {
        items = null;
        itemsFetchedAt = null;
        fetchedThisRun = false;
      }
      return status();
    },

    callback: (query) => flow.callback(query),

    async workItems(refresh): Promise<WorkItemsAnswer> {
      const list = await workItemsList(refresh);
      return { items: list, fetchedAt: itemsFetchedAt };
    },

    async day(workDate) {
      checkDay(workDate);
      const list = await workItemsList(false);
      const { draft: first, note } = await current(workDate);

      // Decision 20: a day never confirmed here reads Toolbox's copy first, so nothing it holds is lost.
      let stored: StoredDay | null = null;
      if (first.revision === 0 && first.pending === null && connection.connectedOrigin() !== null) {
        const answer = await client.readDay(workDate);
        if (answer.ok) stored = answer.value;
      }
      const merge = canAutoRefresh(first) ? await capture(workDate, list) : null;
      const final = await save(workDate, (cur) => {
        let next = stored ? adoptStoredDay(cur, stored, now()) : cur;
        // Only a day never confirmed, with nothing pending or under review, refreshes on its own (decision 24).
        if (merge && canAutoRefresh(next)) next = merge(next);
        return next;
      });
      return view(final, list, note ? [note] : []);
    },

    async refresh(workDate) {
      checkDay(workDate);
      const list = await workItemsList(true);
      const merge = await capture(workDate, list);
      const final = await save(workDate, merge);
      return view(final, list);
    },

    async addEntry(workDate, req: AddEntryRequest) {
      const { draft } = await edit(workDate, (d) => addEntry(d, req.values, now(), newId));
      return view(draft, items ?? []);
    },

    async changeEntry(workDate, id, req: EntryPatchRequest) {
      const { draft, entry } = await edit(workDate, (d, list) => editEntry(d, id, req, list, now()));
      let final = draft;
      const place = entry.entry.place;
      const picked = req.workItemId;
      if (place && typeof picked === 'string' && req.remember !== false) {
        await links.remember(place, picked);
        const list = items ?? [];
        final = await save(workDate, (cur) => applyRemember(cur, place, picked, list, now()));
      }
      return view(final, items ?? []);
    },

    async deleteEntry(workDate, id, opts: EntryDeleteQuery) {
      const { draft } = await edit(workDate, (d) =>
        deleteEntry(d, id, { private: opts.private === true }, now()),
      );
      return view(draft, items ?? []);
    },

    async confirm(workDate): Promise<ConfirmAnswer> {
      checkDay(workDate);
      const list = await workItemsList(false);
      if (connection.connectedOrigin() === null) {
        const { draft } = await current(workDate);
        return { outcome: 'not-connected', day: await view(draft, list), message: MSG_NOT_CONNECTED };
      }
      const { draft: read } = await current(workDate);
      const before = await view(read, list);
      if (read.pending === null && before.confirmBlocked !== null) {
        return { outcome: 'not-sent', day: before, message: before.confirmBlocked };
      }

      // Decision 19: the body is fixed (and kept) before it is sent, so a retry is always a repeat. With a
      // send already pending, buildSubmission returns that body unchanged.
      const pendingDraft = await save(workDate, (cur) => {
        const next = buildSubmission(cur, newId, now());
        return cur.pending?.submissionId === next.submissionId ? cur : markPending(cur, next, now());
      });
      const body: DaySubmission | undefined = pendingDraft.pending?.body;
      if (!body) return { outcome: 'not-sent', day: await view(pendingDraft, list), message: MSG_NOT_SENT };

      const result = await client.submitDay(body);
      let stored: StoredDay | null = null;
      if (result.ok && !result.value.ok && result.value.code === 'conflict') {
        const answer = await client.readDay(workDate);
        if (answer.ok) stored = answer.value;
      }
      const after = await save(workDate, (cur) => applyResult(cur, body, result, stored, now()));
      const day = await view(after, list);

      if (!result.ok) {
        if (result.kind === 'unauthorised') {
          return { outcome: 'not-connected', day, message: MSG_NOT_CONNECTED };
        }
        return { outcome: 'not-sent', day, message: notSentMessage(result) };
      }
      const answer = result.value;
      if (answer.ok) return { outcome: 'confirmed', day, repeated: answer.repeated };
      if (answer.code === 'conflict') {
        return stored
          ? { outcome: 'conflict', day, stored }
          : { outcome: 'not-sent', day, message: day.dayProblems[0] ?? MSG_NOT_SENT };
      }
      return { outcome: answer.code, day };
    },
  };
}
