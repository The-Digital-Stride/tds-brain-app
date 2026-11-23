import { type ComponentType, lazy, Suspense, useRef } from 'react';
import { meterBand } from '../../shared/context-contract.ts';
import { useBlockStrayDrops } from './components/Attachments.tsx';
import { ChatView } from './components/Chat.tsx';
import { BootProblem, GateScreen, Loading } from './components/Gates.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { SettingsSheet } from './components/SettingsSheet.tsx';
import { SetupView } from './components/SetupView.tsx';
import { helpVisible } from './help/visibility.ts';
import { APPS } from './shell/apps.ts';
import { ChatDrawer } from './shell/ChatDrawer.tsx';
import { ChatsDrawer } from './shell/ChatsDrawer.tsx';
import type { DrawerName } from './shell/contract.ts';
import { Dock } from './shell/Dock.tsx';
import { FileViewer } from './shell/FileViewer.tsx';
import { HelpDrawer } from './shell/HelpDrawer.tsx';
import { HelpLink } from './shell/HelpLink.tsx';
import { Home } from './shell/Home.tsx';
import { Inspector } from './shell/Inspector.tsx';
import { Palette } from './shell/Palette.tsx';
import { DRAWER_LABELS, Rail } from './shell/Rail.tsx';
import { SectionDrawer } from './shell/SectionDrawer.tsx';
import { SheetBar } from './shell/SheetBar.tsx';
import { SheetNotices } from './shell/SheetNotices.tsx';
import { ShellProvider, useDesk, useShell } from './shell/ShellProvider.tsx';
import { SkillsDrawer } from './shell/SkillsDrawer.tsx';
import { SECTIONS, visibleToolFor, visibleTools } from './shell/sections.ts';
import { TodosDrawer } from './shell/TodosDrawer.tsx';
import { ToolTabs, tabGroupFor } from './shell/ToolTabs.tsx';
import { Tooltips } from './shell/Tooltips.tsx';
import { initialChatState, pendingCard } from './state/chat-reducer.ts';
import { StoreProvider, useStore, useToolSnapshot } from './store.tsx';
import { Tour, useTourOpen } from './tour/index.ts';

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
  else if (chat?.compacting) text = 'Claude is summarising the earlier conversation to make room';
  else if (state === 'working' || state === 'starting') text = 'Claude is working';
  else if (state === 'error') text = 'Something went wrong in this chat';
  else if (last?.kind === 'turn-end' && last.ok && !last.interrupted)
    text =
      chat?.context?.autoCompact && meterBand(chat.context.percent) === 'full'
        ? 'Claude has finished. This chat is nearly full, so Claude will summarise the earlier messages soon'
        : 'Claude has finished';
  return (
    <div className="visually-hidden" aria-live="polite" role="status">
      {text}
    </div>
  );
}

const GuideView = lazy(() => import('./shell/GuideView.tsx').then((m) => ({ default: m.GuideView })));

const DRAWER_BODIES: Record<DrawerName, ComponentType> = {
  chats: ChatsDrawer,
  todos: TodosDrawer,
  skills: SkillsDrawer,
  help: HelpDrawer,
  section: SectionDrawer,
};

