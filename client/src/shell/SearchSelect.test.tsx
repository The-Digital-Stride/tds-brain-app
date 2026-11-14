// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPicker, pickerText, pickOption } from '../test/pick.ts';
import { place, SearchSelect } from './SearchSelect.tsx';
import type { PickOption } from './search-select.ts';

const fixed: PickOption[] = [
  { value: '@auto', label: 'Auto' },
  { value: '@none', label: 'No client' },
];
const names = [
  'Acme Heating',
  'Bolt Plumbing',
  'Cedar Roofing',
  'Delta Glass',
  'Echo Print',
  'Foxglove',
  'Gamma Tiles',
  'Harbour Fish',
  'Ivy Care',
];
const clients: PickOption[] = [
  ...names.map((n) => ({
    value: n.split(' ')[0]?.toLowerCase() ?? n,
    label: n,
    terms: [n.slice(0, 2).toLowerCase()],
    group: 'Clients',
  })),
  {
    value: 'urban-cooling',
    label: 'Urban Cooling',
    terms: ['urban-cooling', 'UC', 'Air Con'],
    group: 'Clients',
  },
];
const options = [...fixed, ...clients];

function Harness(props: {
  initial?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  recentKey?: string;
  opts?: PickOption[];
  placeholder?: string;
}) {
  const [value, setValue] = useState(props.initial ?? '@auto');
  return (
    <>
      <label htmlFor="c">Client</label>
      <SearchSelect
        id="c"
        value={value}
        options={props.opts ?? options}
        disabled={props.disabled}
        recentKey={props.recentKey}
        placeholder={props.placeholder}
        onChange={(v) => {
          props.onChange?.(v);
          setValue(v);
        }}
      />
    </>
  );
}

