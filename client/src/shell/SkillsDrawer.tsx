import { useMemo, useState } from 'react';
import type { SkillInfo } from '../../../shared/contract.ts';
import { useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { starterSkills } from './words.ts';

function SkillRow({ skill, pinned }: { skill: SkillInfo; pinned: boolean }) {
  const { startSkill, togglePin } = useStore();
  const { dispatch, modes } = useShell();
  return (
    <li className="line">
      <button
        type="button"
        className="line-main"
        onClick={() => {
          startSkill(skill);
          if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
        }}
      >
        <span className="line-text">
          <span className="line-title">
            {skill.title}
            {skill.maturity === 'draft' ? (
              <>
                {' '}
                <span className="badge" data-tone="draft">
                  Still being tested
                </span>
              </>
            ) : null}
          </span>
          {skill.description ? <span className="line-meta">{skill.description}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={pinned}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} ${skill.title}`}
        onClick={() => void togglePin(skill.name)}
      >
        <Icon name="pin" size={16} />
      </button>
    </li>
  );
}

export function SkillsDrawer() {
  const { boot } = useStore();
  const [query, setQuery] = useState('');
  const skills = boot?.skills;
  const pins = boot?.prefs.pins ?? [];

  const all = useMemo(
    () => [...(skills ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'en-GB')),
    [skills],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return all.filter((s) => `${s.title} ${s.name} ${s.description}`.toLowerCase().includes(q));
  }, [all, query]);

  if (!boot) return <p className="dock-empty">Loading your skills.</p>;
  const { pinned, often } = starterSkills(boot);
  const list = (items: SkillInfo[]) => (
    <ul className="drawer-list">
      {items.map((s) => (
        <SkillRow key={s.name} skill={s} pinned={pins.includes(s.name)} />
      ))}
    </ul>
  );

  return (
    <div className="drawer-body">
      <div className="drawer-search">
        <Icon name="search" size={16} />
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
      {shown ? (
        shown.length === 0 ? (
          <p className="dock-empty">No skills match that search.</p>
        ) : (
          list(shown)
        )
      ) : (
        <>
          {pinned.length > 0 ? (
            <Fold title="Pinned" count={pinned.length}>
              {list(pinned)}
            </Fold>
          ) : null}
          {often.length > 0 ? (
            <Fold title="Used often" count={often.length}>
              {list(often)}
            </Fold>
          ) : null}
          <Fold title="All skills" count={all.length} defaultOpen={false}>
            {list(all)}
          </Fold>
        </>
      )}
    </div>
  );
}
