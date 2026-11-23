/**
 * "Show N more {noun}" or "Show all N {noun}", then "Show fewer": a quiet small button that expands a list in
 * place. `aria-expanded` carries the state; the noun stays in the label for screen readers when it is open.
 * The rows it reveals come before it in the DOM, so Shift+Tab reaches them.
 */
export function ShowMore({
  expanded,
  count,
  noun,
  wording,
  onToggle,
}: {
  expanded: boolean;
  /** The number in the words: how many more (`wording="more"`) or the total (`wording="all"`). */
  count: number;
  noun: { one: string; many: string };
  wording: 'more' | 'all';
  onToggle: () => void;
}) {
  const word = count === 1 ? noun.one : noun.many;
  const n = count.toLocaleString('en-GB');
  return (
    <button
      type="button"
      className="btn"
      data-variant="quiet"
      data-size="small"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? (
        <>
          Show fewer<span className="visually-hidden"> {noun.many}</span>
        </>
      ) : wording === 'all' ? (
        `Show all ${n} ${word}`
      ) : (
        `Show ${n} more ${word}`
      )}
    </button>
  );
}
