import { useId, useState } from 'react';
import type { FoldProps } from './contract.ts';
import { Icon } from './Icon.tsx';

/**
 * An expanding section in a drawer: a header button with a chevron and an optional count. `action` (a
 * quiet small button, say) sits on the right of the heading line, beside the toggle and never inside it.
 */
export function Fold({
  title,
  count,
  defaultOpen = true,
  open: openProp,
  onToggle,
  action,
  level = 3,
  children,
}: FoldProps) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOwn(next);
    onToggle?.(next);
  };
  const id = useId();
  const Head = level === 4 ? 'h4' : 'h3';
  return (
    <section className="fold" data-open={open} data-action={action ? 'true' : undefined}>
      <Head className="fold-head">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={toggle}>
          <Icon name="chevron" size={14} />
          <span className="fold-title">{title}</span>
          {count === undefined ? null : <span className="count">{count}</span>}
        </button>
      </Head>
      {action ? <div className="fold-action">{action}</div> : null}
      <div className="fold-rows" id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
