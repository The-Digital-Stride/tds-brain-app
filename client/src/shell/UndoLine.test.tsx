// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pressedByKeyboard, UNDO_MS, UndoLine } from './UndoLine.tsx';

afterEach(cleanup);

function setup(extra: Partial<Parameters<typeof UndoLine>[0]> = {}) {
  const fns = { onUndo: vi.fn(), onPause: vi.fn(), onResume: vi.fn() };
  const view = render(
    <ul>
      <UndoLine
        as="row"
        text="“Weekly report” deleted."
        undoLabel="Undo deleting “Weekly report”"
        {...fns}
        {...extra}
      />
      <li>
        <button type="button">Elsewhere</button>
      </li>
    </ul>,
  );
  const line = view.container.querySelector('.undo-line') as HTMLElement;
  return { ...fns, line, view };
}

describe('UndoLine', () => {
  it('is ten seconds, one value for every host', () => {
    expect(UNDO_MS).toBe(10_000);
  });

  it('shows the text, a quiet small Undo named for what it undoes, and a hidden countdown bar', () => {
    const { line } = setup();
    expect(line.tagName).toBe('LI');
    expect(line.textContent).toContain('“Weekly report” deleted.');
    const undo = screen.getByRole('button', { name: 'Undo deleting “Weekly report”' });
    expect(undo.textContent).toBe('Undo');
    expect(undo.dataset.variant).toBe('quiet');
    expect(undo.dataset.size).toBe('small');
    const bar = line.querySelector('.undo-line-bar') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(bar.style.animationDuration).toBe(`${UNDO_MS}ms`);
    // It never announces itself: the host's status line does.
    expect(line.closest('[role="status"]')).toBeNull();
    expect(line.getAttribute('role')).toBeNull();
  });

  it('a strip is a div', () => {
    render(
      <UndoLine
        as="strip"
        text="a.png deleted."
        undoLabel="Undo deleting a.png"
        onUndo={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
      />,
    );
    expect(document.querySelector('.undo-line')?.tagName).toBe('DIV');
  });

  it('pauses on pointer, and resumes when it leaves', () => {
    const { line, onPause, onResume } = setup();
    fireEvent.mouseEnter(line);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(line.querySelector('.undo-line-bar')?.getAttribute('data-paused')).toBe('true');
    fireEvent.mouseLeave(line);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(line.querySelector('.undo-line-bar')?.getAttribute('data-paused')).toBeNull();
  });

  it('pauses on focus, and resumes when focus leaves the line', () => {
    const { line, onPause, onResume } = setup();
    const undo = screen.getByRole('button', { name: /Undo/ });
    fireEvent.focus(undo);
    expect(onPause).toHaveBeenCalledTimes(1);
    fireEvent.blur(undo, { relatedTarget: screen.getByRole('button', { name: 'Elsewhere' }) });
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(line).toBeTruthy();
  });

  it('resumes only when both pointer and focus have left', () => {
    const { line, onPause, onResume } = setup();
    const undo = screen.getByRole('button', { name: /Undo/ });
    fireEvent.focus(undo);
    fireEvent.mouseEnter(line);
    fireEvent.mouseLeave(line);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
    fireEvent.mouseEnter(line);
    fireEvent.blur(undo, { relatedTarget: null });
    expect(onResume).not.toHaveBeenCalled();
    fireEvent.mouseLeave(line);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('restarts the bar in full on resume (a new element)', () => {
    const { line } = setup();
    const first = line.querySelector('.undo-line-bar');
    fireEvent.mouseEnter(line);
    fireEvent.mouseLeave(line);
    expect(line.querySelector('.undo-line-bar')).not.toBe(first);
  });

  it('Undo calls onUndo, but not the second click of a double-click', () => {
    const { onUndo } = setup();
    const undo = screen.getByRole('button', { name: /Undo/ });
    fireEvent.click(undo, { detail: 2 });
    expect(onUndo).not.toHaveBeenCalled();
    fireEvent.click(undo, { detail: 1 });
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('while sending shows "Sending…" with no button and no bar', () => {
    const { line } = setup({ sending: true });
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(line.textContent).toContain('Sending…');
    expect(line.querySelector('.undo-line-bar')).toBeNull();
  });

  it('takes focus only when asked to', () => {
    setup();
    expect(document.activeElement).toBe(document.body);
    cleanup();
    setup({ focusOnMount: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Undo/ }));
  });
});

describe('pressedByKeyboard', () => {
  it('tells a keyboard press from a pointer one', () => {
    const { view } = setup();
    const other = view.getByRole('button', { name: 'Elsewhere' });
    fireEvent.pointerDown(other);
    fireEvent.click(other, { detail: 1 });
    expect(pressedByKeyboard()).toBe(false);
    fireEvent.keyDown(other, { key: 'Enter' });
    fireEvent.click(other, { detail: 0 });
    expect(pressedByKeyboard()).toBe(true);
    fireEvent.mouseDown(other);
    expect(pressedByKeyboard()).toBe(false);
    // A screen reader's click has no pointer and counts no clicks.
    fireEvent.click(other, { detail: 0 });
    expect(pressedByKeyboard()).toBe(true);
  });
});
