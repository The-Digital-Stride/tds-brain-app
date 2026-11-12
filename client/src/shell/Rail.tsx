import type { ReactNode } from 'react';
import type { Attention } from '../../../shared/contract.ts';
import { mostUrgent } from '../state/chats.ts';
import { RAIL_NAMES_FROM } from '../state/shell.ts';
import { useStore } from '../store.tsx';
import { APPS } from './apps.ts';
import type { DrawerName, IconName } from './contract.ts';
import { DOCK_IDS } from './Dock.tsx';
import { Icon } from './Icon.tsx';
import { useDesk, useShell } from './ShellProvider.tsx';
import { SyncStamp } from './SyncStamp.tsx';
import { chatsRailLabel, initials, ROLE_WORDS } from './words.ts';

/** The labels the left dock shows for each drawer. App.tsx passes the same text to `Dock`. */
export const DRAWER_LABELS: Record<DrawerName, string> = {
  chats: 'Chats',
  todos: 'To-dos',
  skills: 'Skills',
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
  drawer?: { name: DrawerName; open: boolean };
  pip?: Attention | null;
  count?: number;
  after?: ReactNode;
  keys?: string;
}

function Item({ icon, label, name, wide, onClick, current, drawer, pip, count, after, keys }: ItemProps) {
  return (
    <button
      type="button"
      className="rail-item"
      aria-label={wide ? name : (name ?? label)}
      data-tip={wide ? undefined : label}
      aria-current={current ? 'page' : undefined}
      aria-expanded={drawer ? drawer.open : undefined}
      aria-controls={drawer ? DOCK_IDS.left : undefined}
      data-dock-label={drawer ? DRAWER_LABELS[drawer.name] : undefined}
      data-open={drawer?.open || undefined}
      aria-keyshortcuts={keys}
      onClick={(e) => {
        // Safari doesn't focus a clicked button; the drawer returns focus to its opener on close.
        if (drawer) e.currentTarget.focus();
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
  const { boot, todos, sessions, view, activeChat, newChat, openView } = useStore();
  const { state, dispatch } = useShell();
  const { railShowsNames: wide, width } = useDesk();
  if (!boot) return null;

  const live = sessions?.live ?? [];
  const mine = todos?.mine.length ?? 0;
  const app = APPS.find((a) => view === `app:${a.id}`);
  const onHome = (view === 'chat' && activeChat.kind === 'new') || (view.startsWith('app:') && !app);
  const drawer = (name: DrawerName) => ({ name, open: state.drawer === name });
  const toggle = (name: DrawerName) => dispatch({ type: 'toggle-drawer', drawer: name });
  const { name, role } = boot.identity;
  // Only advertise the single keys while they are switched on.
  const shortcut = (key: string) => (state.singleKeys ? key : undefined);

  return (
    <nav className="rail glass" aria-label="Main" data-wide={wide} inert={inert}>
      <div className="rail-brand">
        <Mark />
        <span className="rail-label">TDS Brain</span>
      </div>

      <Item icon="home" label="Home" wide={wide} current={onHome} onClick={() => newChat()} />
      <Item
        icon="chat"
        label="Chats"
        name={chatsRailLabel(live)}
        wide={wide}
        drawer={drawer('chats')}
        pip={mostUrgent(live)}
        count={live.length}
        keys={shortcut('c')}
        onClick={() => toggle('chats')}
      />
      <Item
        icon="todos"
        label="To-dos"
        name={mine > 0 ? `To-dos, ${mine} of yours` : undefined}
        wide={wide}
        drawer={drawer('todos')}
        count={mine}
        keys={shortcut('t')}
        onClick={() => toggle('todos')}
      />
      <Item
        icon="skills"
        label="Skills"
        wide={wide}
        drawer={drawer('skills')}
        keys={shortcut('s')}
        onClick={() => toggle('skills')}
      />

      {APPS.length > 0 ? (
        <div className="rail-group">
          <span className="rail-group-name rail-label">Apps</span>
          {APPS.map((a) => (
            <Item
              key={a.id}
              icon={a.icon}
              label={a.title}
              wide={wide}
              current={app?.id === a.id}
              onClick={() => openView(`app:${a.id}`)}
            />
          ))}
        </div>
      ) : null}

      <span className="rail-spacer" />

      {width >= RAIL_NAMES_FROM ? (
        <Item
          icon="rail"
          label={wide ? 'Icons only' : 'Show names'}
          name={wide ? 'Icons only' : 'Show names'}
          wide={wide}
          keys={shortcut('[')}
          onClick={() => dispatch({ type: 'toggle-rail' })}
          after={wide && state.singleKeys ? <kbd className="rail-label">[</kbd> : null}
        />
      ) : null}
      <Item
        icon="settings"
        label="Settings"
        wide={wide}
        current={view === 'settings'}
        onClick={() => openView('settings')}
      />
      {/* Opens the Profile page. One spoken name in both widths; the visible name leads it. */}
      <button
        type="button"
        className="rail-person"
        aria-label={`${name}, ${ROLE_WORDS[role]}: your profile`}
        data-tip={wide ? undefined : `${name}, ${ROLE_WORDS[role]}: your profile`}
        aria-current={view === 'profile' ? 'page' : undefined}
        onClick={() => openView('profile')}
      >
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        {wide ? (
          <span className="rail-label rail-who">
            <span>{name}</span>
            <small>{ROLE_WORDS[role]}</small>
          </span>
        ) : null}
      </button>
      <SyncStamp wide={wide} />
    </nav>
  );
}
