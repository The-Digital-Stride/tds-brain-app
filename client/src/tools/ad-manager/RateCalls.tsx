import { useEffect, useState } from 'react';
import { ADS_NOTE_MAX } from '../../../../shared/ads-contract.ts';
import { api } from '../../api.ts';
import { useAd } from './store.ts';
import type { StandupBrief } from './types.ts';
import { actionLabel, adsErrorText } from './words.ts';

type Rating = { score: string; note: string };

/** Rate the latest standup brief's per-campaign calls, 1 to 5 and a note (the Workbench's "Rate calls"). Shown in Ads Command Centre's side panel. */
export function RateCalls() {
  const { account } = useAd();
  const [brief, setBrief] = useState<StandupBrief | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<number, Rating>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

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
        <p className="card-note">Loading</p>
      </div>
    );
  const recs = brief?.recommendations ?? [];
  if (recs.length === 0)
    return (
      <div className="am-panel">
        <p className="am-line">{error ?? 'No standup calls to rate yet. Run the Daily standup first.'}</p>
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
    setResult(`Saved ${ok} of ${todo.length} rating${todo.length === 1 ? '' : 's'}.`);
  };
  return (
    <div className="am-panel">
      <p className="am-sub">
        From the brief dated {brief?.date}. 5 means you did exactly this, 1 means you did nothing like it. The
        notes matter most.
      </p>
      <ul className="am-rate">
        {recs.map((r, i) => (
          <li key={`${r.campaign}-${r.action_category}`}>
            <p className="am-camp">
              {r.campaign} <span className="badge">{actionLabel(r.action_category)}</span>
            </p>
            {r.reason ? <p className="am-sub">{r.reason}</p> : null}
            <div className="am-actions">
              <label className="am-field am-score">
                <span>Rating for {r.campaign}</span>
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
              <label className="am-field am-grow">
                <span>Note for {r.campaign} (optional)</span>
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
