// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextEvent } from '../../../shared/context-contract.ts';
import { ContextMeter } from './ContextMeter.tsx';

afterEach(cleanup);

const reading = (percent: number, autoCompact = true): ContextEvent => ({
  type: 'context',
  usedTokens: percent * 1000,
  limitTokens: 100_000,
  windowTokens: 200_000,
  percent,
  autoCompact,
  source: 'engine',
  at: 1,
});

describe('ContextMeter', () => {
  it('is hidden before the first reading', () => {
    const { container } = render(<ContextMeter reading={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('says how full the chat is, with an accessible name and value', () => {
    render(<ContextMeter reading={reading(42)} />);
    const meter = screen.getByRole('meter', { name: 'Chat 42% full before Claude summarises it' });
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
    expect(meter.textContent).toBe('Chat 42% full');
    expect(meter.getAttribute('data-band')).toBe('ok');
  });

  it('turns amber from 60% and red from 85%, with words for the red band', () => {
    const { rerender } = render(<ContextMeter reading={reading(59)} />);
    expect(screen.getByRole('meter').getAttribute('data-band')).toBe('ok');
    rerender(<ContextMeter reading={reading(60)} />);
    expect(screen.getByRole('meter').getAttribute('data-band')).toBe('warn');
    rerender(<ContextMeter reading={reading(85)} />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('data-band')).toBe('full');
    expect(meter.textContent).toBe('Nearly full: Claude will summarise the earlier messages soon');
  });

  it('keeps the bar inside its track above 100%', () => {
    render(<ContextMeter reading={reading(120)} />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
  });

  it('does not promise a summary when auto-summarising is off', () => {
    render(<ContextMeter reading={reading(90, false)} />);
    expect(screen.getByRole('meter').textContent).toBe('Chat 90% full');
  });
});