const box = () => screen.getByRole('combobox', { name: 'Client' }) as HTMLInputElement;
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(box(), { key: k, ...init });
const send = (ev: Event) => act(() => void box().dispatchEvent(ev));
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const rows = () => screen.queryAllByRole('option').map((o) => (o.textContent ?? '').replace(/, chosen$/, ''));
const activeName = () => {
  const id = box().getAttribute('aria-activedescendant');
  return id ? (document.getElementById(id)?.textContent ?? '').replace(/, chosen$/, '') : null;
};

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('SearchSelect', () => {
  it('shows the chosen label at rest and the placeholder when the value is not an option', () => {
    const { unmount } = render(<Harness initial="delta" />);
    expect(box().value).toBe('Delta Glass');
    unmount();
    render(<Harness initial="gone" placeholder="Another client…" />);
    expect(box().value).toBe('');
    expect(box().placeholder).toBe('Another client…');
  });

  it('opens on click and ArrowDown, not on focus, and lists every option', () => {
    render(<Harness />);
    act(() => box().focus());
    expect(screen.queryByRole('listbox')).toBeNull();
    key('ArrowDown');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(rows()).toHaveLength(options.length);
    key('Escape');
    fireEvent.click(box());
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('typing filters, and a code finds the client with its label first', () => {
    render(<Harness />);
    openPicker('Client');
    type('uc');
    expect(rows()[0]).toBe('Urban Cooling');
    type('air con');
    expect(rows()).toEqual(['Urban Cooling']);
    type('no');
    expect(rows()).toContain('No client');
  });

  it('draws matching letters in <mark>', () => {
    render(<Harness />);
    openPicker('Client');
    type('urb');
    const row = screen.getByRole('option', { name: /Urban Cooling/ });
    expect(row.querySelector('mark')?.textContent).toBe('Urb');
  });

  it('says "Nothing matches" as a line that is not an option', () => {
    render(<Harness />);
    openPicker('Client');
    type('zzzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(within(screen.getByRole('listbox')).getByText('Nothing matches')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Nothing matches');
  });

  it('wires the ARIA 1.2 combobox pattern, and the status counts results', () => {
    render(<Harness />);
    expect(box().getAttribute('role')).toBe('combobox');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(box().getAttribute('aria-autocomplete')).toBe('list');
    expect(box().getAttribute('autocomplete')).toBe('off');
    openPicker('Client');
    const list = screen.getByRole('listbox');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('aria-label')).toBe('Client');
    expect(
      document.getElementById(box().getAttribute('aria-activedescendant') ?? '')?.getAttribute('role'),
    ).toBe('option');
    expect(screen.getByRole('group', { name: 'Clients' })).toBeTruthy();
    type('urban');
    expect(screen.getByRole('status').textContent).toBe('1 result');
    type('a');
    expect(screen.getByRole('status').textContent).toMatch(/^\d+ results$/);
    expect(
      screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('starts on the current value, marks it chosen, and Up/Down do not wrap', () => {
    render(<Harness initial="bolt" />);
    openPicker('Client');
    expect(activeName()).toBe('Bolt Plumbing');
    expect(screen.getByRole('option', { name: 'Bolt Plumbing, chosen' })).toBeTruthy();
    key('ArrowDown');
    expect(activeName()).toBe('Cedar Roofing');
    key('Home');
    expect(activeName()).toBe('Auto');
    key('ArrowUp');
    expect(activeName()).toBe('Auto');
    key('End');
    expect(activeName()).toBe('Urban Cooling');
    key('ArrowDown');
    expect(activeName()).toBe('Urban Cooling');
  });

  it('Home and End move the caret, not the list, once there is a query', () => {
    render(<Harness />);
    openPicker('Client');
    type('a');
    const first = activeName();
    const ev = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    send(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(activeName()).toBe(first);
  });

  it('Enter picks the active option once and closes, never submitting a form', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Harness onChange={onChange} />
        <button type="submit">Go</button>
      </form>,
    );
    openPicker('Client');
    type('urb');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    send(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('urban-cooling');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box().value).toBe('Urban Cooling');
    // Closed, Enter opens (and still prevents the submit).
    const again = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    send(again);
    expect(again.defaultPrevented).toBe(true);
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('ignores Enter while an input method is composing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    openPicker('Client');
    type('urb');
    key('Enter', { isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('only calls onChange when the value changes', () => {
    const onChange = vi.fn();
    render(<Harness initial="bolt" onChange={onChange} />);
    pickOption('Client', 'Bolt Plumbing');
    expect(onChange).not.toHaveBeenCalled();
    pickOption('Client', 'Cedar Roofing');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('cedar');
  });

  it('Escape closes, restores the label and stops the event only when open', () => {
    const outer = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a plain ancestor listening for the key is the case under test
      <div onKeyDown={outer}>
        <Harness initial="bolt" />
      </div>,
    );
    openPicker('Client');
    type('zz');
    const open = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    send(open);
    expect(open.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box().value).toBe('Bolt Plumbing');
    const shut = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    send(shut);
    expect(shut.defaultPrevented).toBe(false);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('Tab commits a typed match, and restores when nothing was typed', () => {
    const onChange = vi.fn();
    render(<Harness initial="bolt" onChange={onChange} />);
    openPicker('Client');
    type('delta');
    key('Tab');
    expect(onChange).toHaveBeenCalledWith('delta');
    expect(box().value).toBe('Delta Glass');
    openPicker('Client');
    type('');
    key('Tab');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(box().value).toBe('Delta Glass');
  });

  it('an emptied box is not a choice: blur restores the label', () => {
    const onChange = vi.fn();
    render(<Harness initial="bolt" onChange={onChange} />);
    openPicker('Client');
    type('');
    expect(activeName()).toBe('Bolt Plumbing');
    fireEvent.blur(box());
    expect(box().value).toBe('Bolt Plumbing');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps focus on the box when the list is pressed (mousedown is prevented)', () => {
    render(<Harness />);
    openPicker('Client');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    screen.getByRole('listbox').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const onRow = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    screen.getAllByRole('option')[0]?.dispatchEvent(onRow);
    expect(onRow.defaultPrevented).toBe(true);
  });

  it('selects the box text on focus, and a click does not undo it', () => {
    render(<Harness initial="bolt" />);
    fireEvent.mouseDown(box());
    act(() => box().focus());
    expect(box().selectionStart).toBe(0);
    expect(box().selectionEnd).toBe('Bolt Plumbing'.length);
    const up = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
    send(up);
    expect(up.defaultPrevented).toBe(true);
  });

  it('selects the label again after a pick or Escape, so typing replaces it', async () => {
    render(<Harness />);
    act(() => box().focus());
    fireEvent.click(box());
    fireEvent.change(box(), { target: { value: 'uc' } });
    key('Enter');
    expect(box().value).toBe('Urban Cooling');
    // Still focused and closed: the label is selected, ready to be typed over.
    await act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect([box().selectionStart, box().selectionEnd]).toEqual([0, 'Urban Cooling'.length]);
    // A click on the focused box (the caret lands at the end) and ArrowDown both reselect it.
    box().setSelectionRange(13, 13);
    fireEvent.click(box());
    expect([box().selectionStart, box().selectionEnd]).toEqual([0, 'Urban Cooling'.length]);
    key('Escape');
    box().setSelectionRange(13, 13);
    key('ArrowDown');
    expect([box().selectionStart, box().selectionEnd]).toEqual([0, 'Urban Cooling'.length]);
    // Typing opens the list without selecting what was typed.
    key('Escape');
    fireEvent.change(box(), { target: { value: 'a' } });
    expect(box().value).toBe('a');
    expect(box().selectionStart).toBe(1);
  });

  it('a disabled picker cannot open', () => {
    render(<Harness disabled />);
    expect(box().disabled).toBe(true);
    fireEvent.click(box());
    key('ArrowDown');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows Recent after a pick, only for grouped options, read when the list opens', () => {
    render(<Harness recentKey="clients" />);
    openPicker('Client');
    expect(screen.queryByText('Recent')).toBeNull();
    key('Escape');
    pickOption('Client', 'Echo Print');
    pickOption('Client', 'Auto');
    openPicker('Client');
    const recent = screen.getByRole('group', { name: 'Recent' });
    expect(
      within(recent)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Echo Print']);
    // The same client shows again in its A-Z group.
    expect(screen.getAllByRole('option', { name: 'Echo Print' })).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('tds-brain-recent.clients') ?? '[]')).toEqual(['echo']);
  });

  it('shows the check on the current value in Recent and A-Z alike', () => {
    render(<Harness recentKey="clients" />);
    pickOption('Client', 'Echo Print');
    openPicker('Client');
    const chosen = screen.getAllByRole('option', { name: 'Echo Print, chosen' });
    expect(chosen).toHaveLength(2);
    for (const c of chosen) expect(c.querySelector('svg')).toBeTruthy();
  });

  it('no Recent without a recentKey', () => {
    render(<Harness />);
    pickOption('Client', 'Echo Print');
    openPicker('Client');
    expect(screen.queryByText('Recent')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('pickerText reads the box', () => {
    render(<Harness initial="bolt" />);
    expect(pickerText('Client')).toBe('Bolt Plumbing');
  });
});

describe('place', () => {
  const at = (w: number, h: number) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(w);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(h);
  };
  afterEach(() => vi.restoreAllMocks());

  it('opens below, at least 260px wide, when there is room', () => {
    at(1280, 800);
    expect(place({ top: 100, bottom: 132, left: 400, width: 180 })).toEqual({
      left: 400,
      width: 260,
      top: 136,
      maxHeight: 320,
    });
  });

  it('opens above when there is little room below and more above', () => {
    at(900, 420);
    expect(place({ top: 230, bottom: 262, left: 200, width: 180 })).toEqual({
      left: 200,
      width: 260,
      bottom: 420 - 230 + 4,
      maxHeight: 218,
    });
  });

  it('stays below when above has even less room', () => {
    at(900, 300);
    expect(place({ top: 100, bottom: 132, left: 200, width: 180 }).top).toBe(136);
  });

  it('keeps 8px inside the window edges', () => {
    at(400, 800);
    const p = place({ top: 100, bottom: 132, left: 300, width: 180 });
    expect(p.left + p.width).toBe(392);
    at(240, 800);
    expect(place({ top: 100, bottom: 132, left: 0, width: 100 })).toMatchObject({ left: 8, width: 224 });
  });
});
