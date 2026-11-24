// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUR_VERSION } from '../tour/steps.ts';

const store = vi.hoisted(() => ({
  boot: null as Record<string, unknown> | null,
  sessions: null as { live: unknown[]; past: unknown[] } | null,
  updatePrefs: vi.fn(async () => {}),
}));
vi.mock('../store.tsx', () => ({ useStore: () => store }));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('./ShellProvider.tsx', () => ({ useShell: () => ({ dispatch }) }));
const tour = vi.hoisted(() => ({ open: false }));
vi.mock('../tour/index.ts', () => ({ useTourOpen: () => tour.open, startTour: vi.fn() }));

const { WhatsNewCard } = await import('./WhatsNewCard.tsx');

const bootWith = (appVersion: string, prefs: Record<string, unknown>) => ({ appVersion, prefs });

beforeEach(() => {
  tour.open = false;
  store.boot = bootWith('0.40.0', { tourSeen: TOUR_VERSION, whatsNewSeen: null });
  store.sessions = { live: [], past: [{}] };
  store.updatePrefs.mockClear();
  dispatch.mockClear();
});
afterEach(cleanup);

describe('WhatsNewCard', () => {
  it('shows the note title, the whole note and a link per named page', () => {
    render(<WhatsNewCard />);
    expect(screen.getByRole('heading', { name: 'TDS Brain is now TDS Cortex' })).toBeTruthy();
    expect(screen.getByText(/The app has a new name/)).toBeTruthy();
    expect(screen.getByText(/Does the Dock app/)).toBeTruthy();
    expect(screen.getByText('Review app update')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adding Cortex to your Dock' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'open-help', page: 'dock-app' });
  });

  it('Close saves whatsNewSeen as the note version and moves focus to the message box', () => {
    render(
      <div>
        <WhatsNewCard />
        <div className="home-composer">
          <textarea className="composer-input" aria-label="Message" />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: "Close What's new" }));
    expect(store.updatePrefs).toHaveBeenCalledWith({ whatsNewSeen: '0.40.0' });
    expect(document.activeElement).toBe(screen.getByLabelText('Message'));
  });

  it('shows nothing while the tour is open', () => {
    tour.open = true;
    render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows nothing while tourSeen is null', () => {
    store.boot = bootWith('0.40.0', { tourSeen: null, whatsNewSeen: null });
    render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows nothing for a brand-new person: no earlier chats and nothing closed before', () => {
    store.sessions = { live: [], past: [] };
    render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows nothing while the chat lists are still loading', () => {
    store.sessions = null;
    render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows when there are no chats but a note was closed before', () => {
    store.sessions = { live: [], past: [] };
    store.boot = bootWith('0.40.0', { tourSeen: TOUR_VERSION, whatsNewSeen: '0.30.0' });
    render(<WhatsNewCard />);
    expect(screen.getByRole('heading', { name: 'TDS Brain is now TDS Cortex' })).toBeTruthy();
  });

  it('shows nothing once closed, or when the app is older than the note', () => {
    store.boot = bootWith('0.40.0', { tourSeen: TOUR_VERSION, whatsNewSeen: '0.40.0' });
    const { unmount } = render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
    unmount();
    store.boot = bootWith('0.39.0', { tourSeen: TOUR_VERSION, whatsNewSeen: null });
    render(<WhatsNewCard />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
