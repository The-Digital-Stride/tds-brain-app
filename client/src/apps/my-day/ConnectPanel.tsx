import { useState } from 'react';
import type { TimeStatus } from '../../../../shared/time-contract.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useStore } from '../../store.tsx';
import { myDay } from './store.ts';
import { lostWords } from './words.ts';

/**
 * Where the day stands with Toolbox (plan 2026-11-28-time-my-day, decision 12). Not connected: a card with what to do
 * next. Connected: one quiet line with Disconnect. The day is always shown beside it.
 */
export function ConnectPanel({ status, connectUrl }: { status: TimeStatus; connectUrl: string | null }) {
  const { openSettings } = useStore();
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);
  const c = status.connection;

  const connect = async () => {
    setWorking(true);
    await myDay.connect();
    setWorking(false);
  };

  if (c.state === 'connected') {
    return (
      <div className="myday-connected">
        <p className="myday-note">Connected to {c.origin}</p>
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
            onCancel={() => setAsking(false)}
          />
        ) : (
          <button
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

  return (
    <section className="card myday-connect" aria-labelledby="myday-connect-h">
      <div className="card-head">
        <h3 id="myday-connect-h">Connect to Toolbox</h3>
      </div>
      {c.state === 'no-address' ? (
        <>
          <p className="myday-note">
            Cortex does not know where Toolbox is yet. An owner or scout sets its address in Settings.
          </p>
          <div>
            <button type="button" className="btn" onClick={() => openSettings('general', 'toolbox-address')}>
              Open Settings
            </button>
          </div>
        </>
      ) : null}
      {c.state === 'not-connected' && c.pending ? (
        <>
          <p className="myday-note" role="status">
            Waiting for you to press Allow in Toolbox.
          </p>
          {connectUrl ? (
            <p className="myday-note">
              Nothing opened?{' '}
              <a href={connectUrl} target="_blank" rel="noreferrer">
                Open Toolbox yourself
              </a>
              .
            </p>
          ) : null}
        </>
      ) : null}
      {c.state === 'not-connected' && !c.pending ? (
        <>
          <p className="myday-note">
            Connect once to send your confirmed days to {c.origin}. Your day is shown here either way.
          </p>
          <div>
            <button
              type="button"
              className="btn"
              aria-disabled={working || undefined}
              onClick={() => void connect()}
            >
              Connect to Toolbox
            </button>
          </div>
        </>
      ) : null}
      {c.state === 'lost' ? (
        <>
          <p className="myday-note" role="status">
            {lostWords(c.reason)} Reconnect to send your days.
          </p>
          <div>
            <button
              type="button"
              className="btn"
              aria-disabled={working || undefined}
              onClick={() => void connect()}
            >
              Reconnect
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
