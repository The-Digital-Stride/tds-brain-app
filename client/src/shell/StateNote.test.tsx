// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StateNote } from './StateNote.tsx';

afterEach(cleanup);

describe('StateNote', () => {
  it('empty shows its words and no button', () => {
    render(<StateNote kind="empty">Nothing here yet.</StateNote>);
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('loading defaults to "Loading…" and is a status', () => {
    render(<StateNote kind="loading" />);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  it('loading takes its own words', () => {
    render(<StateNote kind="loading">Finding files…</StateNote>);
    expect(screen.getByRole('status').textContent).toBe('Finding files…');
  });

  it('error is an alert; Try again calls onRetry', () => {
    const onRetry = vi.fn();
    render(
      <StateNote kind="error" onRetry={onRetry}>
        Could not load.
      </StateNote>,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not load.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('error without onRetry has no button', () => {
    render(<StateNote kind="error">Could not load.</StateNote>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
