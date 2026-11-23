import { useEffect, useState } from 'react';
import { ADS_NOTE_MAX } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { Confirm } from '../../shell/Confirm.tsx';
import { useShell } from '../../shell/ShellProvider.tsx';
import { StateNote } from '../../shell/StateNote.tsx';
import { useAd } from './store.ts';
import type { StandupBrief } from './types.ts';
import { useUnsavedWork } from './unsaved.ts';
import { actionLabel, adsErrorText } from './words.ts';

type Rating = { score: string; note: string };

/** What is rated or noted, as text, so "changed since the last save" is one comparison. `scoredOnly`: what Save sends. */
const signature = (ratings: Record<number, Rating>, scoredOnly: boolean): string =>
  JSON.stringify(
    Object.entries(ratings)
      .filter(([, x]) => (scoredOnly ? x.score : x.score || x.note.trim()))
      .map(([i, x]) => [i, x.score, x.note.trim()]),
  );

/** Rate the latest standup brief's per-campaign calls, 1 to 5 and a note (the Workbench's "Rate calls"). Shown in Ads Command Centre's side panel. */
export function RateCalls() {
  const { account } = useAd();
  const [brief, setBrief] = useState<StandupBrief | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<number, Rating>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // What the last complete save held: ratings and notes past it are unsaved work.
  const [savedSig, setSavedSig] = useState('[]');
  const { dispatch, panelHold } = useShell();
  const now = signature(ratings, false);
  useUnsavedWork(now !== '[]' && now !== savedSig, () => setRatings({}));

  useEffect(() => {
    if (!account) return;
    let current = true;
    api
      .adsStandupBrief(account)
      .then((b) => {
        if (current) setBrief((b as StandupBrief | null) ?? null);
      })
      .catch((err) => {
        if (!current) return;
        setBrief(null);
        setError(adsErrorText(err));
      });
    return () => {
      current = false;
    };
  }, [account]);

  if (brief === undefined)
    return (
      <div className="am-panel">
        <StateNote kind="loading" />
      </div>
    );
  const recs = brief?.recommendations ?? [];
  if (recs.length === 0)
    return (
      <div className="am-panel">
        {error ? (
          <p className="notice" data-level="error" data-shape="box" role="alert">
            {error}
          </p>
        ) : (
          <p className="notice" data-level="info" data-shape="box">
            No standup calls to rate yet. Run the Daily standup first.
          </p>
        )}
      </div>
    );
  const set = (i: number, patch: Partial<Rating>) =>
    setRatings((r) => ({ ...r, [i]: { score: '', note: '', ...r[i], ...patch } }));
  const save = async () => {
    if (saving || !account || !brief) return;
    const todo = recs.flatMap((r, i) => {
      const x = ratings[i];
      return x?.score ? [{ r, x }] : [];
    });
    if (todo.length === 0) {
      setResult('Nothing to save. Give at least one call a rating.');
      return;
    }
    setSaving(true);
    let ok = 0;
    for (const { r, x } of todo) {
      try {
        await api.adsChange('standup-feedback', {
          account,
          date: String(brief.ymd).replace(/\D/g, ''),
          campaign: r.campaign,
          action_category: r.action_category,
          score: Number(x.score) as 1 | 2 | 3 | 4 | 5,
          ...(x.note.trim() ? { note: x.note.trim() } : {}),
        });
        ok++;
      } catch {
        // Keep going; the count says how many saved.
      }
    }
    setSaving(false);
    if (ok === todo.length) setSavedSig(signature(ratings, true));
    setResult(`Saved ${ok} of ${todo.length} rating${todo.length === 1 ? '' : 's'}.`);
  };
  return (
    <div className="am-panel">
      <p className="am-sub">
        From the brief dated {brief?.date}. 5 means you did exactly this, 1 means you did nothing like it. The
        notes matter most.
      </p>
      {panelHold.asking ? (
        <Confirm
          label="Discard your changes"
          text="Discard your changes?"
          action="Discard changes"
          safe="Keep editing"
          variant="danger"
          busy={false}
          onConfirm={() => dispatch({ type: 'discard-panel' })}
          onCancel={() => dispatch({ type: 'keep-panel' })}
        />
      ) : null}
      <ul className="am-rate">
        {recs.map((r, i) => (
          <li key={`${r.campaign}-${r.action_category}`}>
            <p className="am-camp">
              {r.campaign} <span className="badge">{actionLabel(r.action_category)}</span>
            </p>
            {r.reason ? <p className="am-sub">{r.reason}</p> : null}
            <div className="am-actions">
              <label className="form-field am-score">
                <span className="label">Rating for {r.campaign}</span>
                <select
                  className="field"
                  value={ratings[i]?.score ?? ''}
                  onChange={(e) => set(i, { score: e.target.value })}
                >
                  <option value="">Not rated</option>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field am-grow">
                <span className="label">Note for {r.campaign} (optional)</span>
                <input
                  className="field"
                  maxLength={ADS_NOTE_MAX}
                  value={ratings[i]?.note ?? ''}
                  onChange={(e) => set(i, { note: e.target.value })}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      {/* Panel footer (design system, Actions rule 6): ratings are only kept when Save is pressed. */}
      <div className="am-foot">
        <button
          type="button"
          className="btn"
          data-variant="primary"
          data-size="small"
          aria-disabled={saving || undefined}
          onClick={() => void save()}
        >
          {saving ? 'Saving' : 'Save'}
        </button>
        {result ? <span className="am-sub">{result}</span> : null}
      </div>
      {/* One status region, always mounted, so the result is announced when it arrives. */}
      <p className="visually-hidden" role="status">
        {result ?? ''}
      </p>
    </div>
  );
}
