import type { SheetBarProps } from './contract.ts';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

const onMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar across the top of every sheet: the page's one `h1`, an optional lead-in ("Chats / …"),
 * whatever the sheet adds on the right, and last the button that opens the palette.
 */
export function SheetBar({ title, crumb, children }: SheetBarProps) {
  const { dispatch } = useShell();
  return (
    <div className="sheet-bar">
      <div className="crumb">
        {crumb ? (
          <>
            <span className="crumb-lead">{crumb}</span>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
          </>
        ) : null}
        {/* The full title on hover: it truncates when the docks are open. */}
        <h1 title={title}>{title}</h1>
      </div>
      {children}
      <button
        type="button"
        className="jump"
        aria-label="Search or jump to"
        aria-keyshortcuts={onMac ? 'Meta+K' : 'Control+K'}
        onClick={() => dispatch({ type: 'set-palette', open: true })}
      >
        <Icon name="search" size={18} />
        <span className="jump-text">Search or jump to</span>
        <kbd>{onMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
    </div>
  );
}
