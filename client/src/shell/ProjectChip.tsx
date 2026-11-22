/**
 * A to-do row's project as a chip: pressing it filters the To-dos drawer to that project. Only a to-do in a
 * known project gets one, and only while no project filter is on (every row would name the same one).
 */
/** `short` is what shows (the full `label` names it and shows as its tip, for a cut-off pill). */
export function ProjectChip({ label, short, onPick }: { label: string; short?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      className="chip todo-place"
      aria-label={`Filter by project: ${label}`}
      data-tip={`Filter by ${label}`}
      onClick={onPick}
    >
      <span className="todo-place-text">{short ?? label}</span>
    </button>
  );
}
