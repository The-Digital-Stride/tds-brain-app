import { helpLibrary } from '../help/library.ts';
import { helpVisible } from '../help/visibility.ts';
import { useStore } from '../store.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/**
 * A quiet "?" button that opens Help on one page. Shown only where Help is switched on for the person's role, and
 * only for a page that exists. The tooltip is the short `data-tip`; the `aria-label` names the page.
 */
export function HelpLink({ page }: { page: string }) {
  const { boot } = useStore();
  const { dispatch } = useShell();
  const topic = helpLibrary.byId(page);
  if (!topic || !helpVisible(boot?.identity.role ?? 'unknown')) return null;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Help: ${topic.title}`}
      data-tip="Help"
      onClick={() => dispatch({ type: 'open-help', page })}
    >
      <Icon name="help" />
    </button>
  );
}
