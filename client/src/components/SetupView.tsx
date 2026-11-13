import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  type AppState,
  BRAIN_REFUSAL_TEXT,
  type BrainRefusal,
  type SetupCandidatesResponse,
} from '../../../shared/install-contract.ts';
import { api } from '../api.ts';

/** How often the page asks the server whether it is back, and when it gives up. */
export const POLL_MS = 1000;
export const GIVE_UP_MS = 60_000;

type Phase = 'idle' | 'saving' | 'restarting' | 'saved-manual' | 'timed-out';

export interface SetupViewProps {
  /** What boot said. `ready` means the page was opened from Settings or the brain problem screen. */
  appState: AppState;
  /** Only given when the page was opened from somewhere to go back to. */
  onCancel?: () => void;
  /** True when the server restarts itself after a save (boot.service.underService). */
  underService: boolean;
  /** Overridable for tests. */
  reload?: () => void;
}

function restartWarning(fromSettings: boolean, openChats: number): string {
  if (fromSettings && openChats === 1) {
    return "TDS Brain will restart and close your open chat. Finish anything you're in the middle of first.";
  }
  if (fromSettings && openChats > 1) {
    return `TDS Brain will restart and close your ${openChats} open chats. Finish anything you're in the middle of first.`;
  }
  return 'TDS Brain will restart to use this folder. This takes a few seconds.';
}

