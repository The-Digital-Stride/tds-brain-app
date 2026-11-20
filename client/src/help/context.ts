import { SETTINGS_TABS } from '../shell/settings-tabs.ts';
import type { HelpContext, HelpForContext } from './contract.ts';
import { HELP_FALLBACK_ID } from './contract.ts';

/** The page Help opens on for where the person is (plan decision 4). Always an id that exists in the library. */
export const helpForContext: HelpForContext = (ctx: HelpContext, library) => {
  // A tool (`tool:<section>/<tool>`) opens its own page if it has one, else its section's.
  if (ctx.view.startsWith('tool:')) {
    const [section, tool] = ctx.view.slice('tool:'.length).split('/');
    for (const id of [tool, section]) if (id && library.byId(id)) return id;
    return HELP_FALLBACK_ID;
  }
  const id = pick(ctx);
  return library.byId(id) ? id : HELP_FALLBACK_ID;
};

function pick(ctx: HelpContext): string {
  if (ctx.drawer === 'chats') return 'chats-drawer';
  if (ctx.drawer === 'todos') return 'todos';
  if (ctx.drawer === 'skills') return 'skills';
  if (ctx.drawer === 'section') return 'workbench';
  if (ctx.view === 'chat' && ctx.waiting) return 'approvals-and-questions';
  switch (ctx.view) {
    case 'home':
      return 'home';
    case 'chat':
      return 'talking-to-claude';
    case 'settings':
      return SETTINGS_TABS.find((t) => t.id === ctx.settingsTab)?.help ?? 'settings';
    case 'profile':
      return 'your-profile';
    case 'guide':
      return 'cortex-guide';
    case 'app:documents':
      return 'documents';
    case 'app:images':
      return 'images';
    default:
      return HELP_FALLBACK_ID;
  }
}
