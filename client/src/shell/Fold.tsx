import { useId, useState } from 'react';
import type { FoldProps } from './contract.ts';
import { Icon } from './Icon.tsx';

/** An expanding section in a drawer: a 30px header button with a chevron and an optional count. */
export function Fold({ title, count, defaultOpen = true, children }: FoldProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="fold" data-open={open}>
      <h3 className="fold-head">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <Icon name="chevron" size={14} />
          <span className="fold-title">{title}</span>
          {count === undefined ? null : <span className="count">{count}</span>}
        </button>
      </h3>
      <div className="fold-rows" id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
