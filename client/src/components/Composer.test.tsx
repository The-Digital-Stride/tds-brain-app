// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.tsx';

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn().mockResolvedValue(true);
  render(
    <Composer
      initial=""
      skill={null}
      disabledReason={null}
      onSend={onSend}
      autoFocus={false}
      focusSignal={0}
      {...over}
    />,
  );
  const box = screen.getByLabelText('Message to Claude');
  return { onSend, box };
}

describe('Composer keys', () => {
  it('Enter sends', async () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Hello', []));
  });

  it('Shift+Enter makes a new line and does not send', () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: 'Hello' } });
    const notPrevented = fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(notPrevented).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter during input-method composition does not send', () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send while blocked', () => {
    const { onSend, box } = setup({ disabledReason: 'Claude is working.' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('puts the chosen skill in front of the text', async () => {
    const skill = { name: 'time', title: 'Log my time' } as never;
    const { onSend } = setup({ skill });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('/time', []));
  });
});

describe('Composer tools and pending sends', () => {
  it('shows the tools slot in the foot', () => {
    setup({ tools: <select aria-label="Client" /> });
    expect(screen.getByLabelText('Client').closest('.composer-foot')).toBeTruthy();
  });

  it('stays read-only and keeps its text while onSend is pending, then clears on true', async () => {
    let finish: (ok: boolean) => void = () => {};
    const { box } = setup({ onSend: () => new Promise<boolean>((r) => (finish = r)) });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect((box as HTMLTextAreaElement).readOnly).toBe(true));
    expect((box as HTMLTextAreaElement).value).toBe('Hello');
    finish(true);
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''));
  });

  it('keeps the text when onSend resolves false', async () => {
    const { box } = setup({ onSend: () => Promise.resolve(false) });
    fireEvent.change(box, { target: { value: 'Hello' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect((box as HTMLTextAreaElement).readOnly).toBe(false));
    expect((box as HTMLTextAreaElement).value).toBe('Hello');
  });
});

describe('Send and Stop (Ian, 2026-11-14)', () => {
  it('shows a green Send while Claude is idle', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('data-variant')).toBe('send');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('swaps Send for a red Stop while Claude works, which stops it and says so', async () => {
    const onStop = vi.fn();
    setup({ onStop, disabledReason: 'Claude is working' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop.getAttribute('data-variant')).toBe('stop');
    expect(stop.hasAttribute('disabled')).toBe(false);
    fireEvent.click(stop, { detail: 1 });
    expect(onStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopping'));
    // From the keyboard (no click count) it works too.
    fireEvent.click(stop, { detail: 0 });
    expect(onStop).toHaveBeenCalledTimes(2);
  });

  it('ignores the second click of a double-click on Send, which lands on Stop', () => {
    const onStop = vi.fn();
    setup({ onStop, disabledReason: 'Claude is working' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }), { detail: 2 });
    expect(onStop).not.toHaveBeenCalled();
  });

  it('keeps the same button, so focus on Send stays put when it becomes Stop', () => {
    const props = {
      initial: '',
      skill: null,
      onSend: vi.fn().mockResolvedValue(true),
      autoFocus: false,
      focusSignal: 0,
    };
    const { rerender } = render(<Composer {...props} disabledReason={null} />);
    const send = screen.getByRole('button', { name: 'Send' });
    rerender(<Composer {...props} disabledReason="Claude is working" onStop={() => {}} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBe(send);
  });

  it('moves focus to the message box when Stop turns back into a disabled Send', () => {
    const props = {
      initial: '',
      skill: null,
      onSend: vi.fn().mockResolvedValue(true),
      autoFocus: false,
      focusSignal: 0,
    };
    const { rerender } = render(<Composer {...props} disabledReason="Claude is working" onStop={() => {}} />);
    screen.getByRole('button', { name: 'Stop' }).focus();
    rerender(<Composer {...props} disabledReason={null} />);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Message to Claude'));
  });
});
