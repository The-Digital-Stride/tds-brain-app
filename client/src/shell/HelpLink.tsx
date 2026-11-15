import { helpLibrary } from '../help/library.ts';
import { helpVisible } from '../help/visibility.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/**
 * A quiet "?" button that opens Help on one page. Shown only where Help is switched on for the person's role, and
 * only for a page that exists. `size` 28 is the in-row size (Settings rows); 32 is the header size. The tooltip is the short `data-tip`; the `aria-label` names the page.
 */
export function HelpLink({ page, size = 32 }: { page: string; size?: 28 | 32 }) {
  const { boot } = useStore();
  const { dispatch } = useShell();
  const topic = helpLibrary.byId(page);
  if (!topic || !helpVisible(boot?.identity.role ?? 'unknown')) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      data-size={size === 28 ? '28' : undefined}
      aria-label={`Help: ${topic.title}`}
      data-tip="Help"
      onClick={() => dispatch({ type: 'open-help', page })}
    >
      <Icon name="help" />
    </button>
  );
}
