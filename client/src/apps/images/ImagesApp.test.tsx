// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ newChat: vi.fn() }));
const shell = vi.hoisted(() => ({ dispatch: vi.fn(), state: { panelOpen: false } }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));
vi.mock('../../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: shell.state, dispatch: shell.dispatch, modes: {} }),
}));

const { ImagesSheet } = await import('./ImagesSheet.tsx');
const { ImagesPanel } = await import('./ImagesPanel.tsx');
const { imagesStore } = await import('./store.ts');

beforeEach(() => {
  imagesStore.reset();
  shell.state = { panelOpen: false };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const folder = (name: string) => screen.getByRole('region', { name });

describe('ImagesSheet', () => {
  it('shows the first client’s library by folder, with a count on each', () => {
    render(<ImagesSheet />);
    expect(screen.getByRole('heading', { level: 2, name: 'Acme Heating Ltd images' })).toBeTruthy();
    expect(screen.getByText(/^24 images, /)).toBeTruthy();
    expect(folder('Brand').textContent).toContain('5');
    expect(folder('Photography').textContent).toContain('8');
    expect(screen.getByText('acme-logo-colour.svg')).toBeTruthy();
  });

  it('a folder card hides and shows its images', () => {
    render(<ImagesSheet />);
    const brand = folder('Brand');
    fireEvent.click(within(brand).getByRole('button', { name: 'Hide Brand' }));
    expect(within(brand).queryByRole('button', { name: /^acme-logo-colour\.svg/ })).toBeNull();
    fireEvent.click(within(brand).getByRole('button', { name: 'Show Brand' }));
    expect(within(brand).getByRole('button', { name: /^acme-logo-colour\.svg/ })).toBeTruthy();
  });

  it('switching client shows that client’s images and drops what was picked', () => {
    render(<ImagesSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    expect(screen.getByRole('group', { name: 'Selected images' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'northwind' } });
    expect(screen.getByText('northwind-logo.svg')).toBeTruthy();
    expect(screen.queryByText('acme-mark.png')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Selected images' })).toBeNull();
  });

  it('narrows by search and by type, and says when nothing matches', () => {
    render(<ImagesSheet />);
    fireEvent.change(screen.getByLabelText('Search images'), { target: { value: 'van' } });
    expect(screen.getByText(/^2 images, /)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Logos, 0' }));
    expect(screen.getByText('No images match. Try another search or type.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Logos, 0' }).getAttribute('aria-checked')).toBe('true');
  });

  it('choosing an image marks it current and opens the panel once', () => {
    const view = render(<ImagesSheet />);
    const tile = screen.getByRole('button', { name: /^van-livery-front\.jpg/ });
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-current')).toBe('true');
    expect(shell.dispatch).toHaveBeenCalledWith({ type: 'set-panel', open: true });

    // With the panel already open, choosing another image only swaps what it shows.
    shell.dispatch.mockClear();
    shell.state = { panelOpen: true };
    view.rerender(<ImagesSheet />);
    fireEvent.click(screen.getByRole('button', { name: /^team-at-depot\.jpg/ }));
    expect(shell.dispatch).not.toHaveBeenCalled();
    expect(imagesStore.get().currentId).toBe('acme-heating/team-at-depot.jpg');
  });

  it('ticked images get a bar that starts a chat naming each file', () => {
    render(<ImagesSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-favicon.png' }));
    const bar = screen.getByRole('group', { name: 'Selected images' });
    expect(within(bar).getByText('2 images selected')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Ask Claude about them' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft:
        'Help me with these 2 images:\n- clients/acme-heating/context/brand/acme-mark.png\n- clients/acme-heating/context/brand/acme-favicon.png',
    });
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('group', { name: 'Selected images' })).toBeNull();
    // The bar has gone, so focus lands on the summary line and not on the page.
    expect(document.activeElement?.textContent).toMatch(/^24 images, /);
  });

  it('says when the filter is hiding part of the selection', () => {
    render(<ImagesSheet />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select acme-mark.png' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Photos, 9' }));
    const bar = screen.getByRole('group', { name: 'Selected images' });
    expect(within(bar).getByText('1 image selected, 1 hidden by the filter')).toBeTruthy();
  });

  it('the list layout shows the same images as rows', () => {
    render(<ImagesSheet />);
    fireEvent.click(screen.getByRole('radio', { name: 'List' }));
    const row = screen.getByRole('button', { name: /^acme-logo-colour\.svg/ });
    expect(row.textContent).toContain('logo, 800 × 320, 12 KB');
  });
});

describe('ImagesPanel', () => {
  it('asks for a choice until an image is chosen', () => {
    render(<ImagesPanel />);
    expect(screen.getByText('Choose an image to see its details.')).toBeTruthy();
  });

  it('shows the chosen image, its facts and where it is used', () => {
    imagesStore.set({ currentId: 'acme-heating/acme-logo-colour.svg' });
    render(<ImagesPanel />);
    expect(screen.getByRole('img', { name: 'Preview of acme-logo-colour.svg' })).toBeTruthy();
    expect(screen.getByText('clients/acme-heating/context/brand/acme-logo-colour.svg')).toBeTruthy();
    expect(screen.getByText('2 Jun 2026')).toBeTruthy();
    expect(screen.getByText('Website: home page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude about it' }));
    expect(store.newChat).toHaveBeenCalledWith({
      draft: 'Help me with this image: clients/acme-heating/context/brand/acme-logo-colour.svg',
    });
  });
});