export function SetupView({
  appState,
  underService,
  onCancel,
  reload = () => location.reload(),
}: SetupViewProps) {
  const fromSettings = appState.kind === 'ready';
  const tried = appState.kind === 'setup' ? appState.tried : null;
  const triedReason = appState.kind === 'setup' ? appState.reason : null;
  const envSource = appState.kind === 'setup' && appState.source === 'env';

  const [info, setInfo] = useState<SetupCandidatesResponse | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [path, setPath] = useState(tried ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [looking, setLooking] = useState(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const ids = { hint: useId(), error: useId() };

  useEffect(() => {
    heading.current?.focus();
  }, []);

  const lookupId = useRef(0);
  const lookup = useCallback(() => {
    const mine = ++lookupId.current;
    const current = () => lookupId.current === mine;
    setLooking(true);
    setLoadFailed(false);
    api
      .getSetupCandidates()
      .then((r) => current() && setInfo(r))
      .catch(() => current() && setLoadFailed(true))
      .finally(() => current() && setLooking(false));
  }, []);
  useEffect(() => {
    lookup();
    return () => {
      lookupId.current += 1;
    };
  }, [lookup]);

  // A refusal is linked to the field; send the person there to fix it.
  useEffect(() => {
    if (refusal) field.current?.focus();
  }, [refusal]);

  // After a save the old server keeps answering (it is closing chats), so only the new path counts.
  // Once the server has been seen down, any answer is the new server's: it decides its brain once at
  // start-up, so if it came back in setup it stays there, and reloading shows why at once.
  useEffect(() => {
    if (phase !== 'restarting' || savedPath === null) return;
    let stopped = false;
    let sawDown = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const tick = async () => {
      try {
        const b = await api.bootstrap();
        if (stopped) return;
        if (sawDown || (b.appState.kind === 'ready' && b.brain.path === savedPath)) {
          reload();
          return;
        }
      } catch {
        // The server is down while it restarts; keep asking.
        sawDown = true;
      }
      if (stopped) return;
      if (Date.now() - started >= GIVE_UP_MS) {
        setPhase('timed-out');
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, savedPath, reload]);

  const envOverride = envSource || info?.envOverride === true;
  const busy = phase === 'saving' || phase === 'restarting';
  const useLabel = underService ? 'Use this folder and restart' : 'Use this folder';

  async function save(chosen: string) {
    const value = chosen.trim();
    if (!value) {
      setRefusal('Enter the path to your brain folder first.');
      return;
    }
    setPath(value);
    setRefusal(null);
    setPhase('saving');
    try {
      const res = await api.saveBrainFolder(value);
      if (!res.ok) {
        setRefusal(BRAIN_REFUSAL_TEXT[res.reason]);
        setPhase('idle');
      } else if (res.restarting) {
        setSavedPath(res.path);
        setPhase('restarting');
      } else {
        setPhase('saved-manual');
      }
    } catch (err) {
      setRefusal(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setPhase('idle');
    }
  }

  const status =
    phase === 'restarting'
      ? 'Restarting TDS Brain…'
      : phase === 'saved-manual'
        ? 'Saved. Stop TDS Brain and start it again to use this folder.'
        : phase === 'timed-out'
          ? "TDS Brain hasn't come back after a minute. Choose Check again, and if it's still not back, ask whoever looks after TDS Brain."
          : looking
            ? 'Looking for brain folders…'
            : '';

  const found = info?.candidates ?? [];
  const current = info?.current?.path ?? null;
  const choosable = found.filter((c) => c !== current);
  const soleChoice = choosable.length === 1 ? choosable[0] : null;

  return (
    <main className="gate">
      <div className="card gate-card setup">
        <h1 ref={heading} tabIndex={-1}>
          Choose your brain folder
        </h1>
        <p>
          TDS Brain needs the folder where you keep your copy of the Agency Brain. It's how it reads your
          skills, to-dos and client notes.
        </p>
        {tried ? (
          <p className="lede">
            {triedReason
              ? `TDS Brain looked in ${tried}. ${BRAIN_REFUSAL_TEXT[triedReason satisfies BrainRefusal]}`
              : `TDS Brain looked in ${tried}, but there's no brain there yet.`}
          </p>
        ) : null}

        {/* Always mounted, so a screen reader hears each change. */}
        <p className="setup-status" role="status">
          {status}
        </p>

        {phase === 'restarting' || phase === 'saved-manual' ? null : phase === 'timed-out' ? (
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPhase('restarting');
              }}
            >
              Check again
            </button>
          </div>
        ) : envOverride ? (
          <p>{BRAIN_REFUSAL_TEXT['env-override']}</p>
        ) : (
          <>
            <section aria-labelledby="setup-found-h" className="setup-section">
              <h2 id="setup-found-h">Found on this Mac</h2>
              {looking ? null : loadFailed || (found.length === 0 && current === null) ? (
                <>
                  <p className="lede">
                    {loadFailed
                      ? "TDS Brain couldn't look for brain folders. Choose Check again, or paste the path below."
                      : "You'll need the Agency Brain on this Mac first. If it isn't there yet, ask whoever looks after TDS Brain to help you set it up. Once it's there, choose Check again, or paste its path below."}
                  </p>
                  <div>
                    <button type="button" className="btn" onClick={() => lookup()}>
                      Check again
                    </button>
                  </div>
                </>
              ) : (
                <ul className="setup-list">
                  {found.map((c) => (
                    <li key={c} className="setup-candidate">
                      <code className="about-code setup-path">{c}</code>
                      {c === current ? (
                        <span className="setup-current">In use now</span>
                      ) : (
                        <button
                          type="button"
                          className="btn"
                          data-variant={c === soleChoice ? 'primary' : undefined}
                          aria-label={`${useLabel}: ${c}`}
                          disabled={busy}
                          onClick={() => save(c)}
                        >
                          {useLabel}
                        </button>
                      )}
                    </li>
                  ))}
                  {current !== null && !found.includes(current) ? (
                    <li className="setup-candidate">
                      <code className="about-code setup-path">{current}</code>
                      <span className="setup-current">In use now</span>
                    </li>
                  ) : null}
                </ul>
              )}
            </section>

            {underService && info ? (
              <p className="setup-warning">{restartWarning(fromSettings, info.openChats)}</p>
            ) : null}

            <form
              className="setup-form"
              aria-labelledby="setup-paste-h"
              onSubmit={(e) => {
                e.preventDefault();
                void save(path);
              }}
            >
              <h2 id="setup-paste-h">Or paste the folder's path</h2>
              <label htmlFor="setup-path">Folder path</label>
              <input
                id="setup-path"
                ref={field}
                className="field"
                type="text"
                value={path}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                aria-invalid={refusal ? true : undefined}
                aria-describedby={refusal ? `${ids.hint} ${ids.error}` : ids.hint}
                onChange={(e) => setPath(e.target.value)}
              />
              <p id={ids.hint} className="lede">
                In Finder, select the folder and press Option-Command-C to copy its path.
              </p>
              {refusal ? (
                <p id={ids.error} className="setup-error">
                  {refusal}
                </p>
              ) : null}
              <div className="setup-actions">
                <button
                  type="submit"
                  className="btn"
                  data-variant={soleChoice ? undefined : 'primary'}
                  disabled={busy}
                >
                  {useLabel}
                </button>
                {onCancel ? (
                  <button type="button" className="btn" onClick={onCancel}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </>
        )}
        {onCancel && (envOverride || phase === 'saved-manual' || phase === 'timed-out') ? (
          <div>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
