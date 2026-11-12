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
