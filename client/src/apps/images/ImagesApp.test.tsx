// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../../../shared/contract.ts';
import { openPicker, pickOption } from '../../test/pick.ts';
import { item, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  deleteFile: vi.fn(),
  undoDeleteFile: vi.fn(),
  heldFiles: [] as { id: string; title: string; phase: 'waiting' | 'sending' }[],
  hiddenFileIds: new Set<string>() as ReadonlySet<string>,
  fileDeleteBusy: false,
  boot: {
    prefs: { lastClient: null as string | null },
    clients: [{ slug: 'northwind', name: 'Northwind', aliases: ['NW'] }],
  },
}));
const shell = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { panelOpen: false },
  modes: {} as { panelOverlays?: boolean },
}));
const api = vi.hoisted(() => ({ libraryScopes: vi.fn(), library: vi.fn(), libraryText: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: shell.modes }),
}));

const { ImagesSheet } = await import('./ImagesSheet.tsx');
const { ImagesPanel } = await import('./ImagesPanel.tsx');
const { imagesStore } = await import('./store.ts');

const logo = item({ id: 'client:acme.1', name: 'acme-logo.png', title: 'Acme logo' });
const mark = item({
  id: 'client:acme.2',
  name: 'acme-mark.png',
  path: 'clients/acme/context/brand/acme-mark.png',
  bytes: 4_000_000,
});
const van = item({
  id: 'client:acme.3',
  name: 'van-front.jpg',
  title: 'van front',
  ext: 'jpg',
  group: 'Photography',
  path: 'clients/acme/context/reference/van-front.jpg',
  width: null,
  height: null,
  thumb: false,
  view: 'image',
});
const noPicture = item({
  id: 'client:acme.4',
  name: 'odd.svg',
  ext: 'svg',
  width: null,
  height: null,
  thumb: false,
  view: null,
});

