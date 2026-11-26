/**
 * The file type label on library tiles and rows. In its own file because `parts.tsx` is also reached by the
 * eager shell, and `.lib-type` is styled in the lazy `library.css` (the design-system guard checks this).
 */
/** The file's own extension in capitals, as it is: `.jpeg` is JPEG, a claude.ai link card is HTML. */
function extWords(ext: string): string {
  return ext.toUpperCase();
}

/** A small grey label with the file's type, on a tile's picture or in a list row. The meta line says it for screen readers. */
export function TypeBadge({ ext }: { ext: string }) {
  return (
    <span className="badge lib-type" data-tone="muted" aria-hidden="true">
      {extWords(ext)}
    </span>
  );
}

/** The type, said to screen readers at the start of the meta line ("PDF, 840 KB"). */
export function TypeWord({ ext }: { ext: string }) {
  return <span className="visually-hidden">{extWords(ext)}, </span>;
}
