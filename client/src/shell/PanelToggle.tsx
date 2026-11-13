import { DOCK_IDS } from './Dock.tsx';
import { Icon } from './Icon.tsx';
import { useShell } from './ShellProvider.tsx';

/**
 * Shows or hides the right panel. An icon only, and always the last thing in the sheet bar (its top
 * right), the same place the rail keeps its own toggle. `SheetBar` renders it; a sheet never places
 * it itself.
 */
export function PanelToggle({ label }: { label: string }) {
  const { state, dispatch } = useShell();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      aria-pressed={state.panelOpen}
      aria-controls={DOCK_IDS.right}
      onClick={() => dispatch({ type: 'toggle-panel' })}
    >
      <Icon name="panel" />
    </button>
  );
}
