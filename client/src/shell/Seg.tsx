import { type KeyboardEvent, useRef } from 'react';
import type { SegProps } from './contract.ts';

/**
 * A segmented choice. Behaves as a radio group: one tab stop (the chosen option), and the arrow
 * keys, Home and End move the choice and the focus together.
 */
export function Seg<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (to: number) => {
    const n = options.length;
    if (n === 0) return;
    const i = (to + n) % n;
    const option = options[i];
    if (!option) return;
    onChange(option.value);
    buttons.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = current + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = current - 1;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = options.length - 1;
    if (to === null) return;
    e.preventDefault();
    move(to);
  };

  return (
    <div className="seg" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = i === current;
        return (
          // biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, styled as a segmented control.
          <button
            key={o.value}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