beforeEach(() => {
  imagesStore.reset();
  store.libraryVersion = 0;
  store.heldFiles = [];
  store.hiddenFileIds = new Set();
  store.fileDeleteBusy = false;
  store.boot.prefs.lastClient = null;
  shell.state = { panelOpen: false };
  shell.modes = {};
  api.libraryScopes.mockResolvedValue(SCOPES);
  api.library.mockImplementation(async (scope: string) =>
    listing(scope, [logo, mark, van, noPicture], ['Brand', 'Photography']),
  );
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (name: string) => screen.findByRole('region', { name });

describe('ImagesSheet', () => {
  it('says it is loading, then shows the images by card with a count on each', async () => {
    render(<ImagesSheet />);
    expect(screen.getByText('Loading…').getAttribute('role')).toBe('status');
    expect((await card('Brand')).textContent).toContain('3');
    expect((await card('Photography')).textContent).toContain('1');
    expect(screen.getByRole('heading', { level: 2, name: 'Images in Acme Heating Ltd' })).toBeTruthy();
    expect(screen.getByText('4 images, 4.6 MB')).toBeTruthy();
  });

  it('opens on the last client used, never on the personal files, with the picker grouped', async () => {
    store.boot.prefs.lastClient = 'northwind';
    render(<ImagesSheet />);
    await card('Brand');
    expect(api.library).toHaveBeenCalledWith('client:northwind');
    expect(api.library).not.toHaveBeenCalledWith('personal');
    const picker = screen.getByRole('combobox', { name: 'Library' }) as HTMLInputElement;
    expect(picker.value).toBe('Northwind');
    fireEvent.click(picker);
    expect(
      screen
        .getAllByRole('group')
        .map(
          (g) =>
            g.getAttribute('aria-labelledby') &&
            document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent,
        ),
    ).toEqual(['Mine', 'Clients']);
    fireEvent.keyDown(picker, { key: 'Escape' });
  });

  it('finds a client library by its code', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    const picker = openPicker('Library');
    fireEvent.change(picker, { target: { value: 'nw' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Northwind']);
    fireEvent.keyDown(picker, { key: 'Escape' });
  });

  it('opens on the first client when none was used', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    expect(api.library).toHaveBeenCalledWith('client:acme');
  });

  it('has no Type filter, and puts the summary in the tools row', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    expect(screen.queryByRole('radiogroup', { name: 'Type' })).toBeNull();
    const summary = screen.getByText('4 images, 4.6 MB');
    expect(summary.closest('.lib-tools')).not.toBeNull();
  });

  it('shows the picture lazily at 320, and the standard tile when there is no picture', async () => {
    const { container } = render(<ImagesSheet />);
    await card('Brand');
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(
      `/api/library/thumb/${encodeURIComponent(logo.id)}?w=320&v=${encodeURIComponent(logo.modified)}`,
    );
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('alt')).toBe('');
    const plain = container.querySelectorAll('.img-thumb[data-plain="true"]');
    expect(plain).toHaveLength(2);
    expect(plain[0]?.querySelector('svg.icon')).not.toBeNull();
  });

  it('falls back to the standard tile when a picture fails to load, and tries again after a refresh', async () => {
    const view = render(<ImagesSheet />);
    await card('Brand');
    const first = view.container.querySelector('img') as HTMLImageElement;
    fireEvent.error(first);
    expect(view.container.querySelectorAll('.img-thumb[data-plain="true"]')).toHaveLength(3);
    store.libraryVersion = 1;
    view.rerender(<ImagesSheet />);
    await waitFor(() =>
      expect(view.container.querySelectorAll('.img-thumb[data-plain="true"]')).toHaveLength(2),
    );
  });

  it('a tile shows the dimensions, or the size when they are not known; a row shows type, size and weight', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    expect(screen.getByRole('button', { name: /^acme-logo\.png/ }).textContent).toContain('1200 × 628');
    expect(screen.getByRole('button', { name: /^van-front\.jpg/ }).textContent).toContain('184 KB');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    expect(screen.getByRole('button', { name: /^acme-logo\.png/ }).textContent).toContain(
      'PNG, 1200 × 628, 184 KB',
    );
    const meta = (name: RegExp) =>
      screen.getByRole('button', { name }).querySelector('.line-meta')?.textContent;
    expect(meta(/^acme-logo\.png/)).toBe('PNG, 1200 × 628, 184 KB');
    expect(meta(/^van-front\.jpg/)).toBe('JPG, 184 KB');
    expect(screen.getByRole('button', { name: /^van-front\.jpg/ }).textContent).toContain('JPG, 184 KB');
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('w=96');
  });

  it('shows the file type badge on every tile and row, in the right place', async () => {
    const { container } = render(<ImagesSheet />);
    await card('Brand');
    // Grid is the default: the badge sits on the picture, after the thumb, and never in the open button.
    const tile = screen.getByRole('button', { name: /^acme-logo\.png/ }).closest('.img-tile') as HTMLElement;
    const badge = tile.querySelector('.lib-tile-pic > .lib-type') as HTMLElement;
    expect(badge.textContent).toBe('PNG');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.getAttribute('data-tone')).toBe('muted');
    expect(badge.previousElementSibling?.classList.contains('img-thumb')).toBe(true);
    expect(tile.querySelector('.lib-open .lib-type')).toBeNull();
    // The tile's visible words stay the dimensions; the type is in the hidden word.
    expect(tile.querySelector('.line-meta')?.textContent).toBe('PNG, 1200 × 628');
    expect(tile.querySelector('.line-meta .visually-hidden')?.textContent).toBe('PNG, ');
    expect([...container.querySelectorAll('.lib-type')].map((b) => b.textContent)).toContain('JPG');
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const row = screen.getByRole('button', { name: /^acme-logo\.png/ });
    const rowBadge = row.querySelector('.lib-type') as HTMLElement;
    expect(rowBadge.textContent).toBe('PNG');
    expect(rowBadge.previousElementSibling?.classList.contains('img-thumb')).toBe(true);
    expect(rowBadge.nextElementSibling?.className).toBe('line-text');
    expect(container.querySelector('.lib-tile-pic')).toBeNull();
  });

  it('a card hides and shows its images', async () => {
    render(<ImagesSheet />);
    const brand = await card('Brand');
    fireEvent.click(within(brand).getByRole('button', { name: 'Hide Brand' }));
    expect(
      within(brand).getByRole('button', { name: 'Show Brand' }).getAttribute('aria-controls'),
    ).toBeTruthy();
    expect(brand.querySelector('ul')?.hasAttribute('hidden')).toBe(true);
    fireEvent.click(within(brand).getByRole('button', { name: 'Show Brand' }));
    expect(brand.querySelector('ul')?.hasAttribute('hidden')).toBe(false);
  });

  it('Open on a tile or row shows an image in the viewer drawer; one the app cannot show has no Open', async () => {
    render(<ImagesSheet />);
    await card('Photography');
    expect(screen.queryByRole('button', { name: 'Open odd.svg' })).toBeNull();
    // Images keep their ticks for picking several.
    expect(screen.getByRole('checkbox', { name: 'Select acme-mark.png' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open van-front.jpg' }));
    expect(imagesStore.get().current).toBe(van);
    expect(shell.dispatch).toHaveBeenCalledWith({
      type: 'open-viewer',
      viewer: { item: van, place: 'Acme Heating Ltd' },
    });
  });

  it('draws the first 60 of a long card until Show all is pressed', async () => {
    const many = Array.from({ length: 75 }, (_, i) => item({ id: `client:acme.m${i}`, name: `p${i}.png` }));
    api.library.mockResolvedValue(listing('client:acme', many, ['Brand']));
    render(<ImagesSheet />);
    const brand = await card('Brand');
    expect(brand.querySelectorAll('li')).toHaveLength(60);
    expect(brand.textContent).toContain('75');
    const showAll = within(brand).getByRole('button', { name: 'Show all 75 in Brand' });
    expect(showAll.classList.contains('btn')).toBe(true);
    expect(showAll.getAttribute('data-variant')).toBe('quiet');
    expect(showAll.classList.contains('link-btn')).toBe(false);
    fireEvent.click(showAll);
    expect(brand.querySelectorAll('li')).toHaveLength(75);
    expect(within(brand).queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('switching library fetches that one and drops what was picked', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    expect(screen.getByRole('group', { name: 'Selected images' })).toBeTruthy();
    pickOption('Library', 'My personal files');
    await waitFor(() => expect(api.library).toHaveBeenCalledWith('personal'));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Selected images' })).toBeNull());
  });

  it('narrows by search and says when nothing matches', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    expect(screen.getByLabelText('Search images').getAttribute('placeholder')).toBe(
      'Search by name or folder',
    );
    fireEvent.change(screen.getByLabelText('Search images'), { target: { value: 'van' } });
    expect(screen.getByText('1 image, 184 KB')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search images'), { target: { value: 'zebra' } });
    expect(screen.getByText('No images match. Try another search.')).toBeTruthy();
  });

  it('says so when the library has no images', async () => {
    api.library.mockResolvedValue(listing('client:acme', []));
    render(<ImagesSheet />);
    expect(
      await screen.findByText("Nothing here yet. Images saved in this library's folders will appear here."),
    ).toBeTruthy();
  });

  it('shows the failure and tries again', async () => {
    api.library.mockRejectedValueOnce(new Error('Could not reach TDS Cortex.'));
    render(<ImagesSheet />);
    expect(await screen.findByText('Could not reach TDS Cortex.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await card('Brand')).toBeTruthy();
    expect(api.library).toHaveBeenCalledTimes(2);
  });

  it('says when the listing was cut short', async () => {
    api.library.mockResolvedValue(listing('client:acme', [logo], ['Brand'], true));
    render(<ImagesSheet />);
    expect(await screen.findByText('This library is very large, so some files are not listed.')).toBeTruthy();
  });

  it('fetches again, quietly, when the library changes', async () => {
    const view = render(<ImagesSheet />);
    await card('Brand');
    api.library.mockResolvedValue(listing('client:acme', [logo], ['Brand']));
    store.libraryVersion = 1;
    view.rerender(<ImagesSheet />);
    // The old list stays up while the new one loads, then is swapped.
    expect(screen.queryByText('Loading…')).toBeNull();
    await waitFor(() => expect(screen.getByText('1 image, 184 KB')).toBeTruthy());
  });

  it('choosing an image marks it current and opens the panel once', async () => {
    const view = render(<ImagesSheet />);
    await card('Brand');
    const tile = screen.getByRole('button', { name: /^acme-logo\.png/ });
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-current')).toBe('true');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });
    shell.dispatch.mockClear();
    shell.state = { panelOpen: true };
    view.rerender(<ImagesSheet />);
    fireEvent.click(screen.getByRole('button', { name: /^acme-mark\.png/ }));
    expect(shell.dispatch).not.toHaveBeenCalled();
    expect(imagesStore.get().current?.id).toBe(mark.id);
  });

  it('ticked images get a bar that starts a chat naming each real path, and Clear returns focus', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-logo.png' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    const bar = screen.getByRole('group', { name: 'Selected images' });
    expect(within(bar).getByText('2 images selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Ask Claude about them' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft:
        'Help me with these 2 images:\n- clients/acme/context/brand/acme-logo.png\n- clients/acme/context/brand/acme-mark.png',
    });
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: 'Selected images' })).toBeNull();
    expect(document.activeElement?.textContent).toMatch(/^4 images, /);
  });

  it('says when the search is hiding part of the selection', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    fireEvent.change(screen.getByLabelText('Search images'), { target: { value: 'van' } });
    const bar = screen.getByRole('group', { name: 'Selected images' });
    expect(within(bar).getByText('1 image selected, 1 hidden by your search')).toBeTruthy();
  });

  it('drops the panel’s image when the refreshed listing no longer has it', async () => {
    const view = render(<ImagesSheet />);
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-mark\.png/ }));
    api.library.mockResolvedValue(listing('client:acme', [logo], ['Brand']));
    store.libraryVersion = 1;
    view.rerender(<ImagesSheet />);
    await waitFor(() => expect(imagesStore.get().current).toBeNull());
  });
});

