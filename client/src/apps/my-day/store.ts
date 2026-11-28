import { useSyncExternalStore } from 'react';
import type {
  AddEntryRequest,
  ConfirmAnswer,
  DayView,
  EntryPatchRequest,
  TimeStatus,
  WorkItemOption,
} from '../../../../shared/time-contract.ts';
import { api } from '../../api.ts';

/** What the My day sheet and its edit panel share. They are mounted in different places in the shell, so it lives outside React. */
export interface Notice {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}

export interface MyDayState {
  status: TimeStatus | null;
  statusError: string | null;
  /** The day on show (YYYY-MM-DD); null until the status says what today is. */
  date: string | null;
  day: DayView | null;
  dayState: 'idle' | 'loading' | 'ready' | 'error';
  dayError: string | null;
  workItems: WorkItemOption[];
  /** An entry id, 'new' for the add form, or null. Shown in the panel. */
  editing: string | null;
  /** A change, a refresh or a confirm is on its way. */
  busy: boolean;
  notice: Notice | null;
  /** The Toolbox address Cortex opened (kept so it can be shown as a link). */
  connectUrl: string | null;
  /** Where focus goes once the screen has drawn: a `data-focus` value ("myday:<id>" or "myday:add"). */
  focusTo: string | null;
}

const initial = (): MyDayState => ({
  status: null,
  statusError: null,
  date: null,
  day: null,
  dayState: 'idle',
  dayError: null,
  workItems: [],
  editing: null,
  busy: false,
  notice: null,
  connectUrl: null,
  focusTo: null,
});

export const CONFIRM_NOTICES = {
  conflict: 'This day was changed somewhere else. Check it, then confirm again.',
  invalid: 'Toolbox could not accept some entries. Check the notes on each one.',
  locked: 'This month is closed in Toolbox.',
  forbidden: 'Toolbox did not accept this. Only admins can send time for now.',
  notSent: 'Not sent. Your day is kept on this Mac; try again.',
  confirmed: 'Day confirmed.',
} as const;

const failureText = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Something went wrong. Try again.';

let state = initial();
const listeners = new Set<() => void>();
let dayToken = 0;

function set(patch: Partial<MyDayState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** The status says whether Toolbox is connected, which decides whether work items can be read. */
function connected(s: TimeStatus | null): boolean {
  return s?.connection.state === 'connected';
}

export const myDay = {
  get: (): MyDayState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  reset(): void {
    dayToken++;
    state = initial();
    for (const l of listeners) l();
  },

  /** Reads the status; true when it is now connected and wasn't (the caller then reloads). */
  async loadStatus(): Promise<boolean> {
    const was = connected(state.status);
    try {
      const status = await api.timeStatus();
      set({ status, statusError: null, date: state.date ?? status.today });
      const now = connected(status);
      if (now && !was) {
        await myDay.loadWorkItems(true);
        if (state.date) await myDay.loadDay(state.date);
      }
      return now && !was;
    } catch (err) {
      set({ statusError: failureText(err) });
      return false;
    }
  },

  async loadWorkItems(refresh = false): Promise<void> {
    if (!connected(state.status)) return;
    try {
      const answer = await api.timeWorkItems(refresh);
      set({ workItems: answer.items });
    } catch {
      // The day still shows; names fall back to "Closed in Toolbox".
    }
  },

  async loadDay(date: string): Promise<void> {
    const token = ++dayToken;
    set({ date, dayState: 'loading', dayError: null, editing: null, notice: null });
    try {
      const day = await api.timeDay(date);
      if (token !== dayToken) return;
      set({ day, dayState: 'ready' });
    } catch (err) {
      if (token !== dayToken) return;
      set({ day: null, dayState: 'error', dayError: failureText(err) });
    }
  },

  /** Re-reads the day's chats (hidden for a confirmed day), and the work items. */
  async refresh(): Promise<void> {
    const date = state.date;
    if (!date || state.busy) return;
    set({ busy: true, notice: null });
    try {
      const [day] = await Promise.all([api.timeRefresh(date), myDay.loadWorkItems(true)]);
      if (state.date === date) set({ day });
    } catch (err) {
      set({ notice: { tone: 'error', text: failureText(err) } });
    } finally {
      set({ busy: false });
    }
  },

  /** Runs one change on the day; the server answers with the whole day. True when it worked. */
  async change(run: (date: string) => Promise<DayView>): Promise<boolean> {
    const date = state.date;
    if (!date || state.busy) return false;
    set({ busy: true, notice: null });
    try {
      const day = await run(date);
      if (state.date === date) set({ day });
      return true;
    } catch (err) {
      set({ notice: { tone: 'error', text: failureText(err) } });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  addEntry: (req: AddEntryRequest) => myDay.change((d) => api.timeAddEntry(d, req)),
  saveEntry: (id: string, req: EntryPatchRequest) => myDay.change((d) => api.timeChangeEntry(d, id, req)),
  deleteEntry: (id: string, asPrivate: boolean) => myDay.change((d) => api.timeDeleteEntry(d, id, asPrivate)),

  async confirm(): Promise<void> {
    const date = state.date;
    if (!date || state.busy) return;
    set({ busy: true, notice: null });
    try {
      const answer: ConfirmAnswer = await api.timeConfirm(date);
      if (state.date !== date) return;
      const day = answer.day;
      switch (answer.outcome) {
        case 'confirmed':
          set({ day, notice: { tone: 'ok', text: CONFIRM_NOTICES.confirmed } });
          break;
        case 'conflict':
          set({ day, notice: { tone: 'warn', text: CONFIRM_NOTICES.conflict } });
          break;
        case 'invalid':
          set({ day, notice: { tone: 'warn', text: CONFIRM_NOTICES.invalid } });
          break;
        case 'locked':
          set({ day, notice: { tone: 'warn', text: CONFIRM_NOTICES.locked } });
          break;
        case 'forbidden':
          set({ day, notice: { tone: 'warn', text: CONFIRM_NOTICES.forbidden } });
          break;
        case 'not-connected':
          set({ day, notice: { tone: 'warn', text: answer.message } });
          void myDay.loadStatus();
          break;
        default:
          set({ day, notice: { tone: 'warn', text: CONFIRM_NOTICES.notSent } });
      }
    } catch (err) {
      set({ notice: { tone: 'error', text: failureText(err) } });
    } finally {
      set({ busy: false });
    }
  },

  async connect(): Promise<void> {
    set({ notice: null });
    try {
      const { url } = await api.timeConnect();
      set({ connectUrl: url });
      await myDay.loadStatus();
    } catch (err) {
      set({ notice: { tone: 'error', text: failureText(err) } });
    }
  },

  async disconnect(): Promise<void> {
    set({ notice: null });
    try {
      const status = await api.timeDisconnect();
      set({ status, workItems: [], connectUrl: null });
      if (state.date) await myDay.loadDay(state.date);
    } catch (err) {
      set({ notice: { tone: 'error', text: failureText(err) } });
    }
  },

  setStatus: (status: TimeStatus) => set({ status }),
  edit: (editing: string | null) => set({ editing }),
  /** Closes the edit form and asks for focus to go to `focusTo` (a `data-focus` value). */
  leave: (focusTo: string | null) => set({ editing: null, focusTo }),
  clearFocus: () => set({ focusTo: null }),
  dismissNotice: () => set({ notice: null }),
};

export function useMyDay(): MyDayState {
  return useSyncExternalStore(myDay.subscribe, myDay.get);
}
