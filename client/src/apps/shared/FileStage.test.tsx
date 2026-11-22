// @vitest-environment jsdom
// What a file looks like in the viewer drawer: the body `FileStage` draws for each kind of file. These
// moved here from the Documents tests when the tools stopped opening files in place of their lists.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../../shared/contract.ts';
import { doc, item } from './testing.ts';

const store = vi.hoisted(() => ({ libraryVersion: 0 }));
const api = vi.hoisted(() => ({ libraryText: vi.fn() }));
vi.mock('../../api.ts', () => ({ api }));
vi.mock('../../store.tsx', () => ({ useStore: () => store }));

const { FileStage } = await import('./Viewer.tsx');

const lead = doc({
  id: 'client:acme.d2',
  title: 'Lead quality',
  name: 'lead.pdf',
  modified: '2026-11-03T09:00:00.000Z',
  view: 'pdf',
});
const plan = doc({
  id: 'client:acme.d3',
  format: 'doc',
  ext: 'md',
  title: 'Winter boiler campaign',
  name: 'winter.md',
  modified: '2026-10-28T09:00:00.000Z',
  view: 'text',
});
const page = doc({
  id: 'client:acme.d5',
  format: 'doc',
  ext: 'html',
  title: 'Explainer',
  name: 'explainer.html',
  modified: '2026-10-01T09:00:00.000Z',
  view: 'page',
});

// As the drawer draws it: keyed by the file, told the library's version.
const stage = (item: LibraryItem) => (
  <FileStage key={item.id} item={item} version={String(store.libraryVersion)} />
);

beforeEach(() => {
  store.libraryVersion = 0;
  api.libraryText.mockResolvedValue({ text: '# Hello\n\nSome *words*.', truncated: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('a file in the viewer', () => {
  it('renders a Markdown file with the safe renderer inside a card', async () => {
    const { container } = render(stage(plan));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy();
    expect(api.libraryText).toHaveBeenCalledWith(plan.id);
    expect(container.querySelector('.lib-doc.card .markdown')).not.toBeNull();
  });

  it('says when a long file was cut short', async () => {
    api.libraryText.mockResolvedValue({ text: 'Start of it', truncated: true });
    render(stage(plan));
    expect(await screen.findByText('This file is long, so only the start is shown.')).toBeTruthy();
  });

  it('shows plain text as pre-wrapped text, not Markdown', async () => {
    api.libraryText.mockResolvedValue({ text: '# not a heading', truncated: false });
    const { container } = render(stage({ ...plan, ext: 'txt', title: 'Notes file' }));
    await screen.findByText('# not a heading');
    expect(container.querySelector('pre.lib-text')).not.toBeNull();
    expect(container.querySelector('.markdown')).toBeNull();
  });

  it('shows a failure to read the file with Try again', async () => {
    api.libraryText.mockRejectedValueOnce(new Error('That file is no longer there.'));
    render(stage(plan));
    expect(await screen.findByText('That file is no longer there.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello' })).toBeTruthy();
  });

  it('opens an HTML page in a frame that may run scripts but never gets the app origin', () => {
    const { container } = render(stage(page));
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('Explainer');
    expect(frame.getAttribute('src')).toBe(`/api/library/page/${encodeURIComponent(page.id)}`);
    expect(frame.closest('.card')).not.toBeNull();
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it('opens a PDF in the browser’s own reader, in a frame without a sandbox', () => {
    const { container } = render(stage(lead));
    const frame = container.querySelector('iframe') as HTMLIFrameElement;
    // A sandboxed frame makes the browser refuse to show a PDF at all.
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('src')).toBe(
      `/api/library/pdf/${encodeURIComponent(lead.id)}#navpanes=0&view=FitH`,
    );
    expect(frame.closest('.card.lib-page.lib-pdf')).not.toBeNull();
    expect(api.libraryText).not.toHaveBeenCalled();
  });

  it('a newer copy of a page reloads its frame, but the library changing elsewhere does not', () => {
    const view = render(stage(page));
    const frame = view.container.querySelector('iframe');
    store.libraryVersion = 1;
    view.rerender(stage(page));
    expect(view.container.querySelector('iframe')).toBe(frame);
    view.rerender(stage({ ...page, modified: '2026-11-08T09:00:00.000Z' }));
    expect(view.container.querySelector('iframe')).not.toBe(frame);
  });

  it('a blocked move to another site stops the page frame (no reload loop) and offers it back; other violations do nothing', () => {
    const { container } = render(stage(page));
    const frame = container.querySelector('iframe');
    const violate = (violatedDirective: string) => {
      const e = new Event('securitypolicyviolation');
      Object.defineProperty(e, 'violatedDirective', { value: violatedDirective });
      act(() => {
        document.dispatchEvent(e);
      });
    };
    violate('img-src');
    expect(container.querySelector('iframe')).toBe(frame);
    expect(screen.queryByText('Links to other sites are switched off here.')).toBeNull();
    violate('frame-src https://example.com');
    // Stopped, not reloaded: a page that leaves as soon as it opens would otherwise reload for ever.
    expect(container.querySelector('iframe')).toBeNull();
    expect(
      screen.getByText('This page tried to move the viewer to another site, so it was stopped.'),
    ).toBeTruthy();
    expect(screen.getByText('Links to other sites are switched off here.').getAttribute('role')).toBe(
      'status',
    );
    violate('frame-src https://example.com');
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the page again' }));
    const again = container.querySelector('iframe');
    expect(again).not.toBeNull();
    expect(again).not.toBe(frame);
    expect(screen.queryByText('Links to other sites are switched off here.')).toBeNull();
    violate('frame-src https://example.com');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('an open note re-reads quietly when the library changes, keeping its text on screen', async () => {
    const view = render(stage(plan));
    await screen.findByRole('heading', { level: 1, name: 'Hello' });
    api.libraryText.mockResolvedValue({ text: '# Hello again', truncated: false });
    store.libraryVersion = 1;
    view.rerender(stage(plan));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello again' })).toBeTruthy();
    expect(api.libraryText).toHaveBeenCalledTimes(2);
  });

  it('a picture that fails says so, and gets another go when a newer copy comes', () => {
    const logo = item({ id: 'client:acme.1', name: 'acme-logo.png', title: 'Acme logo', view: 'image' });
    const view = render(stage(logo));
    const big = view.container.querySelector('img') as HTMLImageElement;
    expect(big.getAttribute('src')).toContain('w=1600');
    act(() => {
      fireEvent.error(big);
    });
    expect(screen.getByText('This picture could not be shown.')).toBeTruthy();
    view.rerender(stage({ ...logo, modified: '2026-11-06T10:00:00.000Z' }));
    expect(screen.queryByText('This picture could not be shown.')).toBeNull();
    expect(view.container.querySelector('.tray .card img')).not.toBeNull();
  });
});
