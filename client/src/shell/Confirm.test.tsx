// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Confirm } from './Confirm.tsx';

afterEach(cleanup);

function setup(over: Partial<Parameters<typeof Confirm>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <Confirm
      label="Delete project"
      text="Delete this project?"
      action="Delete project"
      variant="danger"
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onConfirm, onCancel };
}

describe('Confirm', () => {
  it('focuses the safe option, called Cancel by default', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('uses the safe label it is given', () => {
    setup({ safe: 'Keep editing' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('is a labelled group and links the question to the action', () => {
    setup();
    const group = screen.getByRole('group', { name: 'Delete project' });
    expect(group.className).toBe('confirm');
    const action = screen.getByRole('button', { name: 'Delete project' });
    expect(document.getElementById(action.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Delete this project?',
    );
  });

  it('Esc picks the safe option', () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms and cancels on click', () => {
    const { onCancel, onConfirm } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('while busy: buttons are aria-disabled (not disabled) and nothing fires, Esc included', () => {
    const { onCancel, onConfirm } = setup({ busy: true });
    for (const name of ['Delete project', 'Cancel']) {
      const b = screen.getByRole('button', { name });
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect((b as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(b);
    }
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a third answer sits between the action and the safe option, and is the only extra', () => {
    const onChoose = vi.fn();
    const { onConfirm, onCancel } = setup({
      safe: 'Keep writing',
      extra: { label: 'Save for later', onChoose },
    });
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Delete project',
      'Save for later',
      'Keep writing',
    ]);
    const extra = screen.getByRole('button', { name: 'Save for later' });
    // A standard button: the action stays the only coloured one, and the safe option keeps the focus.
    expect(extra.getAttribute('data-variant')).toBeNull();
    expect(extra.getAttribute('aria-describedby')).toBe(
      screen.getByRole('button', { name: 'Delete project' }).getAttribute('aria-describedby'),
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep writing' }));
    fireEvent.click(extra);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('the third answer does nothing while busy', () => {
    const onChoose = vi.fn();
    setup({ busy: true, extra: { label: 'Save for later', onChoose } });
    fireEvent.click(screen.getByRole('button', { name: 'Save for later' }));
    expect(onChoose).not.toHaveBeenCalled();
  });
});
