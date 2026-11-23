import { useId, useRef, useState } from 'react';
import {
  LEVEL_TIERS,
  LEVEL_TIERS_ORDER,
  type LevelTier,
  type TurnLevel,
} from '../../../shared/levels-contract.ts';
import { aliasName, keptLineText, levelLineText } from '../format.ts';
import { Icon } from '../shell/Icon.tsx';

/**
 * The line under the message box in automatic mode: "Standard · picked for this chat", a "Why?"
 * that shows the reason, model and effort, and a small menu to change the level for this chat.
 * Renders nothing when no tier line applies (manual mode): the caller then keeps the v0.19.0 line.
 */
export function LevelLine({
  level,
  onPick,
}: {
  level: TurnLevel;
  /** A tier for the rest of this chat, or null for "Back to automatic". */
  onPick: (tier: LevelTier | null) => void;
}) {
  const text = levelLineText(level);
  const kept = keptLineText(level);
  const spec = level.tier ? LEVEL_TIERS[level.tier] : null;
  const [why, setWhy] = useState(false);
  const [menu, setMenu] = useState(false);
  const whyId = useId();
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  if (!text) return null;
  const closeMenu = () => {
    setMenu(false);
    menuButton.current?.focus();
  };
  return (
    <div className="level-line">
      <p className="engine-line level-row">
        <span className="engine-text">
          <span className="visually-hidden">Level: </span>
          {text.tier ? <strong>{text.tier}</strong> : null}
          {text.tier ? ' · ' : null}
          {text.note}
        </span>
        <button
          type="button"
          className="btn"
          data-variant="quiet"
          data-size="small"
          aria-expanded={why}
          data-chevron
          aria-controls={whyId}
          onClick={() => setWhy((o) => !o)}
        >
          <Icon name="chevron" size={14} />
          Why?
        </button>
        {level.source.kind === 'skill-own' ? null : (
          <button
            ref={menuButton}
            type="button"
            className="btn"
            data-variant="quiet"
            data-size="small"
            data-chevron
            aria-label="Change the level for this chat"
            aria-expanded={menu}
            aria-controls={menuId}
            onClick={() => setMenu((o) => !o)}
          >
            <Icon name="chevron" size={14} />
            Change
          </button>
        )}
      </p>
      {kept ? <p className="level-why level-kept">{kept}</p> : null}
      <p className="level-why" id={whyId} hidden={!why}>
        {text.why}
        {spec ? ` It runs on ${aliasName(spec.model)} at ${spec.effort.toLowerCase()} effort.` : ''}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border; the label names the group. */}
      <div
        className="popover level-menu"
        id={menuId}
        hidden={!menu}
        role="group"
        aria-label="Level for this chat"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeMenu();
          }
        }}
      >
        {LEVEL_TIERS_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className="menu-row"
            aria-current={level.tier === t ? 'true' : undefined}
            onClick={() => {
              onPick(t);
              closeMenu();
            }}
          >
            <span className="level-option-name">{LEVEL_TIERS[t].label} for this chat</span>
            <span className="level-option-blurb">{LEVEL_TIERS[t].blurb}</span>
          </button>
        ))}
        {level.source.kind === 'chat' ? (
          <button
            type="button"
            className="menu-row"
            onClick={() => {
              onPick(null);
              closeMenu();
            }}
          >
            <span className="level-option-name">Back to automatic</span>
            <span className="level-option-blurb">The app picks again from your next message</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The quiet offer after a skill that has no level: only people who can set team levels see it. */
export function LevelOffer({
  skill,
  usedTier,
  onSet,
  onDismiss,
}: {
  skill: string;
  /** The tier this chat used, when known. */
  usedTier: LevelTier | null;
  onSet: (tier: LevelTier) => void;
  onDismiss: () => void;
}) {
  const used = usedTier ? ` This chat used ${LEVEL_TIERS[usedTier].label}.` : '';
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border; the label names the group.
    <div
      className="notice level-offer"
      data-shape="box"
      data-level="info"
      role="group"
      aria-label={`Team level for /${skill}`}
    >
      <p className="level-offer-text">{`Set a team level for /${skill}?${used}`}</p>
      <span className="notice-actions">
        {LEVEL_TIERS_ORDER.map((t) => (
          <button key={t} type="button" className="btn" data-size="small" onClick={() => onSet(t)}>
            {LEVEL_TIERS[t].label}
          </button>
        ))}
        <button type="button" className="btn" data-variant="quiet" data-size="small" onClick={onDismiss}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
