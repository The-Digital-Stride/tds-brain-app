import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { arrange, mergeOrder, moveItem, readOrder, writeOrder } from '../state/card-order.ts';
import { Icon } from './Icon.tsx';

/**
 * Drag-to-reorder for a tray of cards, as the Ad Manager deep dive does it (docs/design-system.md, "Reorder"):
 * native HTML drag and drop from a grip handle, a dashed placeholder where the card would land, Esc cancels (the
 * browser ends the drag), arrows / Home / End on the handle, one hidden status line. The order is saved in this
 * browser's localStorage under `storageKey` (null: not saved, e.g. before we know who is signed in).
 */

const KEY_HINT = 'Use the arrow keys to move it one place, Home or End to move it to the start or end.';

export interface OrderCard {
  id: string;
  /** The card's heading, for the handle's name and the status line. */
  title: string;
}

/** What a card spreads onto its <section>: the drag source. */
export interface CardDragProps {
  'data-card-id': string;
  'data-dragging'?: 'true';
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

export interface CardOrder {
  /** The ids in the person's order. */
  ids: string[];
  /** The grip for a card's head (left of its heading). `title`: the heading as shown now, when it can change. */
  grip: (id: string, title?: string) => ReactNode;
  /** Spread onto the card's <section>. */
  cardProps: (id: string) => CardDragProps;
  /** Spread onto the tray: the drop target. */
  trayProps: {
    ref: React.RefObject<HTMLDivElement | null>;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  };
  /** The cards in order, with the placeholder slotted in while one is in the air. */
  place: (nodes: { id: string; node: ReactNode }[]) => ReactNode[];
  /** The hidden status line ("To-dos moved to 2 of 5"). Render once. */
  status: ReactNode;
  /** True when the order differs from the default. */
  moved: boolean;
  reset: () => void;
}

/**
 * `cards`: the cards on screen now, in their default order. `allIds`: every card that can ever show, in default order
 * (some hide at times, such as Ads approvals), so a hidden card keeps its default place in a saved order.
 */
export function useCardOrder(
  cards: OrderCard[],
  storageKey: string | null,
  allIds: string[] = cards.map((c) => c.id),
): CardOrder {
  const [saved, setSaved] = useState<string[]>(() => (storageKey ? readOrder(storageKey) : []));
  const [announce, setAnnounce] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; height: number; slot: number } | null>(null);
  const focusId = useRef<string | null>(null);
  const tray = useRef<HTMLDivElement>(null);

  // A different person (or the key arriving once we know who): read their own order.
  useEffect(() => {
    setSaved(storageKey ? readOrder(storageKey) : []);
  }, [storageKey]);

  const shown = arrange(cards, saved);
  const ids = shown.map((c) => c.id);
  const moved = ids.some((id, i) => id !== cards[i]?.id);

