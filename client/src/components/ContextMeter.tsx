import { type ContextEvent, meterBand } from '../../../shared/context-contract.ts';

/** What the meter says beside the bar. Never colour alone: the band is also in the words. */
export function meterText(reading: ContextEvent): string {
  const percent = Math.max(0, reading.percent);
  if (meterBand(percent) === 'full' && reading.autoCompact)
    return 'Nearly full: Claude will summarise the earlier messages soon';
  return `Chat ${percent}% full`;
}

/**
 * How full this chat is, by Claude's own count: a thin bar and a few words under the message box.
 * Hidden until the first reading. Amber from 60%, red from 85%.
 */
export function ContextMeter({ reading }: { reading: ContextEvent | null }) {
  if (!reading) return null;
  const percent = Math.max(0, reading.percent);
  const band = meterBand(percent);
  const name = reading.autoCompact
    ? `Chat ${percent}% full before Claude summarises it`
    : `Chat ${percent}% full`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native meter can't carry the band colours or the words beside it.
    <div
      className="context-meter"
      data-band={band}
      role="meter"
      aria-label={name}
      aria-valuenow={Math.min(percent, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={meterText(reading)}
    >
      <span className="context-meter-bar" aria-hidden="true">
        <span className="context-meter-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </span>
      <span className="context-meter-text" aria-hidden="true">
        {meterText(reading)}
      </span>
    </div>
  );
}
