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

  it('keeps focus on a tick box when its saved details come back', async () => {
    const { rerender } = render(
      <TodoDetailsEditor markdown={md} editable={false} onToggleTask={() => {}} label="Details" />,
    );
    await screen.findByRole('heading', { name: 'Plan' });
    screen.getByRole('checkbox', { name: 'one' }).focus();
    rerender(
      <TodoDetailsEditor
        markdown={md.replace('- [ ] one', '- [x] one')}
        editable={false}
        onToggleTask={() => {}}
        label="Details"
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'one' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(document.activeElement).toBe(box);
  });

  it('while a tick saves, the boxes stay focusable but a press is not sent', async () => {
    const onToggleTask = vi.fn();
    render(
      <TodoDetailsEditor
        markdown={md}
        editable={false}
        onToggleTask={onToggleTask}
        pending
        label="Details"
      />,
    );
    await screen.findByRole('heading', { name: 'Plan' });
    const box = screen.getByRole('checkbox', { name: 'one' }) as HTMLInputElement;
    await waitFor(() => expect(box.getAttribute('aria-disabled')).toBe('true'));
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect(onToggleTask).not.toHaveBeenCalled();
    expect(box.checked).toBe(false);
  });

  it('the Link button turns a brain-path link shown as text into a web link', async () => {
    let out = '';
    render(
      <TodoDetailsEditor
        markdown="Read the [brief](clients/acme/brief.md)."
        editable
        onChange={(m) => {
          out = m;
        }}
        label="Details"
      />,
    );
    const area = await screen.findByRole('textbox', { name: 'Details' });
    // Put the cursor inside "brief".
    const text = area.querySelector('[data-todo-link]')?.firstChild as Text;
    area.focus();
    window.getSelection()?.setBaseAndExtent(text, 2, text, 2);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(await screen.findByLabelText('Web address'), { target: { value: 'example.com/brief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(out).toBe('Read the [brief](https://example.com/brief).'));
  });

  it('a refused address leaves a brain-path link as it was', async () => {
    let out = 'unchanged';
    render(
      <TodoDetailsEditor
        markdown="Read the [brief](clients/acme/brief.md)."
        editable
        onChange={(m) => {
          out = m;
        }}
        label="Details"
      />,
    );
    const area = await screen.findByRole('textbox', { name: 'Details' });
    const text = area.querySelector('[data-todo-link]')?.firstChild as Text;
    area.focus();
    window.getSelection()?.setBaseAndExtent(text, 2, text, 2);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 50));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const field = await screen.findByLabelText('Web address');
    fireEvent.change(field, { target: { value: 'tel:01234567890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByRole('alert');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(out === 'unchanged' || out === 'Read the [brief](clients/acme/brief.md).').toBe(true);
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