  // React moves a re-ordered card's node, which drops focus: give it back to the handle that was used.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after every order change on purpose
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    focusId.current = null;
    tray.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`)?.focus();
  }, [ids.join('|')]);

  const save = (next: string[]) => {
    setSaved(next);
    if (storageKey) writeOrder(storageKey, next);
  };

  const placeCard = (id: string, to: number) => {
    const next = moveItem(ids, id, to);
    const at = next.indexOf(id);
    if (at !== ids.indexOf(id)) {
      // Only a real move hands focus back to the grip (a stale target would steal focus on a later re-order).
      focusId.current = id;
      // Merge into the full order, so a card hidden now keeps its saved or default place.
      const full =
        saved.length > 0
          ? arrange(
              allIds.map((x) => ({ id: x })),
              saved,
            ).map((x) => x.id)
          : allIds;
      save(mergeOrder(full, next));
    }
    const title = shown.find((c) => c.id === id)?.title ?? 'Card';
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
    placeCard(id, to);
    return true;
  };

  const endDrag = () => {
    setDrag(null);
    setArmed(null);
  };

  const grip = (id: string, shownTitle?: string) => {
    const at = ids.indexOf(id);
    const title = shownTitle ?? shown[at]?.title ?? 'card';
    const hint = `card-grip-hint-${id}`;
    return (
      <>
        <button
          type="button"
          className="icon-btn card-grip"
          data-size="small"
          data-grip={id}
          data-tip="Move card"
          aria-label={`Move ${title}, ${at + 1} of ${ids.length}`}
          aria-describedby={hint}
          onPointerDown={() => setArmed(id)}
          onPointerUp={() => setArmed(null)}
          onPointerCancel={() => setArmed(null)}
          onKeyDown={(e) => {
            if (keyMove(id, e.key)) e.preventDefault();
          }}
        >
          <Icon name="grip" size={16} />
        </button>
        <span id={hint} className="visually-hidden">
          {KEY_HINT}
        </span>
      </>
    );
  };

  const cardProps = (id: string): CardDragProps => ({
    'data-card-id': id,
    ...(drag?.id === id ? { 'data-dragging': 'true' as const } : {}),
    draggable: armed === id,
    onDragStart: (e) => {
      // Only a drag that began on the grip moves the card (text stays selectable; a link dragged out of a card is
      // the browser's own drag and is left alone).
      if (armed !== id || e.target !== e.currentTarget) return;
      const card = e.currentTarget;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      const rect = card.getBoundingClientRect();
      e.dataTransfer.setDragImage(card, e.clientX - rect.left, e.clientY - rect.top);
      const from = ids.indexOf(id);
      // Hide the card once the browser has taken its picture; the placeholder shows where it would land.
      setTimeout(() => setDrag({ id, height: rect.height, slot: from }), 0);
    },
    onDragEnd: endDrag,
  });

  const trayProps = {
    ref: tray,
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-card-id]');
      if (!card || card.dataset.cardId === drag.id) return;
      const rest = ids.filter((x) => x !== drag.id);
      const k = rest.indexOf(card.dataset.cardId ?? '');
      if (k < 0) return;
      const r = card.getBoundingClientRect();
      const full = tray.current ? r.width > tray.current.clientWidth * 0.7 : false;
      const after = full ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      const slot = after ? k + 1 : k;
      if (slot !== drag.slot) setDrag({ ...drag, slot });
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      if (!drag) return;
      e.preventDefault();
      // No slot (the pointer left the cards and came back over a gap): nothing moves.
      if (drag.slot >= 0) placeCard(drag.id, drag.slot);
      endDrag();
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null))
        setDrag((d) => (d ? { ...d, slot: -1 } : d));
    },
  };

  const place = (nodes: { id: string; node: ReactNode }[]): ReactNode[] => {
    const byId = new Map(nodes.map((n) => [n.id, n.node]));
    const ordered = ids.filter((id) => byId.has(id)).map((id) => ({ id, node: byId.get(id) }));
    if (!drag || drag.slot < 0) return ordered.map((n) => n.node);
    // The card in the air stays in the list (hidden) so the browser's drag survives; the placeholder goes before
    // the card that would follow it.
    const rest = ordered.filter((n) => n.id !== drag.id);
    const before = rest[drag.slot]?.id ?? null;
    const drop = (
      <div key="card-drop" className="card-drop" aria-hidden="true" style={{ minHeight: drag.height }} />
    );
    const out = ordered.flatMap((n) => (n.id === before ? [drop, n.node] : [n.node]));
    return before === null ? [...out, drop] : out;
  };

  return {
    ids,
    grip,
    cardProps,
    trayProps,
    place,
    status: (
      <div className="visually-hidden" role="status">
        {announce}
      </div>
    ),
    moved,
    reset: () => {
      // The Reset button goes away with the change: focus lands on the first card's grip, not the page start.
      focusId.current = cards[0]?.id ?? null;
      save([]);
      setAnnounce('Card order reset');
    },
  };
}
