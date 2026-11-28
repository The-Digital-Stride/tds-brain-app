import { useEffect, useRef, useState } from 'react';
import type { TimeStatus } from '../../../../shared/time-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useStore } from '../../store.tsx';
import { myDay } from './store.ts';
import { CONNECT_NOTICE, CONNECTED_WORDS, lostWords, NO_ADDRESS_NOTICE, WAITING_NOTICE } from './words.ts';

/** The id the Confirm day button points to when Toolbox is not connected. */
export const CONNECT_NOTICE_ID = 'myday-connect';

/**
 * Where the day stands with Toolbox (plan 2026-11-28-time-my-day, decision 12). Not connected: one notice under the
 * header with what to do next. Connected: one quiet line with Disconnect. The day is always shown beside it.
 */
export function ConnectPanel({ status, connectUrl }: { status: TimeStatus; connectUrl: string | null }) {
  const { openSettings } = useStore();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const disconnectButton = useRef<HTMLButtonElement>(null);
  const putBack = useRef(false);
  const c = status.connection;

  // Cancelling the Disconnect question puts focus back on the button that asked it.
  useEffect(() => {
    if (!asking && putBack.current) {
      putBack.current = false;
      disconnectButton.current?.focus();
    }
  }, [asking]);

  const connect = async () => {
    setWorking(true);
    await myDay.connect();
    setWorking(false);
  };

  if (c.state === 'connected') {
    return (
      <div className="myday-connected">
        <p className="myday-note">{CONNECTED_WORDS}</p>
        {c.reconnectSoon ? (
          <>
            <p className="myday-note">Your connection runs out soon. Reconnect to keep sending days.</p>
            <button
              type="button"
              className="btn"
              data-variant="quiet"
              data-size="small"
              aria-disabled={working || undefined}
              onClick={() => void connect()}
            >
              Reconnect
            </button>
          </>
        ) : null}
        {asking ? (
          <Confirm
            label="Disconnect from Toolbox"
            text="Disconnect from Toolbox? Your days stay on this Mac."
            action="Disconnect"
            variant="danger"
            busy={false}
            onConfirm={() => {
              setAsking(false);
              void myDay.disconnect();
            }}
            onCancel={() => {
              putBack.current = true;
              setAsking(false);
            }}
          />
        ) : (
          <button
            ref={disconnectButton}
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => setAsking(true)}
          >
            Disconnect
          </button>
        )}
      </div>
    );
  }

  const button = (label: string, onClick: () => void, busy = false) => (
    <button
      type="button"
      className="btn"
      data-size="small"
      aria-disabled={busy || undefined}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    // The live region stays in place; what it says changes, so the change is announced.
    <div className="myday-live" role="status">
      <div className="notice" data-shape="box" data-level="info" id={CONNECT_NOTICE_ID}>
        {c.state === 'no-address' ? (
          <>
            <span>{NO_ADDRESS_NOTICE}</span>
            {button('Open Settings', () => openSettings('general', 'toolbox-address'))}
          </>
        ) : null}
        {c.state === 'not-connected' && c.pending ? (
          <>
            <span>{WAITING_NOTICE}</span>
            {connectUrl ? (
              <span>
                Nothing opened?{' '}
                <a href={connectUrl} target="_blank" rel="noreferrer">
                  Open Toolbox yourself
                </a>
                .
              </span>
            ) : null}
          </>
        ) : null}
        {c.state === 'not-connected' && !c.pending ? (
          <>
            <span>{CONNECT_NOTICE}</span>
            {button('Connect to Toolbox', () => void connect(), working)}
          </>
        ) : null}
        {c.state === 'lost' ? (
          <>
            <span>{lostWords(c.reason)} Reconnect to send your days.</span>
            {button('Reconnect', () => void connect(), working)}
          </>
        ) : null}
      </div>
    </div>
  );
}
