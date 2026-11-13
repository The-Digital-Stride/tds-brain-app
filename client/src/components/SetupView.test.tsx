// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AppState,
  BRAIN_REFUSAL_TEXT,
  type SetBrainResponse,
  type SetupCandidatesResponse,
} from '../../../shared/install-contract.ts';

const mocks = vi.hoisted(() => ({
  getSetupCandidates: vi.fn(),
  saveBrainFolder: vi.fn(),
  bootstrap: vi.fn(),
}));
vi.mock('../api.ts', () => ({ api: mocks }));

const { SetupView } = await import('./SetupView.tsx');

const SETUP: AppState = { kind: 'setup', tried: '/Users/sam/agencybrain', source: 'default', reason: null };
const READY: AppState = { kind: 'ready' };
const info = (over: Partial<SetupCandidatesResponse> = {}): SetupCandidatesResponse => ({
  candidates: [],
  current: null,
  openChats: 0,
  envOverride: false,
  ...over,
});
const bootAnswer = (appState: AppState, path: string) => ({
  appState,
  brain: { ok: true, path, problems: [] },
});

async function show(
  appState: AppState,
  candidates = info(),
  props: { onCancel?: () => void; underService?: boolean } = {},
) {
  mocks.getSetupCandidates.mockResolvedValue(candidates);
  const reload = vi.fn();
  render(<SetupView appState={appState} underService reload={reload} {...props} />);
  await act(async () => {});
  return reload;
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const m of Object.values(mocks)) m.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const save = async (res: SetBrainResponse) => {
  mocks.saveBrainFolder.mockResolvedValue(res);
  fireEvent.click(screen.getByRole('button', { name: /^Use this folder/ }));
  await act(async () => {});
};
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe('restart polling', () => {
  it('reloads only once the server is ready on the NEW path, not on the old server', async () => {
    const reload = await show(SETUP);
    mocks.bootstrap
      .mockResolvedValueOnce(bootAnswer(READY, '/old/brain')) // old server, still closing chats
      .mockResolvedValueOnce(bootAnswer(SETUP, '')) // old server in setup mode, still answering
      .mockRejectedValueOnce(new Error('down')) // restarting
      .mockResolvedValue(bootAnswer(READY, '/new/brain'));
    await save({ ok: true, path: '/new/brain', restarting: true });
    expect(screen.getByRole('status').textContent).toBe('Restarting TDS Brain…');
    await advance(1000);
    await advance(1000);
    expect(reload).not.toHaveBeenCalled();
    await advance(1000);
    expect(reload).not.toHaveBeenCalled();
    await advance(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads at once when the restarted server still could not use the folder', async () => {
    const reload = await show(SETUP);
    mocks.bootstrap
      .mockRejectedValueOnce(new Error('down')) // restarting
      .mockResolvedValue(bootAnswer(SETUP, '')); // the new server came back in setup
    await save({ ok: true, path: '/new/brain', restarting: true });
    await advance(1000);
    expect(reload).not.toHaveBeenCalled();
    await advance(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('gives up after 60 seconds with a plain message and Try again', async () => {
    const reload = await show(SETUP);
    mocks.bootstrap.mockRejectedValue(new Error('down'));
    await save({ ok: true, path: '/new/brain', restarting: true });
    await advance(61_000);
    expect(screen.getByRole('status').textContent).toMatch(/hasn't come back after a minute/);
    expect(reload).not.toHaveBeenCalled();
    mocks.bootstrap.mockResolvedValue(bootAnswer(READY, '/new/brain'));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await advance(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says to start TDS Brain again when it will not restart itself', async () => {
    const reload = await show(SETUP);
    await save({ ok: true, path: '/new/brain', restarting: false });
    expect(screen.getByRole('status').textContent).toBe(
      'Saved. Stop TDS Brain and start it again to use this folder.',
    );
    await advance(5000);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('the page', () => {
  it('focuses the heading and says why it looked where it did', async () => {
    await show(SETUP);
    const h = screen.getByRole('heading', { level: 1, name: 'Choose your brain folder' });
    expect(document.activeElement).toBe(h);
    expect(
      screen.getByText(/looked in \/Users\/sam\/agencybrain, but there's no brain there yet/),
    ).toBeTruthy();
    expect((screen.getByLabelText('Folder path') as HTMLInputElement).value).toBe('/Users/sam/agencybrain');
    expect(screen.getByText(/Option-Command-C/)).toBeTruthy();
  });

  it('gives the refusal reason when the folder was tried and refused', async () => {
    await show({ kind: 'setup', tried: '/x', source: 'settings', reason: 'missing-roles' });
    expect(screen.getByText(/doesn't look like the Agency Brain/)).toBeTruthy();
  });

  it('lists candidates, marks the one in use, and saves the one chosen', async () => {
    await show(
      READY,
      info({ candidates: ['/a/brain', '/b/brain'], current: { path: '/a/brain', source: 'settings' } }),
      {
        onCancel: vi.fn(),
      },
    );
    expect(screen.getByText('In use now')).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: /^Use this folder and restart/ });
    // One for /b/brain and the form's own.
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Use this folder and restart: /b/brain');
    expect(buttons[0]?.getAttribute('data-variant')).toBe('primary');
    expect(buttons[1]?.getAttribute('data-variant')).toBeNull();
    mocks.saveBrainFolder.mockResolvedValue({ ok: true, path: '/b/brain', restarting: true });
    mocks.bootstrap.mockResolvedValue(bootAnswer(READY, '/a/brain'));
    fireEvent.click(buttons[0] as HTMLElement);
    await act(async () => {});
    expect(mocks.saveBrainFolder).toHaveBeenCalledWith('/b/brain');
  });

  it('says so when none are found', async () => {
    await show(SETUP);
    expect(screen.getByText(/You'll need the Agency Brain on this Mac first/)).toBeTruthy();
  });

  it('shows a refusal inline, linked to the field', async () => {
    await show(SETUP);
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/nope' } });
    await save({ ok: false, reason: 'not-found' });
    const alert = document.querySelector('.setup-error') as HTMLElement;
    expect(alert.textContent).toBe(BRAIN_REFUSAL_TEXT['not-found']);
    expect(document.activeElement).toBe(screen.getByLabelText('Folder path'));
    const field = screen.getByLabelText('Folder path');
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
    expect(mocks.saveBrainFolder).toHaveBeenCalledWith('/nope');
  });

  it('shows the env-override sentence and no form when TDS_BRAIN_PATH is set', async () => {
    await show({ kind: 'setup', tried: '/x', source: 'env', reason: 'not-found' });
    expect(screen.getByText(BRAIN_REFUSAL_TEXT['env-override'])).toBeTruthy();
    expect(screen.queryByLabelText('Folder path')).toBeNull();
    expect(screen.queryByRole('button', { name: /Use this folder/ })).toBeNull();
  });

  it('also hides the form when the server reports an override', async () => {
    await show(READY, info({ envOverride: true }), { onCancel: vi.fn() });
    expect(screen.queryByLabelText('Folder path')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBeNull();
  });

  it('offers Cancel and warns about open chats only when opened from Settings', async () => {
    const onCancel = vi.fn();
    await show(READY, info({ openChats: 2 }), { onCancel });
    expect(screen.getByText(/restart and close your 2 open chats/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    cleanup();
    await show(SETUP);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByText(/open chat/)).toBeNull();
    expect(screen.getByText(/will restart to use this folder/)).toBeTruthy();
  });

  it('words the chat count for none and one', async () => {
    await show(READY, info({ openChats: 0 }), { onCancel: vi.fn() });
    expect(screen.getByText(/will restart to use this folder/)).toBeTruthy();
    cleanup();
    await show(READY, info({ openChats: 1 }), { onCancel: vi.fn() });
    expect(screen.getByText(/close your open chat\./)).toBeTruthy();
  });

  it('makes the form primary when there are several folders to choose from', async () => {
    await show(SETUP, info({ candidates: ['/a/brain', '/b/brain'] }));
    const [a, b, form] = screen.getAllByRole('button', { name: /^Use this folder/ });
    expect(a?.getAttribute('aria-label')).not.toBe(b?.getAttribute('aria-label'));
    expect(a?.getAttribute('data-variant')).toBeNull();
    expect(form?.getAttribute('data-variant')).toBe('primary');
  });

  it('looks again when asked to Check again', async () => {
    await show(SETUP);
    mocks.getSetupCandidates.mockResolvedValue(info({ candidates: ['/found/brain'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await act(async () => {});
    expect(mocks.getSetupCandidates).toHaveBeenCalledTimes(2);
    expect(screen.getByText('/found/brain')).toBeTruthy();
  });

  it('warns about a restart on first run only when it will restart itself', async () => {
    await show(SETUP, info(), { underService: true });
    expect(screen.getByText(/will restart to use this folder/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this folder and restart' })).toBeTruthy();
    cleanup();
    await show(SETUP, info(), { underService: false });
    expect(screen.queryByText(/will restart/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Use this folder' })).toBeTruthy();
  });
});
