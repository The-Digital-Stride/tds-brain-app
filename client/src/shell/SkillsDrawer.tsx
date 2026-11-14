import { useId, useMemo, useRef, useState } from 'react';
import type { SkillInfo } from '../../../shared/contract.ts';
import { isLevelTier, LEVEL_TIERS } from '../../../shared/levels-contract.ts';
import { useStore } from '../store.tsx';
import { Fold } from './Fold.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';
import { NO_FAVOURITES, StarButton, useStarFocus } from './StarButton.tsx';
import { starterSkills } from './words.ts';

function SkillRow({
  skill,
  favourite,
  onStar,
}: {
  skill: SkillInfo;
  favourite: boolean;
  onStar: (id: string, button: HTMLElement) => void;
}) {
  const { startSkill, skillLevels } = useStore();
  const teamTier = skillLevels?.levels[skill.name]?.tier;
  const chip = skill.ownLevel ? 'Set by skill' : isLevelTier(teamTier) ? LEVEL_TIERS[teamTier].label : null;
  const { dispatch, modes } = useShell();
  // The description is long (it tells Claude when to use the skill), so a row shows one line of it.
  const [open, setOpen] = useState(false);
  const about = useId();
  return (
    <li className="line skill-row" data-open={open}>
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
            {chip ? (
              <>
                {' '}
                <span className="badge skill-level-chip" data-kind={skill.ownLevel ? 'own' : 'team'}>
                  {chip}
                </span>
              </>
            ) : null}
          </span>
          {skill.description ? (
            <span className="line-meta" id={about}>
              {skill.description}
            </span>
          ) : null}
        </span>
      </button>
      {/* The star, as chats and to-dos have (Ian, 2026-11-14), comes first so the chevron always sits at the row's
          right edge. A favourite is still kept in the prefs' `pins` list, so older versions of the app agree. */}
      <StarButton id={skill.name} title={skill.title} on={favourite} onPress={onStar} />
      {skill.description ? (
        <button
          type="button"
          className="icon-btn skill-more"
          data-chevron
          aria-expanded={open}
          aria-controls={about}
          aria-label={`Description of ${skill.title}`}
          data-tip={open ? 'Hide description' : 'Show description'}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron" size={14} />
        </button>
      ) : null}
    </li>
  );
}

export function SkillsDrawer() {
  const { boot, togglePin } = useStore();
  const [query, setQuery] = useState('');
  const skills = boot?.skills;
  const favs = boot?.prefs.pins ?? NO_FAVOURITES;
  const body = useRef<HTMLDivElement>(null);
  const starFocus = useStarFocus(body, favs);
  // Which sections are open: the person's own choice, else Favourites, and Used often when nothing is starred.
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const onStar = (name: string, button: HTMLElement) => {
    starFocus(name, button);
    // Open the section the skill moves to, so focus can follow it there, as chats and to-dos do.
    const to = !favs.includes(name)
      ? 'favourites'
      : (boot?.usedOften ?? []).some((u) => u.name === name)
        ? 'often'
        : 'all';
    setOpenFolds((o) => ({ ...o, [to]: true }));
    void togglePin(name);
  };
  const fold = (key: string, fallback: boolean) => ({
    open: openFolds[key] ?? fallback,
    onToggle: (o: boolean) => setOpenFolds((f) => ({ ...f, [key]: o })),
  });

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
        <SkillRow key={s.name} skill={s} favourite={favs.includes(s.name)} onStar={onStar} />
      ))}
    </ul>
  );

  // The search sits on the drawer itself, above the list: only the list scrolls.
  return (
    <div className="drawer-split">
      <div className="drawer-tools">
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
      <div className="drawer-scroll">
        <div className="drawer-body" ref={body} tabIndex={-1}>
          {shown ? (
            shown.length === 0 ? (
              <p className="dock-empty">No skills match that search.</p>
            ) : (
              list(shown)
            )
          ) : (
            <>
              {pinned.length > 0 ? (
                <Fold title="Favourites" count={pinned.length} {...fold('favourites', true)}>
                  {list(pinned)}
                </Fold>
              ) : null}
              {often.length > 0 ? (
                <Fold title="Used often" count={often.length} {...fold('often', pinned.length === 0)}>
                  {list(often)}
                </Fold>
              ) : null}
              <Fold title="All skills" count={all.length} {...fold('all', false)}>
                {list(all)}
              </Fold>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
