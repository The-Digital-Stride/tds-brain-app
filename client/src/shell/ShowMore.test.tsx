// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowMore } from './ShowMore.tsx';

afterEach(cleanup);

const noun = { one: 'to-do', many: 'to-dos' };

describe('ShowMore', () => {
  it('says "Show N more {noun}", singular for one', () => {
    const { rerender } = render(
      <ShowMore expanded={false} count={4} noun={noun} wording="more" onToggle={() => {}} />,
    );
    expect(screen.getByRole('button').textContent).toBe('Show 4 more to-dos');
    rerender(<ShowMore expanded={false} count={1} noun={noun} wording="more" onToggle={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('Show 1 more to-do');
  });

  it('says "Show all N {noun}" with a grouped number', () => {
    render(<ShowMore expanded={false} count={1200} noun={noun} wording="all" onToggle={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('Show all 1,200 to-dos');
  });

  it('says "Show fewer" when expanded, keeping the noun for screen readers', () => {
    render(<ShowMore expanded count={4} noun={noun} wording="more" onToggle={() => {}} />);
    const b = screen.getByRole('button');
    expect(b.textContent).toBe('Show fewer to-dos');
    expect(screen.getByRole('button', { name: 'Show fewer to-dos' })).toBe(b);
    expect(b.querySelector('.visually-hidden')?.textContent).toBe('to-dos');
  });

  it('carries aria-expanded and toggles on click', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <ShowMore expanded={false} count={4} noun={noun} wording="more" onToggle={onToggle} />,
    );
    const b = screen.getByRole('button');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<ShowMore expanded count={4} noun={noun} wording="more" onToggle={onToggle} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});