describe('ImagesPanel', () => {
  it('asks for a choice until an image is chosen', () => {
    render(<ImagesPanel />);
    expect(screen.getByText('Choose an image to see its details.')).toBeTruthy();
  });

  it('shows the picture and the facts the file holds, with Open first', () => {
    imagesStore.set({ current: logo });
    render(<ImagesPanel />);
    const img = screen.getByRole('img', { name: 'Preview of acme-logo.png' });
    expect(img.getAttribute('src')).toContain('w=320');
    expect(screen.getByText('1200 × 628')).toBeTruthy();
    expect(screen.getByText('184 KB')).toBeTruthy();
    expect(screen.getByText('Brand')).toBeTruthy();
    expect(screen.getByText('5 Nov 2026')).toBeTruthy();
    expect(screen.getByText('clients/acme/context/brand/acme-logo.png')).toBeTruthy();
    expect(screen.queryByText('Tags')).toBeNull();
    expect(screen.queryByText('Used in')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('data-variant')).toBe('primary');
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude about it' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft: 'Help me with this image: clients/acme/context/brand/acme-logo.png',
    });
    const save = screen.getByRole('link', { name: 'Download acme-logo.png' });
    expect(save.getAttribute('href')).toBe(ROUTES.libraryFile(logo.id));
    expect(save.getAttribute('download')).toBe('acme-logo.png');
    expect(save.textContent).toBe('Download');
  });

  it('leaves out Dimensions when the size is unknown, and Open when the file cannot be opened', () => {
    imagesStore.set({ current: noPicture });
    const { container } = render(<ImagesPanel />);
    expect(screen.queryByText('Dimensions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    expect(container.querySelector('.img-thumb[data-plain="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Ask Claude about it' }).getAttribute('data-variant')).toBe(
      'primary',
    );
  });
});

