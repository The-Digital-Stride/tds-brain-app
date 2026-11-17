import { useId } from 'react';
import { HelpLink } from '../../shell/HelpLink.tsx';
import { SearchSelect } from '../../shell/SearchSelect.tsx';
import type { PickOption } from '../../shell/search-select.ts';
import { useStore } from '../../store.tsx';
import { adStore, selectAccount, useAd, waitingFor } from './store.ts';

/** The sheet bar's buttons: the Account picker ("(n waiting)" after accounts with proposals for you), Refresh and Help. */
export function AdManagerBar() {
  const { accounts, account, loading } = useAd();
  const { ads, reloadAds, updatePrefs } = useStore();
  const id = useId();
  const options: PickOption[] = (accounts ?? []).map((a) => {
    const waiting = waitingFor(ads, a);
    return {
      value: a.key,
      label: waiting > 0 ? `${a.name} (${waiting} waiting)` : a.name,
      terms: [a.name, a.key],
    };
  });
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        Account
      </label>
      <SearchSelect
        id={id}
        className="am-account"
        value={account ?? ''}
        options={options}
        placeholder="Choose an account"
        disabled={!accounts || accounts.length === 0}
        onChange={(key) => {
          selectAccount(key);
          void updatePrefs({ adsAccount: key });
        }}
      />
      <button
        type="button"
        className="btn"
        data-variant="quiet"
        aria-disabled={loading || undefined}
        onClick={() => {
          if (loading) return;
          adStore.set({ refresh: adStore.get().refresh + 1 });
          void reloadAds();
        }}
      >
        Refresh
      </button>
      <HelpLink page="ad-manager" />
    </>
  );
}
