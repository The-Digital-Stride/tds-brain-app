import { useSyncExternalStore } from 'react';
import type {
  AdsAccount,
  AdsApprovals,
  AdsBoard,
  AdsChangeReply,
  AdsSummary,
  ClientApprovals,
  ProposalFull,
  ProposalSummary,
} from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { adsErrorText, isWaiting, OPEN_STATUSES } from './words.ts';

/** The last change's result line, kept across list rebuilds (the Workbench lost it within a second once). */
export interface LastResult {
  client: string;
  id: string;
  ok: boolean;
  text: string;
  output?: string;
  /** A revising chat started in the background, so the line can offer "Open chat". */
  chatId?: string | null;
}

/** What Ad Manager is showing; shared by its sheet, its bar and its panel (mounted in different places). */
export interface AdState {
  accounts: AdsAccount[] | null;
  /** The chosen account key, or null until the screen picks one. */
  account: string | null;
  approvals: AdsApprovals | null;
  board: AdsBoard | null;
  boardFor: string | null;
  loadError: string | null;
  boardError: string | null;
  loading: boolean;
  /** The proposal in the panel. */
  selected: { client: string; id: string } | null;
  /** Full proposals (with their text), by `client/id`, fetched when "Full proposal text" opens or a change replies. */
  full: Record<string, ProposalFull>;
  panelMode: 'proposal' | 'rate';
  /** Details was pressed: the panel moves focus to the proposal's title once it shows, then clears this. */
  focusTitle: boolean;
  /** What is running (`apply:<id>`, `approve:<id>`…) or null. One change at a time, as on the server. */
  busy: string | null;
  /** Applies whose outcome we don't know (network failure, or a time-out), by `client/id`. */
  unknownApply: string[];
  last: LastResult | null;
  /** Goes up on Refresh so the sheet reloads. */
  refresh: number;
}

const initial = (): AdState => ({
  accounts: null,
  account: null,
  approvals: null,
  board: null,
  boardFor: null,
  loadError: null,
  boardError: null,
  loading: false,
  selected: null,
  full: {},
  panelMode: 'proposal',
  focusTitle: false,
  busy: null,
  unknownApply: [],
  last: null,
  refresh: 0,
});

let state = initial();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export const adStore = {
  get: () => state,
  set(patch: Partial<AdState>) {
    state = { ...state, ...patch };
    emit();
  },
  reset() {
    state = initial();
    emit();
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

export function useAd(): AdState {
  return useSyncExternalStore(adStore.subscribe, adStore.get, adStore.get);
}

export const proposalKey = (client: string, id: string) => `${client}/${id}`;

/**
 * How many proposals wait for this person's decision on an account: the rail's own count (approved ones are waiting
 * for Apply, not a decision). Falls back to the bridge's count, which older bridges made with approved ones included.
 */
export function waitingFor(ads: AdsSummary | null | undefined, account: AdsAccount): number {
  return ads?.clients.find((c) => c.slug === account.key)?.waiting ?? account.waiting;
}

/** The proposal summary selected in the panel, from the open list (or the recent one). */
export function findProposal(
  approvals: AdsApprovals | null,
  sel: { client: string; id: string } | null,
): { client: ClientApprovals; proposal: ProposalSummary } | null {
  if (!approvals || !sel) return null;
  const client = approvals.clients.find((c) => c.slug === sel.client);
  const proposal = client?.open.find((p) => p.id === sel.id);
  return client && proposal ? { client, proposal } : null;
}

/** The proposal after `id` that still needs a decision (wrapping), or null. */
export function nextWaiting(open: ProposalSummary[], id: string): ProposalSummary | null {
  const at = open.findIndex((p) => p.id === id);
  for (let i = 1; i <= open.length; i++) {
    const p = open[(at + i + open.length) % open.length];
    if (p && p.id !== id && isWaiting(p)) return p;
  }
  return null;
}

/** Puts a change reply's new proposal state into the lists (no re-fetch): kept open, or moved to Recent. */
export function applyReply(client: string, id: string, reply: AdsChangeReply, advance: boolean): void {
  const s = adStore.get();
  const patch: Partial<AdState> = {};
  const full = reply.proposal;
  let next: { client: string; id: string } | null = s.selected;
  if (full && s.approvals) {
    const summary: ProposalSummary = {
      id: full.id,
      file: full.file,
      fm: full.fm,
      warnings: full.warnings,
      flags: full.flags,
    };
    const clients = s.approvals.clients.map((c) => {
      if (c.slug !== client) return c;
      const open = c.open.filter((p) => p.id !== id);
      if (advance) {
        const n = nextWaiting(c.open, id);
        next = n ? { client, id: n.id } : OPEN_STATUSES.has(full.fm.status) ? { client, id } : null;
      }
      if (OPEN_STATUSES.has(full.fm.status)) {
        const at = c.open.findIndex((p) => p.id === id);
        open.splice(at < 0 ? open.length : at, 0, summary);
        return { ...c, open };
      }
      return { ...c, open, recent: [summary, ...c.recent.filter((p) => p.id !== id)] };
    });
    patch.approvals = { ...s.approvals, clients };
    patch.full = { ...s.full, [proposalKey(client, id)]: full };
    patch.selected = next;
  }
  adStore.set(patch);
}

/** Loads the account list and the approvals together. Failure leaves the old data and sets `loadError`. */
export async function loadApprovals(): Promise<void> {
  adStore.set({ loading: true });
  try {
    const [accounts, approvals] = await Promise.all([api.adsAccounts(), api.adsApprovals()]);
    const s = adStore.get();
    // A selection whose proposal has gone (decided elsewhere) closes.
    const gone = s.selected && !findProposal(approvals, s.selected);
    adStore.set({
      accounts,
      approvals,
      loadError: null,
      loading: false,
      ...(gone ? { selected: null } : {}),
    });
  } catch (err) {
    adStore.set({ loadError: adsErrorText(err), loading: false });
  }
}

export async function loadBoard(account: string): Promise<void> {
  try {
    const board = await api.adsBoard(account);
    if (adStore.get().account !== account) return;
    adStore.set({ board, boardFor: account, boardError: null });
  } catch (err) {
    if (adStore.get().account !== account) return;
    adStore.set({ board: null, boardFor: account, boardError: adsErrorText(err) });
  }
}

/** Chooses the account the screen shows. The board and the panel's proposal belong to it, so they clear. */
export function selectAccount(account: string): void {
  if (adStore.get().account === account) return;
  adStore.set({
    account,
    board: null,
    boardFor: null,
    boardError: null,
    selected: null,
    panelMode: 'proposal',
  });
}
