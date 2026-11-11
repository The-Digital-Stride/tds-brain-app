import { useMemo, useState } from 'react';
import { useStore } from '../store.tsx';

export function SkillsView() {
  const { boot, newChat, togglePin } = useStore();
  const [query, setQuery] = useState('');
  const skills = boot?.skills ?? [];
  const pins = boot?.prefs.pins ?? [];

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) => `${s.title} ${s.name} ${s.description}`.toLowerCase().includes(q));
  }, [skills, query]);

  return (
    <div className="page">
      <div>
        <h1>Skills</h1>
        <p className="lede">Pick one to start a chat with it ready to go. Pin the ones you use most.</p>
      </div>
      <div>
        <label className="visually-hidden" htmlFor="skill-search">
          Search skills
        </label>
        <input
          id="skill-search"
          type="search"
          className="field"
          placeholder="Search skills"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {shown.length === 0 ? (
        <p className="lede">No skills match that search.</p>
      ) : (
        <ul className="list">
          {shown.map((s) => {
            const pinned = pins.includes(s.name);
            return (
              <li className="skill-row" key={s.name}>
                <button
                  type="button"
                  className="skill-main"
                  onClick={() => newChat({ draft: `/${s.name} `, skill: s })}
                >
                  <div className="skill-title">
                    {s.title}{' '}
                    {s.maturity === 'draft' ? (
                      <span className="badge" data-tone="draft">
                        draft
                      </span>
                    ) : null}
                  </div>
                  {s.description ? <div className="skill-desc">{s.description}</div> : null}
                </button>
                <button
                  type="button"
                  className="btn pin-btn"
                  data-size="small"
                  aria-pressed={pinned}
                  aria-label={`${pinned ? 'Unpin' : 'Pin'} ${s.title}`}
                  onClick={() => void togglePin(s.name)}
                >
                  {pinned ? 'Pinned' : 'Pin'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
