import { useEffect, useId, useRef, useState } from 'react';
import type { ClientInfo } from '../../../shared/contract.ts';

export interface ClientAskProps {
  clients: ClientInfo[];
  /** Likeliest client slugs, best first. May be empty. */
  options: string[];
  /** A client slug, or null for "Not client work". */
  onChoose: (slug: string | null) => void;
  onCancel: () => void;
}

/** The one-tap question shown above the composer when the app can't tell which client a new chat is for. */
export function ClientAsk({ clients, options, onChoose, onCancel }: ClientAskProps) {
  const headingId = useId();
  const selectId = useId();
  const [other, setOther] = useState('');
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => group.current?.focus(), []);
  const named = options.flatMap((slug) => {
    const c = clients.find((x) => x.slug === slug);
    return c ? [c] : [];
  });
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border and legend; the heading names the group.
    <div
      ref={group}
      className="pending client-ask"
      role="group"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <h2 id={headingId}>Which client is this for?</h2>
      <div className="client-ask-row">
        {named.map((c) => (
          <button key={c.slug} type="button" className="btn" onClick={() => onChoose(c.slug)}>
            {c.name}
          </button>
        ))}
        <button type="button" className="btn" onClick={() => onChoose(null)}>
          No client
        </button>
      </div>
      <div className="client-ask-row">
        <label className="visually-hidden" htmlFor={selectId}>
          Another client
        </label>
        <select id={selectId} className="field" value={other} onChange={(e) => setOther(e.target.value)}>
          <option value="">Another client…</option>
          {clients.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={other === ''} onClick={() => onChoose(other)}>
          Use this client
        </button>
        <button type="button" className="btn" data-variant="quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
