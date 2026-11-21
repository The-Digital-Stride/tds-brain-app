/**
 * A to-do row's project as a chip: pressing it filters the To-dos drawer to that project. Only a to-do in a
 * known project gets one, and only while no project filter is on (every row would name the same one).
 */
export function ProjectChip({ label, onPick }: { label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      className="chip todo-place"
      aria-label={`Filter by project: ${label}`}
      data-tip="Filter by this project"
      onClick={onPick}
    >
      <span className="todo-place-text">{label}</span>
    </button>
  );
}
