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
});
