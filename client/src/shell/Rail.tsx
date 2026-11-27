import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Attention } from '../../../shared/contract.ts';
import { helpVisible, skillsMenuVisible } from '../help/visibility.ts';
import { mostUrgent } from '../state/chats.ts';
import { RAIL_NAMES_FROM } from '../state/shell.ts';
import { changedTodos } from '../state/todo-changed.ts';
import { newToYou } from '../state/todo-new.ts';
import { useStore, useToolSnapshot } from '../store.tsx';
import { useTourOpen } from '../tour/request.ts';
import { APPS } from './apps.ts';
import type { DrawerName, IconName } from './contract.ts';
import { DOCK_IDS } from './Dock.tsx';
import { Icon } from './Icon.tsx';
import { RailUpdate } from './RailUpdate.tsx';
import { createRailHover, type RailHover } from './rail-hover.ts';
import { useDesk, useShell } from './ShellProvider.tsx';
import { SyncStamp } from './SyncStamp.tsx';
import { sectionBadge, toolFor, visibleSections } from './sections.ts';
import { chatsRailLabel, initials, ROLE_WORDS, todosRailLabel } from './words.ts';

/** Apps shown in the top group, straight under Home, rather than in the Apps group. */
const TOP_APPS = new Set(['projects']);

/** The labels the left dock shows for each drawer. App.tsx passes the same text to `Dock`. */
export const DRAWER_LABELS: Record<DrawerName, string> = {
  chats: 'Chats',
  todos: 'Tasks',
  skills: 'Skills',
  help: 'Help',
  // The dock shows the section's own title (see App.tsx); this is only the fallback.
  section: 'Workbench',
};

interface ItemProps {
  icon: IconName;
  label: string;
  /** A fuller accessible name than the visible label (counts, status). */
  name?: string;
  wide: boolean;
  onClick: () => void;
  current?: boolean;
  /** For drawer buttons: whether its drawer is open. */
  drawer?: { name: DrawerName; open: boolean; label?: string };
  pip?: Attention | null;
  /** Something new to the person: a plain blue dot, whatever the chats are doing. */
  fresh?: boolean;
  count?: number;
  after?: ReactNode;
  keys?: string;
  /** For app buttons: the app's id, so the tour can point at it in both widths. */
  app?: string;
  choose: () => void;
}

function Item({
  icon,
  label,
  name,
  wide,
  onClick,
  current,
  drawer,
  pip,
  fresh,
  count,
  after,
  keys,
  app,
  choose,
}: ItemProps) {
  return (
    <button
      type="button"
      className="rail-item"
      aria-label={wide ? name : (name ?? label)}
      data-tip={wide ? undefined : label}
      aria-current={current ? 'page' : undefined}
      aria-expanded={drawer ? drawer.open : undefined}
      aria-controls={drawer ? DOCK_IDS.left : undefined}
      data-dock-label={drawer ? (drawer.label ?? DRAWER_LABELS[drawer.name]) : undefined}
      data-open={drawer?.open || undefined}
      data-app={app}
      aria-keyshortcuts={keys}
      onClick={(e) => {
        // Safari doesn't focus a clicked button; the drawer returns focus to its opener on close.
        if (drawer) e.currentTarget.focus();
        // Choosing an item puts the names away (and so does opening a drawer from it).
        choose();
        onClick();
      }}
    >
      <Icon name={icon} />
      {/* Icons only: the count rides on the icon. The aria-label already says the number. */}
      {count && !wide ? (
        <span className="rail-badge" aria-hidden="true">
          {count}
        </span>
      ) : null}
      {pip ? <span className="dot rail-pip" data-attention={pip} /> : null}
      {fresh ? <span className="dot rail-pip" data-new="true" /> : null}
      <span className="rail-label">{label}</span>
      {count ? <span className="count rail-label">{count}</span> : null}
      {after}
    </button>
  );
}

/** The mark: the app icon itself (blue line brain on a navy tile), so the rail and the Dock match. */
function Mark() {
  return <img className="rail-mark" src="/icons/brain.svg" alt="" width={32} height={32} />;
}

