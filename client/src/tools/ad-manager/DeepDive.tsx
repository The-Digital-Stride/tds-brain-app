import { type DragEvent, useEffect, useRef, useState } from 'react';
import type { AdsBoard } from '../../../../shared/ads-contract.ts';
import { Icon } from '../../shell/Icon.tsx';
import { AmTable } from './AmTable.tsx';
import { arrange, mergeOrder, moveTable, readLayout, type TableLayout, writeLayout } from './table-layout.ts';
import { readTables, type Table } from './types.ts';

const KEY_HINT = 'Use the arrow keys to move it one place, Home or End to move it to the start or end.';

/** One report card: grip, title, meta line, "Worth a look", full-width toggle, then the shared table. */
function DeepCard({
  t,
  currency,
  place,
  total,
  wide,
  worth,
  dragging,
  armed,
  onArm,
  onWide,
  onKey,
  onDragStart,
  onDragEnd,
}: {
  t: Table;
  currency: string;
  place: number;
  total: number;
  wide: boolean;
  worth: string | null;
  dragging: boolean;
  armed: boolean;
  onArm: (on: boolean) => void;
  onWide: () => void;
  onKey: (key: string) => boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const hint = `am-hint-${t.id}`;
  return (
    <section
      className="card am-deep"
      aria-labelledby={`am-t-${t.id}`}
      data-table-id={t.id}
      data-wide={wide ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      draggable={armed}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="am-th">
        <button
          type="button"
          className="icon-btn am-grip"
          data-size="small"
          data-handle={t.id}
          data-tip="Move table"
          aria-label={`Move ${t.title}, ${place + 1} of ${total}`}
          aria-describedby={hint}
          onPointerDown={() => onArm(true)}
          onPointerUp={() => onArm(false)}
          onPointerCancel={() => onArm(false)}
          onKeyDown={(e) => {
            if (onKey(e.key)) e.preventDefault();
          }}
        >
          <Icon name="grip" size={16} />
        </button>
        <span id={hint} className="visually-hidden">
          {KEY_HINT}
        </span>
        <div className="am-th-text">
          <h3 id={`am-t-${t.id}`} data-table={t.id} tabIndex={-1} className="am-t-h">
            {t.title}
          </h3>
          {t.subtitle ? <p className="am-sub">{t.subtitle}</p> : null}
        </div>
        {t.tone === 'warn' ? (
          <span className="badge am-th-badge" data-tone="waiting">
            {worth ?? 'Worth a look'}
          </span>
        ) : null}
        <button
          type="button"
          className="icon-btn am-wide-btn"
          data-size="small"
          data-tip="Full width"
          aria-label={`Full width: ${t.title}`}
          aria-pressed={wide}
          onClick={onWide}
        >
          <Icon name="wide" size={16} />
        </button>
      </div>
      <AmTable t={t} currency={currency} />
    </section>
  );
}

/** "Ads account deep dive": up to six sortable tables, in the order and widths the person left them. */
export function DeepDive({ board, currency }: { board: AdsBoard; currency: string }) {
  const tables = readTables(board);
  const [layout, setLayout] = useState<TableLayout>(() => readLayout());
  const [announce, setAnnounce] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; height: number; slot: number } | null>(null);
  const focusId = useRef<string | null>(null);
  const tray = useRef<HTMLDivElement>(null);

  const shown = arrange(tables, layout.order);
  const ids = shown.map((t) => t.id);
  const wideIds = layout.wide.filter((id) => ids.includes(id));
  const isDefault = ids.every((id, i) => id === tables[i]?.id) && wideIds.length === 0;

  // React moves a re-ordered card's node, which drops focus: give it back to the handle that was used.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every order change on purpose
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = null;
    tray.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`)?.focus();
  }, [ids.join('|')]);

  const save = (next: TableLayout) => {
    setLayout(next);
    writeLayout(next);
  };

  if (tables.length === 0)
    return (
      <div className="tray am-tray" data-cols="1">
        <section className="card" aria-labelledby="am-deep">
          <div className="card-head">
            <h2 id="am-deep">Ads account deep dive</h2>
          </div>
          <p className="card-note">
            No account data yet. Once the data files arrive, the top campaigns, search terms, wasted spend,
            keywords, products and Quality Score tables appear here.
          </p>
        </section>
      </div>
    );

  const place = (id: string, to: number) => {
    const next = moveTable(ids, id, to);
    const at = next.indexOf(id);
    focusId.current = id;
    if (at !== ids.indexOf(id)) save({ order: mergeOrder(layout.order, next), wide: layout.wide });
    const title = shown.find((t) => t.id === id)?.title ?? 'Table';
    setAnnounce(`${title} moved to ${at + 1} of ${ids.length}`);
  };
  const keyMove = (id: string, key: string): boolean => {
    const at = ids.indexOf(id);
    const to =
      key === 'ArrowLeft' || key === 'ArrowUp'
        ? at - 1
        : key === 'ArrowRight' || key === 'ArrowDown'
          ? at + 1
          : key === 'Home'
            ? 0
            : key === 'End'
              ? ids.length - 1
              : null;
    if (to === null) return false;
    place(id, to);
    return true;
  };
  const toggleWide = (id: string) =>
    save({
      order: layout.order,
      wide: layout.wide.includes(id) ? layout.wide.filter((x) => x !== id) : [...layout.wide, id],
    });

  const startDrag = (e: DragEvent<HTMLElement>, id: string) => {
    if (armed !== id) {
      e.preventDefault();
      return;
    }
    const card = e.currentTarget;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const rect = card.getBoundingClientRect();
    e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top);
    const from = ids.indexOf(id);
    // Hide the card once the browser has taken its picture; the placeholder shows where it would land.
    setTimeout(() => setDrag({ id, height: rect.height, slot: from }), 0);
  };
  const endDrag = () => {
    setDrag(null);
    setArmed(null);
  };
  const overTray = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = (e.target as HTMLElement).closest<HTMLElement>('[data-table-id]');
    if (!card || card.dataset.tableId === drag.id) return;
    const rest = ids.filter((x) => x !== drag.id);
    const k = rest.indexOf(card.dataset.tableId ?? '');
    if (k < 0) return;
    const r = card.getBoundingClientRect();
    const full = tray.current ? r.width > tray.current.clientWidth * 0.7 : false;
    const after = full ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    const slot = after ? k + 1 : k;
    if (slot !== drag.slot) setDrag({ ...drag, slot });
  };
  const dropOnTray = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.preventDefault();
    // No slot (the pointer left the tables and came back over a gap): nothing moves.
    if (drag.slot >= 0) place(drag.id, drag.slot);
    endDrag();
  };
  const leaveTray = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setDrag((d) => (d ? { ...d, slot: -1 } : d));
  };

  const cards = shown.map((t, i) => (
    <DeepCard
      key={t.id}
      t={t}
      currency={currency}
      place={i}
      total={shown.length}
      wide={wideIds.includes(t.id)}
      worth={
        t.id === 'waste' && board.wastePct > 0 ? `Worth a look: ${board.wastePct}% of search spend` : null
      }
      dragging={drag?.id === t.id}
      armed={armed === t.id}
      onArm={(on) => setArmed(on ? t.id : null)}
      onWide={() => toggleWide(t.id)}
      onKey={(key) => keyMove(t.id, key)}
      onDragStart={(e) => startDrag(e, t.id)}
      onDragEnd={endDrag}
    />
  ));
  // With a card in the air, the others fill the grid and a placeholder sits where it would land.
  const items = (() => {
    if (!drag || drag.slot < 0) return cards;
    // The card in the air stays in the list (hidden) so the browser's drag survives; the placeholder goes
    // before the card that would follow it.
    const rest = cards.filter((c) => c.key !== drag.id);
    const before = rest[drag.slot]?.key ?? null;
    const drop = (
      <div
        key="am-drop"
        className="am-drop"
        aria-hidden="true"
        data-wide={wideIds.includes(drag.id) ? 'true' : undefined}
        style={{ minHeight: drag.height }}
      />
    );
    const out = cards.flatMap((c) => (c.key === before ? [drop, c] : [c]));
    return before === null ? [...out, drop] : out;
  })();

  return (
    <>
      <div className="am-hrow">
        <div className="am-h">
          <h2 className="am-h-text">Ads account deep dive</h2>{' '}
          <span className="am-dim">
            {tables.length} tables, press a column to sort, drag the grip to move
          </span>
        </div>
        {isDefault ? null : (
          <button
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            onClick={() => {
              save({ order: [], wide: [] });
              setAnnounce('Layout reset');
            }}
          >
            Reset layout
          </button>
        )}
      </div>
      <div className="visually-hidden" role="status">
        {announce}
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for the native drag; the keyboard has the handles */}
      <div
        ref={tray}
        className="tray am-tray"
        data-cols="tables"
        onDragOver={overTray}
        onDrop={dropOnTray}
        onDragLeave={leaveTray}
      >
        {items}
      </div>
    </>
  );
}
