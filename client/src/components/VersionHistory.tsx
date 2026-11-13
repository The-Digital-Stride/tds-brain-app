import { useEffect, useState } from 'react';
import type { VersionNotes } from '../../../shared/contract.ts';
import { api } from '../api.ts';
import { Fold } from '../shell/Fold.tsx';

/** The commit types the version hook records, in plain words. Anything else shows no label. */
const KIND_WORDS: Record<string, string> = {
  feat: 'New',
  fix: 'Fixed',
  perf: 'Faster',
  refactor: 'Improved',
};

/** "13 November 2026" from YYYY-MM-DD, read as a calendar date (no time zone shift). */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y as number, (m as number) - 1, d as number)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A capital first letter, unless the first word is a name such as "tdsapp-todo" or "v0.3". */
function sentence(text: string): string {
  return /^[a-z]+(?![\w.-])/.test(text) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** How many versions show before "Show older versions". */
export const VERSIONS_SHOWN = 5;

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'loaded'; versions: VersionNotes[] };

/** Settings → "What's changed": every version of the app, newest first, each folding open and closed. */
export function VersionHistory({ current }: { current: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    api.changelog().then(
      (r) => live && setState({ kind: 'loaded', versions: r.versions }),
      () => live && setState({ kind: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === 'loading') return <p className="setting-help">Loading the version history.</p>;
  if (state.kind === 'failed') return <p className="setting-help">The version history couldn't be loaded.</p>;
  if (state.versions.length === 0) return <p className="setting-help">No versions recorded yet.</p>;
  const shown = all ? state.versions : state.versions.slice(0, VERSIONS_SHOWN);
  const hidden = state.versions.length - shown.length;
  return (
    <>
      <ol className="version-list">
        {shown.map((v, i) => (
          <li key={v.version}>
            {/* The drawers' own fold, so the chevron and open/close match the to-do list. */}
            <Fold
              title={`Version ${v.version}${v.date ? `, ${longDate(v.date)}` : ''}${v.version === current ? ' (this version)' : ''}`}
              defaultOpen={i === 0}
            >
              <ul className="version-changes">
                {v.changes.map((c, j) => (
                  // Changes have no id; the list never reorders.
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed order from the file
                  <li key={j}>
                    {KIND_WORDS[c.kind.toLowerCase()] ? (
                      <span className="version-kind">{KIND_WORDS[c.kind.toLowerCase()]}: </span>
                    ) : null}
                    {sentence(c.text)}
                  </li>
                ))}
              </ul>
            </Fold>
          </li>
        ))}
      </ol>
      {hidden > 0 ? (
        <button type="button" className="link-btn version-more" onClick={() => setAll(true)}>
          Show older versions ({hidden})
        </button>
      ) : null}
    </>
  );
}