/** Layer 1: one slim strip that gets you everywhere. */
export function Rail({ inert = false }: { inert?: boolean }) {
  const { boot, todos, asked, askedState, sessions, view, activeChat, newChat, openView } = useStore();
  const snap = useToolSnapshot();
  const { state, dispatch } = useShell();
  const { railShowsNames: wide, width, drawerModal, panelModal } = useDesk();
  const touring = useTourOpen();

  // Hover or Tab expands an icons-only rail over the page, never the saved setting (rail-hover.ts). Not while
  // the names are pinned or anything modal is open.
  const [hoverOpen, setHoverOpen] = useState(false);
  const blocked =
    inert ||
    drawerModal ||
    panelModal ||
    touring ||
    Boolean(state.paletteOpen || state.viewer || state.todoPanel);
  const can = useRef(false);
  can.current = !wide && !blocked;
  const hover = useRef<RailHover | null>(null);
  // Whether the last input was Tab: only then does focus in the rail open it (a click or a closing drawer's
  // focus handback does not).
  const tabbed = useRef(false);
  useEffect(() => {
    const control = createRailHover({ onChange: setHoverOpen });
    hover.current = control;
    const onKey = (e: KeyboardEvent) => {
      tabbed.current = e.key === 'Tab';
      // Pointer-opened: Escape closes it and stops there. Focus-opened: it closes, and Escape goes on to close
      // a drawer, as the tooltip layer does.
      if (e.key === 'Escape' && control.isExpanded()) {
        if (control.openedBy() === 'pointer') e.preventDefault();
        control.escape();
      }
    };
    const onPointer = () => {
      tabbed.current = false;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      control.dispose();
      hover.current = null;
    };
  }, []);
  // Names pinned, or something modal opened: close it at once. Not a dismissal: the pointer may never have been here.
  useEffect(() => {
    if (wide || blocked) hover.current?.collapse();
  }, [wide, blocked]);
  const expanded = hoverOpen && can.current;
  const showsNames = wide || expanded;
  if (!boot) return null;

  const live = sessions?.live ?? [];
  const mine = todos?.mine.length ?? 0;
  // "New to you" plus the tasks with a change since the person looked. While the Asked list is loading, or
  // failed, only the tasks they hold are counted.
  const now = new Date();
  const fresh = todos
    ? newToYou(todos.mine, boot.identity.slug, boot.prefs.todoSeen ?? {}, now).length +
      changedTodos(todos, askedState === 'loaded' ? asked : null, boot.identity, boot.prefs, now).total
    : 0;
  const sections = visibleSections(snap);
  const app = APPS.find((a) => view === `app:${a.id}`);
  const topApps = APPS.filter((a) => TOP_APPS.has(a.id));
  const groupApps = APPS.filter((a) => !TOP_APPS.has(a.id));
  const onHome = (view === 'chat' && activeChat.kind === 'new') || (view.startsWith('app:') && !app);
  const drawer = (name: DrawerName) => ({ name, open: state.drawer === name });
  const choose = () => hover.current?.choose();
  const toggle = (name: DrawerName) => dispatch({ type: 'toggle-drawer', drawer: name });
  const { name, role } = boot.identity;
  // Only advertise the single keys while they are switched on.
  const shortcut = (key: string) => (state.singleKeys ? key : undefined);
  const toggleName = wide ? 'Icons only' : expanded ? 'Keep names showing' : 'Show names';

  return (
    <div
      className="railslot"
      onPointerEnter={(e) => {
        if (can.current) hover.current?.pointerEnter(e.pointerType);
      }}
      onPointerLeave={() => hover.current?.pointerLeave()}
    >
      <nav
        className="rail glass"
        aria-label="Main"
        data-wide={showsNames}
        data-expanded={expanded || undefined}
        inert={inert}
        onFocus={() => {
          if (can.current && tabbed.current) hover.current?.focusIn();
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover.current?.focusOut();
        }}
      >
        <div className="rail-brand">
          <Mark />
          <span className="rail-label">TDS Cortex</span>
          {/* The show/hide names toggle: an icon only, at the top right like every dock's close
            button. Icons only, it sits over the mark and shows on hover or keyboard focus. One
            element in both widths, so focus stays on it when it is pressed. */}
          {width >= RAIL_NAMES_FROM ? (
            <button
              type="button"
              className="icon-btn rail-toggle"
              aria-label={toggleName}
              data-tip={state.singleKeys ? `${toggleName} ([)` : toggleName}
              aria-keyshortcuts={shortcut('[')}
              onClick={() => dispatch({ type: 'toggle-rail' })}
            >
              <Icon name="rail" />
            </button>
          ) : null}
        </div>

        <Item
          choose={choose}
          icon="home"
          label="Home"
          wide={showsNames}
          current={onHome}
          onClick={() => newChat()}
        />
        {/* Projects sits straight under Home (Ian 2026-11-24): keeping work organised is what Cortex is for.
          The other apps stay in the Apps group below. */}
        {topApps.map((a) => (
          <Item
            choose={choose}
            key={a.id}
            app={a.id}
            icon={a.icon}
            label={a.title}
            wide={showsNames}
            current={app?.id === a.id}
            onClick={() => openView(`app:${a.id}`)}
          />
        ))}
        <Item
          choose={choose}
          icon="chat"
          label="Chats"
          name={chatsRailLabel(live)}
          wide={showsNames}
          drawer={drawer('chats')}
          pip={mostUrgent(live)}
          count={live.length}
          keys={shortcut('c')}
          onClick={() => toggle('chats')}
        />
        <Item
          choose={choose}
          icon="todos"
          label="Tasks"
          name={todosRailLabel(mine, fresh)}
          fresh={fresh > 0}
          wide={showsNames}
          drawer={drawer('todos')}
          count={mine}
          keys={shortcut('t')}
          onClick={() => toggle('todos')}
        />

        {sections.map((sec) => {
          const n = sectionBadge(sec, snap);
          return (
            <Item
              choose={choose}
              key={sec.id}
              icon={sec.icon}
              label={sec.title}
              name={n > 0 ? sec.railName?.(n) : undefined}
              wide={showsNames}
              drawer={{
                name: 'section',
                open: state.drawer === 'section' && state.section === sec.id,
                label: sec.title,
              }}
              count={n}
              current={toolFor(view)?.section.id === sec.id}
              keys={sec.key ? shortcut(sec.key) : undefined}
              onClick={() => dispatch({ type: 'toggle-section', section: sec.id })}
            />
          );
        })}

        {groupApps.length > 0 ? (
          <div className="rail-group">
            <span className="rail-group-name rail-label">Apps</span>
            {groupApps.map((a) => (
              <Item
                choose={choose}
                key={a.id}
                app={a.id}
                icon={a.icon}
                label={a.title}
                wide={showsNames}
                current={app?.id === a.id}
                onClick={() => openView(`app:${a.id}`)}
              />
            ))}
          </div>
        ) : null}

        <span className="rail-spacer" />

        {/* Owners and scouts only (`skillsMenuVisible`); kept at the foot, above Help. */}
        {skillsMenuVisible(role) ? (
          <Item
            choose={choose}
            icon="skills"
            label="Skills"
            wide={showsNames}
            drawer={drawer('skills')}
            keys={shortcut('s')}
            onClick={() => toggle('skills')}
          />
        ) : null}
        {helpVisible(role) ? (
          <Item
            choose={choose}
            icon="help"
            label="Help"
            wide={showsNames}
            drawer={drawer('help')}
            keys={shortcut('h')}
            onClick={() => toggle('help')}
          />
        ) : null}
        <Item
          choose={choose}
          icon="settings"
          label="Settings"
          wide={showsNames}
          current={view === 'settings'}
          onClick={() => openView('settings')}
        />
        {/* Opens the Profile page. One spoken name in both widths; the visible name leads it. */}
        <button
          type="button"
          className="rail-person"
          aria-label={`${name}, ${ROLE_WORDS[role]}: your profile`}
          data-tip={showsNames ? undefined : `${name}, ${ROLE_WORDS[role]}: your profile`}
          aria-current={view === 'profile' ? 'page' : undefined}
          onClick={() => {
            choose();
            openView('profile');
          }}
        >
          <span className="avatar" aria-hidden="true">
            {initials(name)}
          </span>
          {showsNames ? (
            <span className="rail-label rail-who">
              <span>{name}</span>
              <small>{ROLE_WORDS[role]}</small>
            </span>
          ) : null}
        </button>
        <RailUpdate wide={showsNames} pinned={wide} />
        <SyncStamp wide={showsNames} />
      </nav>
    </div>
  );
}
