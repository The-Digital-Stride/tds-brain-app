// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import TodoDetailsEditor from './TodoDetailsEditor.tsx';

// jsdom has no layout, which ProseMirror measures when it scrolls; stub it so the real editor can run here.
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

afterEach(cleanup);

const md = '## Plan\n\n- [ ] one\n- [x] two\n\nSome **bold** text.';

describe('TodoDetailsEditor (the real editor and converter)', () => {
  it('shows markdown formatted when reading', async () => {
    render(<TodoDetailsEditor markdown={md} editable={false} label="Details" />);
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(document.querySelectorAll('li[data-checked]')).toHaveLength(2);
    expect(document.querySelector('strong')?.textContent).toBe('bold');
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('reports a tick pressed while reading, by position, without changing the document', async () => {
    const onToggleTask = vi.fn();
    render(<TodoDetailsEditor markdown={md} editable={false} onToggleTask={onToggleTask} label="Details" />);
    await screen.findByRole('heading', { name: 'Plan' });
    const boxes = document.querySelectorAll<HTMLInputElement>('li[data-checked] input[type="checkbox"]');
    fireEvent.click(boxes[1] as HTMLInputElement);
    expect(onToggleTask).toHaveBeenCalledWith(1, false);
    fireEvent.click(boxes[0] as HTMLInputElement);
    expect(onToggleTask).toHaveBeenLastCalledWith(0, true);
    expect((boxes[0] as HTMLInputElement).checked).toBe(false);
  });

  it('offers the seven toolbar buttons when editing, each with a name', async () => {
    render(<TodoDetailsEditor markdown={md} editable onChange={() => {}} label="Details" />);
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' });
    const names = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Heading',
      'Body text',
      'Bullet list',
      'Numbered list',
      'Tick list',
      'Bold',
      'Link',
    ]);
  });

  it('opens an inline field for a link, never a browser prompt, and refuses an unsafe address', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    render(<TodoDetailsEditor markdown="text" editable onChange={() => {}} label="Details" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    const field = await screen.findByLabelText('Web address');
    fireEvent.change(field, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/http, https or mailto/);
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Web address')).toBeNull());
  });
});

describe('TodoDetailsEditor: look and keys', () => {
  it('injects no style tag (the app blocks inline styles)', async () => {
    render(<TodoDetailsEditor markdown="text" editable onChange={() => {}} label="Details" />);
    await screen.findByRole('toolbar');
    expect(document.querySelector('style[data-tiptap-style]')).toBeNull();
  });

  it('the toolbar is one tab stop and the arrow keys, Home and End move along it', async () => {
    render(<TodoDetailsEditor markdown="text" editable onChange={() => {}} label="Details" />);
    const bar = await screen.findByRole('toolbar', { name: 'Formatting' });
    const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0]?.focus();
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.tabIndex).toBe(0);
    expect(buttons[0]?.tabIndex).toBe(-1);
    fireEvent.keyDown(buttons[1] as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it('tick boxes that cannot be pressed are disabled, and each is named by its item', async () => {
    const { unmount } = render(<TodoDetailsEditor markdown={md} editable={false} label="Details" />);
    await screen.findByRole('heading', { name: 'Plan' });
    await waitFor(() => {
      const boxes = document.querySelectorAll<HTMLInputElement>('li[data-checked] input');
      expect([...boxes].every((b) => b.disabled)).toBe(true);
    });
    expect(screen.getByRole('checkbox', { name: 'one' })).toBeTruthy();
    unmount();
    render(<TodoDetailsEditor markdown={md} editable={false} onToggleTask={() => {}} label="Details" />);
    await screen.findByRole('heading', { name: 'Plan' });
    await waitFor(() => {
      const boxes = document.querySelectorAll<HTMLInputElement>('li[data-checked] input');
      expect([...boxes].every((b) => !b.disabled)).toBe(true);
    });
  });

  it('a kept block has its hint as real text, linked by aria-describedby', async () => {
    render(
      <TodoDetailsEditor
        markdown={'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |'}
        editable
        onChange={() => {}}
        label="Details"
      />,
    );
    const kept = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-todo-kept]');
      if (!el) throw new Error('no kept block yet');
      return el;
    });
    const hint = document.getElementById(kept.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Edit this part in a chat.');
  });
});