/** What the sheet shows for the current view. An unknown app shows Home. */
function SheetContent() {
  const { view, activeChat, boot } = useStore();
  const snap = useToolSnapshot();
  if (view === 'guide') {
    // Whoever helpVisible turns away (nobody, since 2026-11-15) lands on Home.
    if (!helpVisible(boot?.identity.role ?? 'unknown')) return <Home />;
    return (
      <>
        <SheetBar title="Cortex Guide">
          <button type="button" className="btn" onClick={() => window.print()}>
            Print the guide
          </button>
        </SheetBar>
        <div className="sheet-scroll">
          <Suspense fallback={null}>
            <GuideView />
          </Suspense>
        </div>
      </>
    );
  }
  if (view === 'settings') {
    return <SettingsSheet />;
  }
  if (view === 'profile') {
    return (
      <>
        <SheetBar title="Profile" />
        <div className="sheet-scroll">
          <ProfileView />
        </div>
      </>
    );
  }
  if (view.startsWith('app:')) {
    const app = APPS.find((a) => view === `app:${a.id}`);
    if (!app) return <Home />;
    return (
      <>
        <SheetBar title={app.title} panel={app.Panel ? (app.panelLabel ?? app.title) : undefined}>
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
  if (view.startsWith('tool:')) {
    // An unknown tool, or one this person can't see (yet), shows Home.
    const hit = visibleToolFor(view, snap);
    if (!hit) return <Home />;
    const { section, tool } = hit;
    const tabs = tabGroupFor(tool, visibleTools(section, snap)).length >= 2;
    return (
      <>
        <SheetBar
          title={tabs ? `${section.title} · ${tool.group}` : `${section.title} · ${tool.title}`}
          titleHidden={tabs ? `: ${tool.title}` : undefined}
          panel={tool.Panel ? (tool.panelLabel ?? tool.title) : undefined}
        >
          {tool.BarActions ? (
            <Suspense fallback={null}>
              <tool.BarActions />
            </Suspense>
          ) : null}
        </SheetBar>
        {tabs ? <ToolTabs section={section} tool={tool} /> : null}
        <div className="sheet-scroll">
          <Suspense fallback={null}>
            <tool.Sheet />
          </Suspense>
        </div>
      </>
    );
  }
  return activeChat.kind === 'live' ? <ChatView /> : <Home />;
}

function Shell() {
  // The tour's card is the only thing in reach while it shows.
  const touring = useTourOpen();
  const { boot, view } = useStore();
  const snap = useToolSnapshot();
  const { state, dispatch, modes } = useShell();
  // One source of truth for what shows and what floats: the shell provider's layout.
  const { railShowsNames, drawerModal, panelShowing, panelModal } = useDesk();
  // Keep the last drawer's body in place while the dock slides shut.
  const lastDrawer = useRef<DrawerName>('chats');
  if (state.drawer) lastDrawer.current = state.drawer;
  // The section drawer is headed with the section's own title, kept while the dock slides shut.
  const lastSection = useRef<string | null>(null);
  if (state.section) lastSection.current = state.section;
  if (!boot) return null;

  const drawer = state.drawer ?? lastDrawer.current;
  const drawerOpen = state.drawer !== null;
  const modal = drawerModal || panelModal;
  // The file viewer floats over the whole desk, which is out of reach while it shows.
  const viewing = state.viewer !== null;
  // The to-do panel (mounted by the To-dos drawer into the slot below): the sheet is out of reach under it. When
  // the drawer floats the panel covers it and the rail as well, so they are out of reach too.
  const todoOpen = state.todoPanel !== null;
  const todoModal = todoOpen && modes.drawerOverlays;
  const DrawerBody = DRAWER_BODIES[drawer];

  // An app with a panel of its own fills the right dock while it is on the sheet.
  const app = APPS.find((a) => view === `app:${a.id}`);
  // A tool with a panel of its own does the same, once it is visible.
  const tool = visibleToolFor(view, snap)?.tool;
  const sheetApp = app ?? tool;
  const AppPanel = sheetApp?.Panel;

  return (
    <>
      <a className="skip-link" href="#main" inert={viewing || touring}>
        Skip to the main content
      </a>
      <div
        className="desk"
        data-rail={railShowsNames ? 'wide' : 'icons'}
        inert={state.paletteOpen || viewing || touring}
      >
        <Rail inert={modal || todoModal} />
        {/* A floating panel makes the drawer behind it unreachable too. */}
        <div className="dock-slot" inert={panelModal || todoModal}>
          <Dock
            side="left"
            open={drawerOpen}
            label={
              drawer === 'section'
                ? (SECTIONS.find((x) => x.id === (state.section ?? lastSection.current))?.title ??
                  DRAWER_LABELS.section)
                : DRAWER_LABELS[drawer]
            }
            overlay={modes.drawerOverlays}
            // Closing Help puts back the drawer it replaced.
            onClose={() => dispatch({ type: state.drawer === 'help' ? 'close-help' : 'close-drawer' })}
            actions={
              <>
                {drawer === 'chats' ? <HelpLink page="chats-drawer" /> : null}
                {drawer === 'todos' ? <HelpLink page="todos" /> : null}
                {drawer === 'skills' ? <HelpLink page="skills" /> : null}
                {drawer === 'section' ? <HelpLink page="workbench" /> : null}
                {/* New chat is the + at the end of the Chats drawer's Open/Earlier row (ChatsDrawer). */}
              </>
            }
          >
            <DrawerBody />
          </Dock>
        </div>
        <main className="sheet" id="main" tabIndex={-1} inert={modal || todoOpen}>
          <SheetNotices />
          <SheetContent />
          <ChatDrawer />
        </main>
        {/* Out of reach while the to-do panel is open: on wide screens it sits under the panel and its veil. */}
        <div className="dock-slot" inert={todoOpen}>
          <Dock
            side="right"
            open={panelShowing}
            label={sheetApp && AppPanel ? (sheetApp.panelLabel ?? sheetApp.title) : 'This chat'}
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
        {/* The To-dos drawer puts its panel here: beside the dock, because the dock clips what is inside it. */}
        <div id="todo-panel-slot" className="dock-slot" />
      </div>
      <Palette />
      <FileViewer />
      <Tooltips />
      <Announcer />
      <Tour />
    </>
  );
}

function Root() {
  const { gate, boot, retry, setupOpen, setSetupOpen } = useStore();
  if (gate === 'loading') return <Loading />;
  if (gate === 'not-signed-in' || gate === 'unreachable') return <GateScreen gate={gate} retry={retry} />;
  if (!boot) return <Loading />;
  if (boot.appState.kind === 'setup')
    return <SetupView appState={boot.appState} underService={boot.service.underService} />;
  if (setupOpen) {
    return (
      <SetupView
        appState={boot.appState}
        underService={boot.service.underService}
        onCancel={() => {
          setSetupOpen(false);
          // Back where the person started: the Change button, or failing that the page's heading.
          setTimeout(() => {
            const back = document.querySelector<HTMLElement>('[aria-label="Change brain folder"]');
            const h1 = document.querySelector<HTMLElement>('main h1');
            if (!back && h1) h1.tabIndex = -1;
            (back ?? h1)?.focus();
          }, 0);
        }}
      />
    );
  }
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
