import { useEffect, useRef, useState } from 'react';
import { UPDATE_BLOCKED_TEXT, UPDATE_CHECK_FAILED_TEXT } from '../../../shared/update-contract.ts';
import { useUpdate } from '../state/update.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { phaseText, UpdateAction } from './UpdateBanner.tsx';

/** How long the answer to a check asked for here stays (the words wide, a tick icons only). */
export const CHECK_RESULT_MS = 6000;

const NEWEST = 'You have the newest version.';

/**
 * The app's version and its update button, at the foot of the rail between the person and the sync stamp.
 * It shares the one update poller (`useUpdate`) with the sheet's update line and Settings › About:
 * - an update is ready: a primary button at the end of the version line that updates and restarts. With chats
 *   open it must ask first. It asks in place only while the names are pinned: a rail slid out by hover or Tab
 *   can shut mid-question, and an icons-only rail has no room, so there it opens Settings › About, which asks;
 * - an update is running: the step in words (a dot with a tooltip, icons only), no button;
 * - otherwise: a "Check for updates" icon button. The answer to a check asked for here shows for a few seconds.
 *
 * `wide`: names showing (pinned or slid out). `pinned`: names pinned by the person's setting.
 */
export function RailUpdate({ wide, pinned }: { wide: boolean; pinned: boolean }) {
  const { boot, openSettings } = useStore();
  const update = useUpdate();
  const { status, checking } = update;
  // The answer to a check asked for here, kept for CHECK_RESULT_MS; the poller's own checks stay quiet.
  const [asked, setAsked] = useState(false);
  const [result, setResult] = useState('');
  const wasChecking = useRef(false);

  const running = phaseText(status, update.stalled, update.restarting);
  const failed = status?.phase === 'failed';
  const ready =
    status !== null && !status.blocked && !running && (status.available || status.unfinished || failed);

  useEffect(() => {
    const finished = wasChecking.current && !checking;
    wasChecking.current = checking;
    if (!finished || !asked || !status) return;
    setAsked(false);
    if (ready) return; // The update button says it.
    setResult(
      status.blocked
        ? UPDATE_BLOCKED_TEXT[status.blocked]
        : status.checkFailed
          ? UPDATE_CHECK_FAILED_TEXT
          : NEWEST,
    );
  }, [checking, asked, status, ready]);
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(''), CHECK_RESULT_MS);
    return () => clearTimeout(t);
  }, [result]);

  if (!boot) return null;
  const version = status?.current ?? boot.appVersion;
  const latest = status?.latest;
  const retry = failed || status?.unfinished;
  const target = latest ? `Update to ${latest}` : 'Update';
  const openChats = status?.openChats ?? 0;
  // With chats open and nowhere safe to ask, the button opens Settings › About: "…" says more follows.
  const viaSettings = openChats > 0 && !(wide && pinned);
  const words = retry ? 'Try the update again' : `${target} and restart`;
  const name = viaSettings ? `${words}…` : words;
  const tip = viaSettings ? `${words}: asks first in Settings` : words;
  const tick = result === NEWEST;
  const shown = ready ? '' : result;

  let action = null;
  if (ready && wide && !viaSettings) {
    action = <UpdateAction update={update} label={retry ? 'Try again' : 'Update'} name={name} tip={tip} />;
  } else if (ready && wide) {
    action = (
      <button
        type="button"
        className="btn"
        data-variant="primary"
        data-size="small"
        aria-label={name}
        data-tip={tip}
        onClick={() => openSettings('about')}
      >
        {retry ? 'Try again…' : 'Update…'}
      </button>
    );
  } else if (ready) {
    action = (
      <button
        type="button"
        className="icon-btn"
        data-size="small"
        data-variant="primary"
        aria-label={name}
        data-tip={tip}
        onClick={() => {
          if (viaSettings) openSettings('about');
          else void update.start();
        }}
      >
        <Icon name="update" size={16} />
      </button>
    );
  } else if (!running) {
    const checkLabel = checking ? 'Checking for updates…' : 'Check for updates';
    action = (
      <button
        type="button"
        className="icon-btn"
        data-size="small"
        aria-label={checkLabel}
        data-tip={tick ? 'Up to date' : checkLabel}
        aria-disabled={checking || undefined}
        onClick={() => {
          if (checking) return;
          setAsked(true);
          setResult('');
          void update.check();
        }}
      >
        <Icon name={tick ? 'check' : 'refresh'} size={16} />
      </button>
    );
  }

  return (
    <div className="rail-update" data-wide={wide}>
      <p className="rail-version">
        {wide ? (
          <>Version {version}</>
        ) : (
          <>
            <span aria-hidden="true">{version}</span>
            <span className="visually-hidden">Version {version}</span>
          </>
        )}
      </p>
      {action}
      {running ? (
        <p className="rail-update-note" data-tip={wide ? undefined : running}>
          {wide ? running : <span className="dot rail-update-dot" aria-hidden="true" />}
          {wide ? null : <span className="visually-hidden">{running}</span>}
        </p>
      ) : null}
      {/* Always mounted, so the answer to a check is announced. Shown wide; icons only, the tick says it. */}
      <p className={wide ? 'rail-update-note' : 'visually-hidden'} aria-live="polite">
        {shown}
      </p>
    </div>
  );
}
