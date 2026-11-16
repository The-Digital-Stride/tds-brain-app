import { type ReactNode, useId } from 'react';

/** The inline "are you sure" step (design system: `fieldset.close-confirm`): Cancel has focus, Esc cancels. */
export function Confirm({
  label,
  text,
  action,
  variant,
  busy,
  onConfirm,
  onCancel,
}: {
  /** Names the group for screen readers: "Approve this proposal". */
  label: string;
  text: ReactNode;
  action: string;
  variant: 'primary' | 'danger';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const textId = useId();
  return (
    <fieldset
      className="close-confirm am-confirm"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          // Handled here, so the shell's Esc doesn't also close the panel. While busy it does nothing.
          e.preventDefault();
          if (!busy) onCancel();
        }
      }}
    >
      <span id={textId}>{text}</span>
      <button
        type="button"
        className="btn"
        data-variant={variant}
        data-size="small"
        aria-disabled={busy || undefined}
        aria-describedby={textId}
        onClick={() => {
          if (!busy) onConfirm();
        }}
      >
        {action}
      </button>
      <button
        type="button"
        className="btn"
        data-size="small"
        // biome-ignore lint/a11y/noAutofocus: focus moves here because the question just appeared.
        autoFocus
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onCancel();
        }}
      >
        Cancel
      </button>
    </fieldset>
  );
}
