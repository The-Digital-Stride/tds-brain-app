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
  // 'none': this build has no time service (a 404). 'error': it should have, and could not be reached.
  const [failed, setFailed] = useState<'none' | 'error' | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => api.timeStatus())
      .then((s) => {
        if (!live) return;
        setStatus(s);
        setValue(s.address.url ?? '');
      })
      .catch((err: unknown) => {
        if (!live) return;
        setFailed((err as { status?: number } | null)?.status === 404 ? 'none' : 'error');
      });
    return () => {
      live = false;
    };
  }, []);

  // A build with no time service answers 404: there is nothing to set, so the setting is not shown.
  if (failed === 'none') return null;
  if (failed === 'error') {
    return (
      <div className="setting">
        <div>
          <p className="setting-label">Toolbox address</p>
          <p className="error" role="alert">
            The Toolbox address can't be loaded right now. Close Settings and open it again to retry.
          </p>
        </div>
      </div>
    );
  }
  if (!status) return null;
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
        {/* The status region is always here and is filled afterwards, so "Saved" is announced. */}
        <div role="status">
          {message?.tone === 'ok' ? <p className="setting-help">{message.text}</p> : null}
        </div>
        {message?.tone === 'error' ? (
          <p className="error" role="alert">
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
