// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../../shared/contract.ts';

const store = vi.hoisted(() => ({
  deleteFile: vi.fn(),
  hiddenFileIds: new Set<string>() as ReadonlySet<string>,
  fileDeleteBusy: false,
  heldFiles: [],
  boot: { prefs: { lastClient: null as string | null } },
}));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { LibraryBrowser } = await import('./LibraryBrowser.tsx');
const { DOCUMENTS } = await import('../documents/kind.tsx');
const { doc, SCOPES } = await import('./testing.ts');
type View = import('./LibraryBrowser.tsx').View;

const a = doc({
  id: 'x.a',
  title: 'Alpha',
  name: 'a.pdf',
  modified: '2026-01-01T00:00:00.000Z',
  canDelete: true,
});
const b = doc({
  id: 'x.b',
  title: 'Beta',
  name: 'b.md',
  ext: 'md',
  format: 'doc',
  modified: '2026-03-01T00:00:00.000Z',
  view: 'text',
  canDelete: true,
});
const c = doc({
  id: 'x.c',
  title: 'Cee',
  name: 'c.pdf',
  modified: '2026-02-01T00:00:00.000Z',
  canDelete: true,
});
const DATA = {
  status: 'ready' as const,
  message: null,
  retry: () => {},
  items: [a, b, c] as LibraryItem[],
  order: ['Reports'],
  truncated: false,
  hiddenLinks: 0,
};

type Props = Partial<React.ComponentProps<typeof LibraryBrowser>>;

function Host(props: Props & { onChoose?: (i: LibraryItem) => void }) {
  const [view, setView] = useState<View>({
    query: '',
    layout: 'list',
    format: 'all',
    sort: 'newest',
    current: null,
  });
  return (
    <LibraryBrowser
      spec={DOCUMENTS}
      view={view}
      onView={(p) => setView((v) => ({ ...v, ...p }))}
      data={DATA}
      onChoose={(i) => setView((v) => ({ ...v, current: i }))}
      {...props}
    />
  );
}

const open = (id: string) => document.querySelector<HTMLElement>(`[data-open-id="${id}"]`) as HTMLElement;
const order = () =>
  [...document.querySelectorAll('[data-open-id]')].map((el) => el.getAttribute('data-open-id'));

afterEach(() => {
  cleanup();
  store.deleteFile.mockReset();
});

describe('LibraryBrowser', () => {
  it('counts each type and filters by it', () => {
    render(<Host />);
    expect(screen.getByRole('radio', { name: 'All, 3' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'PDFs, 2' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Docs, 1' }));
    expect(order()).toEqual(['x.b']);
  });

  it('sorts newest first, then A to Z', () => {
    render(<Host />);
    expect(order()).toEqual(['x.b', 'x.c', 'x.a']);
    fireEvent.click(screen.getByRole('radio', { name: 'A to Z' }));
    expect(order()).toEqual(['x.a', 'x.b', 'x.c']);
  });

  it('switches layout', () => {
    const { container } = render(<Host />);
    expect(container.querySelector('.lib')?.getAttribute('data-layout')).toBe('list');
    fireEvent.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(container.querySelector('.lib')?.getAttribute('data-layout')).toBe('grid');
    expect(container.querySelector('.img-tile')).toBeTruthy();
  });

  it('chooses a row, on local state alone', () => {
    const onChoose = vi.fn();
    render(<Host onChoose={onChoose} />);
    fireEvent.click(open('x.a'));
    expect(onChoose).toHaveBeenCalledWith(a);
  });

  it('marks the chosen row from the view it is given', () => {
    render(<Host />);
    fireEvent.click(open('x.c'));
    expect(open('x.c').getAttribute('aria-current')).toBe('true');
  });

  it('deletes through the app store and moves on', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file: Beta' }));
    expect(store.deleteFile).toHaveBeenCalledWith(b);
  });

  it('shows takeOut in the bin place and runs it, then focuses the neighbour', async () => {
    const run = vi.fn().mockResolvedValue(true);
    render(
      <Host
        bin={false}
        takeOut={(i) => ({ label: `Remove ${i.title}`, tip: 'Remove it', busy: false, run })}
      />,
    );
    expect(screen.queryByRole('button', { name: /Delete file/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Beta' }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement?.getAttribute('data-open-id')).toBe('x.c'));
  });

  it('hides delete with bin={false}', () => {
    render(<Host bin={false} />);
    expect(screen.queryByRole('button', { name: /Delete file/ })).toBeNull();
  });

  it('has no Open button without onOpen, and one with it', () => {
    const { unmount } = render(<Host />);
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull();
    unmount();
    render(<Host onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'Open Beta' })).toBeTruthy();
  });

  it('draws the library and project controls only with pickers', () => {
    const { unmount } = render(<Host />);
    expect(screen.queryByText('Library')).toBeNull();
    unmount();
    render(
      <Host
        pickers={{ scopes: SCOPES, scope: 'personal', onScope: () => {}, project: '', onProject: () => {} }}
      />,
    );
    expect(screen.getByText('Library')).toBeTruthy();
  });

  it('adds the lead control, notes and nested mode', () => {
    const { container } = render(
      <Host
        lead={<span>Lead here</span>}
        nested
        note={(i) => (i.id === 'x.a' ? 'from the library' : undefined)}
      />,
    );
    expect(screen.getByText('Lead here')).toBeTruthy();
    expect(container.querySelector('.lib')?.getAttribute('data-nested')).toBe('true');
    const row = open('x.a');
    expect(within(row).getByText(/from the library/)).toBeTruthy();
  });
});
