import { type ComponentType, Suspense, useRef } from 'react';
import { useBlockStrayDrops } from './components/Attachments.tsx';
import { ChatView } from './components/Chat.tsx';
import { BootProblem, GateScreen, Loading } from './components/Gates.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { APPS } from './shell/apps.ts';
import { ChatsDrawer } from './shell/ChatsDrawer.tsx';
import type { DrawerName } from './shell/contract.ts';
import { Dock } from './shell/Dock.tsx';
import { Home } from './shell/Home.tsx';
import { Inspector } from './shell/Inspector.tsx';
import { Palette } from './shell/Palette.tsx';
import { DRAWER_LABELS, Rail } from './shell/Rail.tsx';
import { SheetBar } from './shell/SheetBar.tsx';
import { SheetNotices } from './shell/SheetNotices.tsx';
import { ShellProvider, useDesk, useShell } from './shell/ShellProvider.tsx';
import { SkillsDrawer } from './shell/SkillsDrawer.tsx';
import { TodosDrawer } from './shell/TodosDrawer.tsx';
import { initialChatState, pendingCard } from './state/chat-reducer.ts';
import { StoreProvider, useStore } from './store.tsx';

/** Says what changed, for screen readers. Nothing visible. */
function Announcer() {
  const { activeChat, chats } = useStore();
  const chat = activeChat.kind === 'live' ? (chats[activeChat.sessionId] ?? initialChatState) : null;
  const card = chat ? pendingCard(chat) : null;
  const state = chat?.sessionState ?? null;
  const last = chat?.items.at(-1);
  let text = '';
  if (card?.kind === 'question') text = 'Claude has a question for you';
  else if (card?.kind === 'permission') text = 'Claude needs your approval';
  else if (state === 'working' || state === 'starting') text = 'Claude is working';
  else if (state === 'error') text = 'Something went wrong in this chat';
  else if (last?.kind === 'turn-end' && last.ok && !last.interrupted) text = 'Claude has finished';
  return (
    <div className="visually-hidden" aria-live="polite" role="status">
      {text}
    </div>
  );
}

const DRAWER_BODIES: Record<DrawerName, ComponentType> = {
  chats: ChatsDrawer,
  todos: TodosDrawer,
  skills: SkillsDrawer,
};

/** What the sheet shows for the current view. An unknown app shows Home. */
function SheetContent() {
  const { view, activeChat } = useStore();
  if (view === 'settings') {
    return (
      <>
        <SheetBar title="Settings" />
        <div className="sheet-scroll">
          <SettingsView />
        </div>
      </>
    );
  }
  if (view.startsWith('app:')) {
    const app = APPS.find((a) => view === `app:${a.id}`);
    if (!app) return <Home />;
    return (
      <>
        <SheetBar title={app.title}>
          {app.BarActions ? (
            <Suspense fallback={null}>
              <app.BarActions />
            </Suspense>
          ) : null}
        </SheetBar>
        <div className="sheet-scroll">
          <Suspense fallback={null}>
            <app.Sheet />
          </Suspense>
        </div>
      </>
    );
  }
  return activeChat.kind === 'live' ? <ChatView /> : <Home />;
}

function Shell() {
  const { boot, newChat, view } = useStore();
  const { state, dispatch, modes } = useShell();
  // One source of truth for what shows and what floats: the shell provider's layout.
  const { railShowsNames, drawerModal, panelShowing, panelModal } = useDesk();
  // Keep the last drawer's body in place while the dock slides shut.
  const lastDrawer = useRef<DrawerName>('chats');
  if (state.drawer) lastDrawer.current = state.drawer;
  if (!boot) return null;

  const drawer = state.drawer ?? lastDrawer.current;
  const drawerOpen = state.drawer !== null;
  const modal = drawerModal || panelModal;
  const DrawerBody = DRAWER_BODIES[drawer];
  // An app with a panel of its own fills the right dock while it is on the sheet.
  const app = APPS.find((a) => view === `app:${a.id}`);
  const AppPanel = app?.Panel;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the main content
      </a>
      <div className="desk" data-rail={railShowsNames ? 'wide' : 'icons'} inert={state.paletteOpen}>
        <Rail inert={modal} />
        {/* A floating panel makes the drawer behind it unreachable too. */}
        <div className="dock-slot" inert={panelModal}>
          <Dock
            side="left"
            open={drawerOpen}
            label={DRAWER_LABELS[drawer]}
            overlay={modes.drawerOverlays}
            onClose={() => dispatch({ type: 'close-drawer' })}
            actions={
              drawer === 'chats' ? (
                <button
                  type="button"
                  className="btn"
                  data-variant="primary"
                  data-size="small"
                  onClick={() => {
                    newChat();
                    // A floating drawer closes once a choice is made; a pushing one stays.
                    if (modes.drawerOverlays) dispatch({ type: 'close-drawer' });
                  }}
                >
                  New chat
                </button>
              ) : undefined
            }
          >
            <DrawerBody />
          </Dock>
        </div>
        <main className="sheet" id="main" tabIndex={-1} inert={modal}>
          <SheetNotices />
          <SheetContent />
        </main>
        <Dock
          side="right"
          open={panelShowing}
          label={app && AppPanel ? (app.panelLabel ?? app.title) : 'This chat'}
          overlay={modes.panelOverlays}
          onClose={() => dispatch({ type: 'set-panel', open: false })}
        >
          {AppPanel ? (
            <Suspense fallback={null}>
              <AppPanel />
            </Suspense>
          ) : (
            <Inspector />
          )}
        </Dock>
      </div>
      <Palette />
      <Announcer />
    </>
  );
}

function Root() {
  const { gate, boot, retry } = useStore();
  if (gate === 'loading') return <Loading />;
  if (gate === 'not-signed-in' || gate === 'unreachable') return <GateScreen gate={gate} retry={retry} />;
  if (!boot) return <Loading />;
  if (!boot.brain.ok || !boot.engine.ok) return <BootProblem boot={boot} retry={retry} />;
  return (
    <ShellProvider>
      <Shell />
    </ShellProvider>
  );
}

export function App() {
  useBlockStrayDrops();
  return (
    <StoreProvider>
      <Root />
    </StoreProvider>
  );
}
