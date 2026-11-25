import { DOCK_IDS } from './Dock.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/**
 * Shows or hides the right panel. An icon only, and always the last thing in the sheet bar (its top
 * right), the same place the rail keeps its own toggle. `SheetBar` renders it; a sheet never places
 * it itself. On Home the right panel is Customise Home, so there it drives `homeCustomiseOpen` and
 * leaves This chat's `panelOpen` alone (plan 2026-11-25-home-card-library, decision 15).
 */
export function PanelToggle({ label }: { label: string }) {
  const { state, dispatch, onHome } = useShell();
  // A test double without `onHome` reads as not on Home.
  const home = onHome === true;
  const open = home ? state.homeCustomiseOpen : state.panelOpen;
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      aria-pressed={open}
      aria-controls={DOCK_IDS.right}
      onClick={() => dispatch(home ? { type: 'set-customise-home', open: !open } : { type: 'toggle-panel' })}
    >
      <Icon name="panel" />
    </button>
  );
}
