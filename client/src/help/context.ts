import type { HelpContext, HelpForContext } from './contract.ts';
import { HELP_FALLBACK_ID } from './contract.ts';

/** The page Help opens on for where the person is (plan decision 4). Always an id that exists in the library. */
export const helpForContext: HelpForContext = (ctx: HelpContext, library) => {
  const id = pick(ctx);
  return library.byId(id) ? id : HELP_FALLBACK_ID;
};

function pick(ctx: HelpContext): string {
  if (ctx.drawer === 'chats') return 'chats-drawer';
  if (ctx.drawer === 'todos') return 'todos';
  if (ctx.drawer === 'skills') return 'skills';
  if (ctx.view === 'chat' && ctx.waiting) return 'approvals-and-questions';
  switch (ctx.view) {
    case 'home':
      return 'home';
    case 'chat':
      return 'talking-to-claude';
    case 'app:documents':
      return 'documents';
    case 'app:images':
      return 'images';
    default:
      return HELP_FALLBACK_ID;
  }
}
