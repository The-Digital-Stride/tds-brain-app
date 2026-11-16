// Readers over the contract's board and approvals types (shared/ads-contract.ts). Tolerant: an older or odd reply reads as empty.
import type {
  AdsBoard,
  AdsHealth,
  AdsMonthly,
  AdsPack,
  AdsSetupPrompts,
  AdsStandupBrief,
  AdsStandupVerdict,
  AdsTable,
  ClientApprovals,
} from '../../../../shared/ads-contract.ts';

export type { AdsHealthFile as HealthFile } from '../../../../shared/ads-contract.ts';
export type Table = AdsTable;
export type ColType = AdsTable['cols'][number]['type'];
export type StandupBrief = AdsStandupBrief;

export const readPack = (c: ClientApprovals): AdsPack | null => c.pack ?? null;
export const readMonthly = (c: ClientApprovals): AdsMonthly | null =>
  c.monthly ? ({ ...c.monthly, files: c.monthly.files ?? {} } as AdsMonthly) : null;
export const readHealth = (b: AdsBoard): AdsHealth | null =>
  b.health && Array.isArray(b.health.files) ? b.health : null;
export const readTables = (b: AdsBoard): AdsTable[] => (Array.isArray(b.tables) ? b.tables : []);
export const readSetupPrompts = (b: AdsBoard): Partial<AdsSetupPrompts> => b.setupPrompts ?? {};

export interface StandupState {
  hasStandup: boolean;
  verdict: AdsStandupVerdict | null;
  prompt: string | null;
  labels: Record<string, string>;
}
export function readStandup(b: AdsBoard): StandupState {
  const s = b.standup;
  return {
    hasStandup: s?.hasStandup === true,
    verdict: s?.verdict ?? null,
    prompt: s?.prompt || null,
    labels: s?.actionLabels ?? {},
  };
}
