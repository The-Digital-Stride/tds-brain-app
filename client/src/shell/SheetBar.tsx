import type { SheetBarProps } from './contract.ts';
import { Icon } from './Icon.tsx';
import { PanelToggle } from './PanelToggle.tsx';
import { useShell } from './ShellProvider.tsx';

const onMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The bar across the top of every sheet: the page's one `h1`, an optional lead-in ("Chats / …"),
 * whatever the sheet adds on the right, then the button that opens the palette, and last (top
 * right, always) the right panel's toggle when the sheet has a panel.
 */
export function SheetBar({ title, crumb, panel, children }: SheetBarProps) {
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
      {panel ? <PanelToggle label={panel} /> : null}
    </div>
  );
}
