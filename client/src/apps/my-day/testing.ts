import type { DayEntryView, DayView, TimeStatus } from '../../../../shared/time-contract.ts';

/** Test helpers: a day, an entry and a status with sensible defaults. */
export function entry(over: Partial<DayEntryView> = {}): DayEntryView {
  return {
    id: '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b',
    source: 'cortex-chat',
    certainty: 'strong',
    values: {
      startAt: '2026-11-27T09:00:00+00:00',
      minutes: 45,
      workItemId: 'wi-1',
      description: 'Planning the launch',
      billable: true,
    },
    endAt: '2026-11-27T09:45:00+00:00',
    edited: [],
    evidence: 'Cortex chat: Acme website',
    claudeMinutes: 20,
    missing: false,
    fromToolbox: false,
    placeLabel: 'Acme website',
    workItemClosed: false,
    problems: [],
    ...over,
  };
}

export function day(over: Partial<DayView> = {}): DayView {
  return {
    workDate: '2026-11-27',
    status: 'not-confirmed',
    revision: 0,
    entries: [entry()],
    totalMinutes: 45,
    totals: [{ workItemId: 'wi-1', minutes: 45, billableMinutes: 45 }],
    gaps: [],
    dayProblems: [],
    confirmBlocked: null,
    captureNotes: [],
    privateAllowed: true,
    ...over,
  };
}

export function status(over: Partial<TimeStatus> = {}): TimeStatus {
  return {
    connection: {
      state: 'connected',
      origin: 'https://toolbox.example',
      expiresAt: '2027-03-01T00:00:00Z',
      reconnectSoon: false,
    },
    address: { url: 'https://toolbox.example', source: 'settings' },
    earliest: '2026-09-26',
    today: '2026-11-28',
    ...over,
  };
}

export const WORK_ITEMS = [
  { id: 'wi-1', name: 'Acme retainer', kind: 'retainer' as const, cortexKey: null, clientId: null },
  {
    id: 'wi-2',
    name: 'Acme website build',
    kind: 'project' as const,
    cortexKey: 'acme/website',
    clientId: null,
  },
  { id: 'wi-3', name: 'TDS admin', kind: 'internal' as const, cortexKey: null, clientId: null },
];
