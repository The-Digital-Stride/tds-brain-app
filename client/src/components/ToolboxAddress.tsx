import { useEffect, useState } from 'react';
import type { TimeStatus } from '../../../shared/time-contract.ts';
import { api } from '../api.ts';

/**
 * Settings, General: where TDS Toolbox is (plan 2026-11-28-time-my-day, decision 2). Owners and scouts only; the
 * caller decides that. Changing the address disconnects from the old one.
 */
export function ToolboxAddress() {
  const [status, setStatus] = useState<TimeStatus | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.timeStatus())
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setValue(s.address.url ?? '');
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // A build with no time service answers 404: there is nothing to set, so the setting is not shown.
  if (failed || !status) return null;
  const fromEnv = status.address.source === 'env';

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.timeAddress(value.trim() === '' ? null : value.trim());
      setStatus(next);
      setValue(next.address.url ?? '');
      setMessage({ tone: 'ok', text: 'Saved. Connect to Toolbox again from My day.' });
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof Error && err.message ? err.message : 'That address was not saved. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting">
      <div>
        <label className="setting-label" htmlFor="toolbox-address">
          Toolbox address
        </label>
        <p className="setting-help" id="toolbox-address-help">
          {fromEnv
            ? 'This address is set by TDS_TOOLBOX_URL on this Mac, so it cannot be changed here.'
            : 'Where TDS Toolbox is, for example https://toolbox.example.com. Changing it disconnects My day.'}
        </p>
        {message ? (
          <p className={message.tone === 'error' ? 'error' : 'setting-help'} role="status">
            {message.text}
          </p>
        ) : null}
      </div>
      <div className="toolbox-address-controls">
        <input
          id="toolbox-address"
          type="url"
          className="field"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="toolbox-address-help"
          readOnly={fromEnv}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {fromEnv ? null : (
          <button
            type="button"
            className="btn"
            aria-disabled={busy || undefined}
            onClick={() => !busy && void save()}
          >
            Save address
          </button>
        )}
      </div>
    </div>
  );
}
