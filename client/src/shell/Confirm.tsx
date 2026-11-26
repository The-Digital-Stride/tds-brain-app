import { type ReactNode, useId } from 'react';

/** The inline "are you sure" step (design system, Shared pieces): the safe option has focus, Esc picks it. */
export function Confirm({
  label,
  text,
  action,
  safe = 'Cancel',
  extra,
  variant,
  busy,
  onConfirm,
  onCancel,
}: {
  /** Names the group for screen readers: "Approve this proposal". */
  label: string;
  text: ReactNode;
  action: string;
  /** The safe option: "Keep editing", "Keep chat" when protecting work; "Cancel" for a constructive step. */
  safe?: string;
  /**
   * A third answer, between the action and the safe option, for a question with a middle way ("Save for later"):
   * a standard button, so the action stays the only coloured one.
   */
  extra?: { label: string; onChoose: () => void };
  variant: 'primary' | 'danger';
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const textId = useId();
  return (
    <fieldset
      className="confirm"
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
      {extra ? (
        <button
          type="button"
          className="btn"
          data-size="small"
          aria-disabled={busy || undefined}
          aria-describedby={textId}
          onClick={() => {
            if (!busy) extra.onChoose();
          }}
        >
          {extra.label}
        </button>
      ) : null}
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
        {safe}
      </button>
    </fieldset>
  );
}