describe('opening a picture from the panel', () => {
  const all = () => (
    <div className="sheet-scroll">
      <ImagesSheet />
      <ImagesPanel />
    </div>
  );

  it('Open shows it in the viewer drawer and leaves the list where it was', async () => {
    const { container } = render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'open-viewer', viewer: { item: logo } });
    expect(container.querySelector('.lib-main')?.hasAttribute('hidden')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Back to Images' })).toBeNull();
  });

  it('a floating panel closes when Open is pressed, and a docked one stays', async () => {
    shell.modes = { panelOverlays: true };
    render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    shell.dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: false });
    cleanup();
    imagesStore.reset();
    shell.modes = { panelOverlays: false };
    render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    shell.dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(shell.dispatch).not.toHaveBeenCalledWith({ type: 'set-panel', open: false });
  });
});

describe('deleting an image', () => {
  const deletable = (over = {}) => ({ ...logo, canDelete: true, ...over });
  beforeEach(() => {
    api.library.mockImplementation(async (scope: string) =>
      listing(scope, [deletable(), mark, { ...van, canDelete: false }, noPicture], ['Brand', 'Photography']),
    );
    store.deleteFile.mockImplementation((i: { id: string }) => {
      store.hiddenFileIds = new Set([...store.hiddenFileIds, i.id]);
    });
  });

  it('shows a bin only on the files the server says can be deleted', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    expect(
      screen.getByRole('button', { name: 'Delete file: acme-logo.png' }).classList.contains('icon-btn'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /^Delete file: (acme-mark|van front)/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Delete file: / })).toHaveLength(1);
  });

  it('holds the delete, takes the row out, and moves focus to the next file by id', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: 'Delete file: acme-logo.png' }));
    expect(store.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: logo.id }), 'acme-logo.png');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete file: acme-logo.png' })).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(`[data-open-id="${mark.id}"]`) as HTMLElement,
      ),
    );
  });

  it('keeps a held file out of the list when the library refreshes during the hold', async () => {
    const { rerender } = render(<ImagesSheet />);
    await card('Brand');
    store.hiddenFileIds = new Set([logo.id]);
    store.libraryVersion = 1;
    rerender(<ImagesSheet />);
    await waitFor(() => expect(api.library).toHaveBeenCalledTimes(2));
    await card('Brand');
    expect(screen.queryByText('acme-logo.png')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete file: acme-logo.png' })).toBeNull();
  });

  it('keeps every bin focusable but inert while a delete is being sent', async () => {
    store.fileDeleteBusy = true;
    render(<ImagesSheet />);
    await card('Brand');
    const bin = screen.getByRole('button', { name: 'Delete file: acme-logo.png' }) as HTMLButtonElement;
    expect(bin.disabled).toBe(false);
    expect(bin.getAttribute('aria-disabled')).toBe('true');
    bin.focus();
    expect(document.activeElement).toBe(bin);
    fireEvent.click(bin);
    expect(store.deleteFile).not.toHaveBeenCalled();
  });

  it('names the file as the list shows it: the bin, the tooltip and the held entry', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    const bin = screen.getByRole('button', { name: 'Delete file: acme-logo.png' });
    expect(bin.getAttribute('data-tip')).toBe('Delete file');
    fireEvent.click(bin);
    expect(store.deleteFile).toHaveBeenCalledWith(expect.objectContaining({ id: logo.id }), 'acme-logo.png');
  });

  it('puts the bin on the picture\u2019s corner, not inside the name button', async () => {
    render(<ImagesSheet />);
    await card('Brand');
    const bin = screen.getByRole('button', { name: 'Delete file: acme-logo.png' });
    expect(bin.closest('.lib-tile-pic')).not.toBeNull();
    expect(bin.closest('.lib-open')).toBeNull();
  });
});
