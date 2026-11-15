// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '../../../../shared/contract.ts';

vi.mock('../../store.tsx', () => ({ useStore: () => ({ libraryVersion: 0 }) }));
const { FileStage } = await import('./Viewer.tsx');

const item = { id: 'i1', title: 'Report', view: 'page', ext: 'html', modified: 1 } as unknown as LibraryItem;
afterEach(cleanup);

describe('FileStage page frame', () => {
  it('runs scripts but never gets the app origin', () => {
    render(<FileStage item={item} />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups');
    expect(frame.getAttribute('src')).toBe('/api/library/page/i1');
  });

  it('stops a page that loads a second time and can show it again', () => {
    render(<FileStage item={item} />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    fireEvent.load(frame);
    fireEvent.load(frame);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByText('This page tried to open another site, so it was stopped.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the page again' }));
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('opens a link the page sends after a click in a new tab, and keeps the page', () => {
    render(<FileStage item={item} />);
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    frame.focus();
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      const data = { type: 'tds-page-open-link', url: 'https://example.com/' };
      window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }));
      expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
      expect(document.querySelector('iframe')).toBe(frame);
    } finally {
      open.mockRestore();
      Reflect.deleteProperty(navigator, 'userActivation');
    }
  });
});
