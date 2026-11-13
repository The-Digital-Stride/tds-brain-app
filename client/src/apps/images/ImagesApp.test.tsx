// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../../../../shared/contract.ts';
import { item, listing, SCOPES } from '../shared/testing.ts';

const store = vi.hoisted(() => ({
  newChat: vi.fn(),
  libraryVersion: 0,
  boot: { prefs: { lastClient: null as string | null } },
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

const { ImagesSheet, ImagesBar } = await import('./ImagesSheet.tsx');
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
    const picker = screen.getByLabelText('Library') as HTMLSelectElement;
    expect(picker.value).toBe('client:northwind');
    const groups = [...picker.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toEqual(['Mine', 'Clients']);
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
    expect(screen.getByRole('button', { name: /^van-front\.jpg/ }).textContent).toContain('JPG, 184 KB');
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('w=96');
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
    fireEvent.change(screen.getByLabelText('Library'), { target: { value: 'personal' } });
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
    api.library.mockRejectedValueOnce(new Error('Could not reach TDS Brain.'));
    render(<ImagesSheet />);
    expect(await screen.findByText('Could not reach TDS Brain.')).toBeTruthy();
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

describe('opening a picture', () => {
  const all = () => (
    <div className="sheet-scroll">
      <ImagesBar />
      <ImagesSheet />
      <ImagesPanel />
    </div>
  );

  it('swaps the list for the picture, gives a Back button, and Escape returns focus to the item', async () => {
    const { container } = render(all());
    await card('Brand');
    const open = screen.getByRole('button', { name: /^acme-logo\.png/ });
    fireEvent.click(open);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    const viewer = screen.getByRole('region', { name: 'Acme logo' });
    expect(document.activeElement).toBe(viewer);
    const big = viewer.querySelector('img') as HTMLImageElement;
    expect(big.getAttribute('src')).toContain('w=1600');
    expect(container.querySelector('.lib-main')?.hasAttribute('hidden')).toBe(true);
    expect(screen.getByRole('button', { name: 'Back to Images' })).toBeTruthy();

    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Acme logo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to Images' })).toBeNull();
    expect(container.querySelector('.lib-main')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(open);
  });

  it('Back restores the scroll position of the list', async () => {
    let top = 340;
    const { container } = render(all());
    const scroller = container.querySelector('.sheet-scroll') as HTMLElement;
    Object.defineProperty(scroller, 'scrollTop', {
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    top = 0; // the list has gone, so the container has scrolled back
    fireEvent.click(screen.getByRole('button', { name: 'Back to Images' }));
    expect(top).toBe(340);
  });

  it('a picture that failed in the viewer gets another go when the file changes', async () => {
    const view = render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const viewer = screen.getByRole('region', { name: 'Acme logo' });
    fireEvent.error(viewer.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('This picture could not be shown.')).toBeTruthy();
    api.library.mockResolvedValue(
      listing(
        'client:acme',
        [{ ...logo, modified: '2026-11-06T10:00:00.000Z' }, mark, van, noPicture],
        ['Brand', 'Photography'],
      ),
    );
    store.libraryVersion = 1;
    view.rerender(all());
    await waitFor(() => expect(screen.queryByText('This picture could not be shown.')).toBeNull());
    expect(screen.getByRole('region', { name: 'Acme logo' }).querySelector('.tray .card img')).not.toBeNull();
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

  it('the viewer takes focus after something else grabs it as the panel closes', async () => {
    render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    const opener = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(opener);
    (screen.getByRole('button', { name: 'Back to Images' }) as HTMLElement).focus();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Acme logo' })),
    );
  });

  it('a picture that fails in the viewer says so', async () => {
    render(all());
    await card('Brand');
    fireEvent.click(screen.getByRole('button', { name: /^acme-logo\.png/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const viewer = screen.getByRole('region', { name: 'Acme logo' });
    act(() => {
      fireEvent.error(viewer.querySelector('img') as HTMLImageElement);
    });
    expect(screen.getByText('This picture could not be shown.')).toBeTruthy();
  });
});
