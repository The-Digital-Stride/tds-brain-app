import { useCallback } from 'react';
import { ADS_ERROR_MESSAGES, type AdsChangeReply } from '../../../../shared/ads-contract.ts';
import { ApiFailure } from '../../api.ts';
import { useStore } from '../../store.tsx';
import { adStore, applyReply, loadApprovals, proposalKey } from './store.ts';
import { adsErrorText } from './words.ts';

export interface RunOptions {
  client: string;
  /** The proposal id, or the month for a report sign-off. */
  id: string;
  /** Shown while running and in the result line: "Approving". */
  label: string;
  call: () => Promise<AdsChangeReply>;
  /** After a decision: open the next proposal that is waiting. */
  advance?: boolean;
  /** Apply: never retried; a failure we can't read is treated as an unknown outcome. */
  apply?: boolean;
  /** Reload the approvals afterwards (the reply has no proposal, e.g. a report sign-off). */
  reload?: boolean;
  /** Request changes: start the revising chat in the background and offer Open chat. */
  revise?: boolean;
}

const unknownOutcome = (err: unknown) =>
  err instanceof ApiFailure &&
  (err.code === ('unknown-outcome' as string) || err.message === ADS_ERROR_MESSAGES['unknown-outcome']);

/** Runs one change at a time and records its result line. Buttons read `busy` from the store and are `aria-disabled`. */
export function useAdsRunner() {
  const { reloadAds, startChat } = useStore();
  return useCallback(
    async (o: RunOptions): Promise<boolean> => {
      if (adStore.get().busy) return false;
      adStore.set({ busy: `${o.apply ? 'apply' : o.label}:${o.id}` });
      try {
        const reply = await o.call();
        applyReply(o.client, o.id, reply, o.advance === true);
        let chatId = reply.chatId ?? null;
        if (o.revise && !chatId) {
          const prompt = reply.revisePrompt ?? null;
          if (prompt) chatId = await startChat(prompt, o.client, { open: false });
        }
        adStore.set({
          last: {
            client: o.client,
            id: o.id,
            ok: reply.failed !== true,
            text:
              o.revise && !chatId && reply.revisePrompt
                ? "Changes requested. The revision chat couldn't start, so ask for the changes in a chat yourself."
                : reply.message,
            output: reply.output,
            chatId,
          },
        });
        if (o.reload) await loadApprovals();
        void reloadAds();
        return true;
      } catch (err) {
        const unknown =
          o.apply && (unknownOutcome(err) || (err instanceof ApiFailure && err.code === 'network'));
        const key = proposalKey(o.client, o.id);
        adStore.set({
          last: {
            client: o.client,
            id: o.id,
            ok: false,
            text: unknown ? ADS_ERROR_MESSAGES['unknown-outcome'] : adsErrorText(err),
            ...(err instanceof ApiFailure && err.output ? { output: err.output } : {}),
          },
          ...(unknown ? { unknownApply: [...adStore.get().unknownApply.filter((k) => k !== key), key] } : {}),
        });
        return false;
      } finally {
        adStore.set({ busy: null });
      }
    },
    [reloadAds, startChat],
  );
}
