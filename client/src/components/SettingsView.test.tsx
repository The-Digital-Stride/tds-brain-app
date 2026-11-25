// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt } from '../installPrompt.ts';

const boot = {
  appVersion: '1.0.0',
  appState: { kind: 'ready' as const },
  service: { underService: true },
  prefs: { directWrites: false } as Record<string, unknown>,
  skills: [
    { name: 'google-ads-audit', title: 'Google Ads audit' },
    { name: 'write-post', title: 'Write a post' },
  ],
  identity: { name: 'Sam', role: 'team', knownMember: true },
  brain: { ok: true, path: '/brain', problems: [] },
  engine: { ok: true, claudePath: '/bin/claude', permissionMode: 'default' },
};
const setSetupOpen = vi.fn();
const openView = vi.fn();
const st = vi.hoisted(() => ({
  updatePrefs: vi.fn(),
  clearSettingsFocus: vi.fn(),
  settingsFocus: false,
  engineChoices: vi.fn(),
  usageSavings: vi.fn(),
  setSkillLevel: vi.fn(),
  skillLevels: null as unknown,
}));
vi.mock('../api.ts', () => ({ api: { engineChoices: st.engineChoices, usageSavings: st.usageSavings } }));
const live = { streamUp: true, lastSync: new Date().toISOString() as string | null | undefined };
vi.mock('../store.tsx', () => ({
  useStore: () => ({
    boot,
    setSetupOpen,
    openView,
    updatePrefs: st.updatePrefs,
    skillLevels: st.skillLevels,
    setSkillLevel: st.setSkillLevel,
    settingsFocus: st.settingsFocus,
    clearSettingsFocus: st.clearSettingsFocus,
    streamUp: live.streamUp,
    lists: { todos: 'loaded', chats: 'loaded' },
  }),
}));
vi.mock('../shell/useLastSync.ts', () => ({
  useLastSync: () => ({ lastSync: live.lastSync, now: Date.now() }),
}));
vi.mock('../shell/ShellProvider.tsx', () => ({
  useShell: () => ({ state: { singleKeys: true }, dispatch: vi.fn() }),
}));

const upd = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../state/update.ts', () => ({ useUpdate: () => upd.current }));

// Every page exists, so what shows is decided by the role alone.
vi.mock('../help/library.ts', () => ({
  helpLibrary: { byId: (id: string) => ({ id, title: id }) },
}));
vi.mock('./VersionHistory.tsx', () => ({ VersionHistory: () => <p>History</p> }));

const { SettingsView } = await import('./SettingsView.tsx');

/** Every tab's page at once, for checks that span the whole of Settings. */
function AllTabs() {
  return (
    <>
      {(['general', 'claude', 'skill-levels', 'health', 'about'] as const).map((t) => (
        <SettingsView key={t} tab={t} />
      ))}
    </>
  );
}

const standalone = (on: boolean) => vi.stubGlobal('matchMedia', () => ({ matches: on }) as MediaQueryList);
const chromeEvent = (type: string, extra: object = {}) =>
  act(async () => {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), extra));
  });

const updStatus = (over: Record<string, unknown> = {}) => ({
  current: '1.0.0',
  latest: '1.0.0',
  available: false,
  blocked: null,
  checkedAt: null,
  checkFailed: false,
  unfinished: false,
  phase: 'idle',
  error: null,
  notes: [],
  openChats: 0,
  ...over,
});
const setUpd = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
  upd.current = {
    status: updStatus(over),
    stalled: false,
    checking: false,
    dismissed: false,
    check: vi.fn(),
    start: vi.fn(),
    later: vi.fn(),
    ...extra,
  };
  return upd.current as { check: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
};

const choices = {
  models: [
    { value: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { value: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'] },
  ],
  claudeCode: { model: 'claude-opus-5-5' as string | null },
};

const totals = (summary: number, reused = 0) => ({
  saved: summary,
  reused,
  bySource: { summary },
});
function emptySavings() {
  const z = { saved: 0, reused: 0, bySource: {} };
  return { since: null, today: z, last7: z, last30: z, all: z, kitsMode: 'shadow', team: null };
}

beforeEach(() => {
  st.engineChoices.mockResolvedValue(choices);
  st.usageSavings.mockResolvedValue(emptySavings());
  st.settingsFocus = false;
  st.skillLevels = null;
  st.setSkillLevel.mockReset();
  st.updatePrefs.mockReset();
  boot.prefs = { directWrites: false, model: null, effort: null } as typeof boot.prefs;
  boot.identity = { ...boot.identity, role: 'team' };
});

afterEach(() => {
  setUpd();
  cleanup();
  vi.unstubAllGlobals();
  live.streamUp = true;
  live.lastSync = new Date().toISOString();
});

const optionTexts = (el: HTMLElement) => Array.from((el as HTMLSelectElement).options).map((o) => o.text);
const selectOf = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;

describe('Single-key shortcuts text', () => {
  it('lists "H or ? for Help" for every role', () => {
    standalone(false);
    boot.identity = { ...boot.identity, role: 'owner' };
    const { unmount } = render(<SettingsView tab="general" />);
    expect(document.getElementById('set-keys-help')?.textContent).toContain('H or ? for Help');
    unmount();
    boot.identity = { ...boot.identity, role: 'team' };
    render(<SettingsView tab="general" />);
    expect(document.getElementById('set-keys-help')?.textContent).toContain('H or ? for Help');
  });
});

describe('Claude in chats', () => {
  it('shows both selects with their first options, before and after the choices load', async () => {
    standalone(false);
    st.engineChoices.mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<SettingsView tab="claude" />);
    expect(screen.getByRole('heading', { name: 'Claude in chats' })).toBeTruthy();
    expect(selectOf('Model').getAttribute('aria-describedby')).toBe('claude-help');
    expect(selectOf('Effort').getAttribute('aria-describedby')).toBe('claude-help');
    expect(document.getElementById('claude-help')?.textContent).toMatch(/^Used by new chats/);
    expect(screen.getByRole('group', { name: 'Claude in chats' })).toBeTruthy();
    expect(optionTexts(selectOf('Model'))).toEqual(['Same as Claude Code', 'Opus', 'Sonnet', 'Haiku']);
    expect(optionTexts(selectOf('Effort'))[0]).toBe('Same as Claude Code');
    unmount();
    st.engineChoices.mockResolvedValue(choices);
    render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Sonnet 5.5' });
    expect(optionTexts(selectOf('Model'))).toEqual([
      'Same as Claude Code (Opus 5.5)',
      'Opus 5.5',
      'Sonnet 5.5',
    ]);
    expect(optionTexts(selectOf('Effort'))).toEqual([
      'Same as Claude Code',
      'Low',
      'Medium',
      'High',
      'Extra high',
      'Max',
    ]);
    expect(screen.getByText('Used by new chats, and by open chats from their next reply.')).toBeTruthy();
  });

  it('names Same as Claude Code after the matching model row, for an alias', async () => {
    standalone(false);
    st.engineChoices.mockResolvedValue({ ...choices, claudeCode: { model: 'opus' } });
    render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Same as Claude Code (Opus 5.5)' });
  });

  it('uses the fallback models when the server returns an empty list', async () => {
    standalone(false);
    st.engineChoices.mockResolvedValue({ models: [], claudeCode: { model: null } });
    render(<SettingsView tab="claude" />);
    await act(async () => {});
    expect(optionTexts(selectOf('Model'))).toEqual(['Same as Claude Code', 'Opus', 'Sonnet', 'Haiku']);
  });

  it('still renders when the choices fail to load', async () => {
    standalone(false);
    st.engineChoices.mockRejectedValue(new Error('down'));
    render(<SettingsView tab="claude" />);
    await act(async () => {});
    expect(optionTexts(selectOf('Model'))).toEqual(['Same as Claude Code', 'Opus', 'Sonnet', 'Haiku']);
  });

  it('saves a model or effort on change, and null for Same as Claude Code', async () => {
    standalone(false);
    render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Sonnet 5.5' });
    fireEvent.change(selectOf('Model'), { target: { value: 'sonnet' } });
    expect(st.updatePrefs).toHaveBeenCalledWith({ model: 'sonnet' });
    fireEvent.change(selectOf('Effort'), { target: { value: 'xhigh' } });
    expect(st.updatePrefs).toHaveBeenCalledWith({ effort: 'xhigh' });
    boot.prefs = { directWrites: false, model: 'sonnet', effort: 'high' } as typeof boot.prefs;
    fireEvent.change(selectOf('Effort'), { target: { value: '' } });
    expect(st.updatePrefs).toHaveBeenCalledWith({ effort: null });
  });

  it('lists the efforts of the picked model and keeps a saved effort that is missing', async () => {
    standalone(false);
    boot.prefs = { directWrites: false, model: 'sonnet', effort: null } as typeof boot.prefs;
    const { unmount } = render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Sonnet 5.5' });
    expect(optionTexts(selectOf('Effort'))).toEqual(['Same as Claude Code', 'Low', 'Medium', 'High']);
    unmount();
    boot.prefs = { directWrites: false, model: 'sonnet', effort: 'max' } as typeof boot.prefs;
    render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Sonnet 5.5' });
    expect(optionTexts(selectOf('Effort'))).toEqual(['Same as Claude Code', 'Low', 'Medium', 'High', 'Max']);
    expect(selectOf('Effort').value).toBe('max');
  });

  it('keeps a saved model the list no longer offers', async () => {
    standalone(false);
    boot.prefs = { directWrites: false, model: 'claude-opus-4-1', effort: null } as typeof boot.prefs;
    render(<SettingsView tab="claude" />);
    await screen.findByRole('option', { name: 'Sonnet 5.5' });
    expect(selectOf('Model').value).toBe('claude-opus-4-1');
  });
});

describe('health panel', () => {
  it('opens the brain folder page from the Change button', () => {
    standalone(false);
    render(<SettingsView tab="health" />);
    fireEvent.click(screen.getByRole('button', { name: 'Change brain folder' }));
    expect(setSetupOpen).toHaveBeenCalledWith(true);
  });

  it('says everything is connected when it is', () => {
    standalone(false);
    render(<SettingsView tab="health" />);
    expect(
      screen.getByText(/Everything is connected|need attention/, { selector: '[role=status]' }).textContent,
    ).toBe('Everything is connected and working.');
    expect(screen.getByText('/brain')).toBeTruthy();
  });

  it('names each problem and counts them in the announced summary', () => {
    standalone(false);
    live.streamUp = false;
    live.lastSync = null;
    render(<SettingsView tab="health" />);
    expect(
      screen.getByText(/Everything is connected|need attention/, { selector: '[role=status]' }).textContent,
    ).toBe('2 things need attention: Connection and Brain sync.');
    expect(screen.getByText(/^Lost the live connection/)).toBeTruthy();
    // The state is in words too, not only the dot's colour.
    expect(screen.getAllByText('Needs attention')).toHaveLength(2);
    expect(screen.getByText(/has not seen the brain sync yet/)).toBeTruthy();
  });
});

describe('Dock app row', () => {
  it('says installed when running as the installed app', () => {
    standalone(true);
    render(<SettingsView tab="about" />);
    expect(screen.getByText('Installed. TDS Cortex is in your Dock.')).toBeTruthy();
  });

  it('walks manual, button, dismissed, then added', async () => {
    standalone(false);
    captureInstallPrompt();
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/If TDS Cortex isn't in your Dock yet/)).toBeTruthy();
    const prompt = vi.fn().mockResolvedValue(undefined);
    await chromeEvent('beforeinstallprompt', {
      prompt,
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add TDS Cortex to your Dock' }));
    });
    expect(prompt).toHaveBeenCalled();
    expect(screen.getByText("Not added. You can add it later from Chrome's menu.")).toBeTruthy();
    await chromeEvent('appinstalled');
    expect(screen.getByText('Added. TDS Cortex is in your Dock.')).toBeTruthy();
  });
});

describe("what's changed", () => {
  it('is shown to everyone', () => {
    standalone(false);
    for (const role of ['team', 'unknown', 'owner', 'scout']) {
      boot.identity.role = role;
      render(<SettingsView tab="about" />);
      expect(screen.getByRole('heading', { name: "What's changed" })).toBeTruthy();
      cleanup();
    }
    boot.identity.role = 'team';
  });
});

describe('check for updates', () => {
  it('shows phase words while running, and the error with Try again when failed', () => {
    standalone(false);
    setUpd({ available: true, phase: 'building' });
    const { unmount } = render(<SettingsView tab="about" />);
    expect(screen.getByText('Building the update…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull();
    unmount();
    const h = setUpd({ available: true, phase: 'failed', error: "The update couldn't be built." });
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/couldn't be built/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('checks by hand and shows Checking… while it runs', () => {
    standalone(false);
    const h = setUpd();
    const { unmount } = render(<SettingsView tab="about" />);
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(h.check).toHaveBeenCalledTimes(1);
    unmount();
    setUpd({}, { checking: true });
    render(<SettingsView tab="about" />);
    const busy = screen.getByRole('button', { name: 'Checking…' });
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(busy);
    expect(upd.current.check).not.toHaveBeenCalled();
  });

  it('says you have the newest version, with the time of the last check', () => {
    standalone(false);
    setUpd({ checkedAt: '2026-11-13T14:05:00' });
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/You have the newest version\./)).toBeTruthy();
    expect(screen.getByText(/Last checked 14:05/)).toBeTruthy();
  });

  it('offers the update when a newer version is ready', () => {
    standalone(false);
    const h = setUpd({ available: true, latest: '1.1.0', checkedAt: '2026-11-13T14:05:00' });
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/1\.1\.0 is available\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update and restart' }));
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('says why this copy cannot update itself', () => {
    standalone(false);
    setUpd({ blocked: 'not-git' });
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/wasn't installed from GitHub/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update and restart' })).toBeNull();
  });

  it('says when GitHub could not be reached', () => {
    standalone(false);
    setUpd({ checkFailed: true });
    render(<SettingsView tab="about" />);
    expect(screen.getByText(/Couldn't check for updates/)).toBeTruthy();
  });
});

describe('Model: automatic or choose myself', () => {
  it('shows Automatic (recommended) first, with its line, and hides Model and Effort', () => {
    boot.prefs = { directWrites: false, model: null, effort: null, levelMode: 'auto' };
    render(<SettingsView tab="claude" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Automatic (recommended)', 'Choose myself']);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(
      screen.getByText(
        'The app picks Quick, Standard or Deep for each chat. You can change it under the message box.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Effort')).toBeNull();
  });

  it('Choose myself saves levelMode and shows the v0.19.0 controls', () => {
    boot.prefs = { directWrites: false, model: null, effort: null, levelMode: 'auto' };
    render(<SettingsView tab="claude" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Choose myself' }));
    expect(st.updatePrefs).toHaveBeenCalledWith({ levelMode: 'manual' });
    cleanup();
    boot.prefs = { directWrites: false, model: 'opus', effort: 'high', levelMode: 'manual' };
    render(<SettingsView tab="claude" />);
    expect(selectOf('Model').value).toBe('opus');
    expect(selectOf('Effort').value).toBe('high');
  });

  it('keeps the old controls, with no choice, on a server that sends no levelMode', () => {
    render(<SettingsView tab="claude" />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(selectOf('Model')).toBeTruthy();
  });
});

describe('Skill levels', () => {
  const levels = (over: Record<string, unknown> = {}) => ({
    levels: {
      'google-ads-audit': { tier: 'deep', setBy: 'ian-hancock', at: '2026-11-03T10:00:00.000Z' },
    },
    canSet: false,
    writable: true,
    ...over,
  });

  it('is a read-only list for the team, with one line saying who can change it', () => {
    st.skillLevels = levels();
    render(<SettingsView tab="skill-levels" />);
    expect(screen.getByRole('heading', { name: 'Skill levels' })).toBeTruthy();
    expect(screen.getByText('Google Ads audit')).toBeTruthy();
    expect(screen.getByText('Deep · set by Ian Hancock, 3 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Only Owners and scouts can change these.')).toBeTruthy();
    expect(screen.queryByLabelText('Team level for Google Ads audit')).toBeNull();
    expect(screen.queryByRole('button', { name: /Clear/ })).toBeNull();
  });

  it('says when the skill-levels skill is not in the brain yet', () => {
    st.skillLevels = levels({ canSet: true, writable: false });
    render(<SettingsView tab="skill-levels" />);
    expect(screen.getByText(/once the brain has the skill-levels update/)).toBeTruthy();
    expect(screen.queryByLabelText('Team level for Google Ads audit')).toBeNull();
  });

  it('lets an Owner or scout change and clear a level', () => {
    st.skillLevels = levels({ canSet: true });
    render(<SettingsView tab="skill-levels" />);
    fireEvent.change(screen.getByLabelText('Team level for Google Ads audit'), {
      target: { value: 'quick' },
    });
    expect(st.setSkillLevel).toHaveBeenCalledWith('google-ads-audit', 'quick');
    fireEvent.click(screen.getByRole('button', { name: 'Clear the team level for Google Ads audit' }));
    expect(st.setSkillLevel).toHaveBeenCalledWith('google-ads-audit', null);
  });

  it('finds a skill with no level by search, so one can be set', () => {
    st.skillLevels = levels({ canSet: true });
    render(<SettingsView tab="skill-levels" />);
    expect(screen.queryByText('Write a post')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search skills'), { target: { value: 'post' } });
    fireEvent.change(screen.getByLabelText('Team level for Write a post'), { target: { value: 'standard' } });
    expect(st.setSkillLevel).toHaveBeenCalledWith('write-post', 'standard');
  });

  it('tells an editor how many skills have no team level, and words a pre-filled row', () => {
    st.skillLevels = levels({
      canSet: true,
      levels: { 'google-ads-audit': { tier: 'standard', setBy: 'prefill', at: '2026-11-14T09:00:00Z' } },
    });
    render(<SettingsView tab="skill-levels" />);
    expect(screen.getByText(/no team level yet\. Search to set one\./)).toBeTruthy();
    expect(screen.getByText('Standard · suggested by the app and reviewed, 14 Nov 2026')).toBeTruthy();
  });

  it('is absent on an older server', () => {
    render(<SettingsView tab="skill-levels" />);
    expect(screen.queryByRole('heading', { name: 'Skill levels' })).toBeNull();
  });
});

describe('Tokens saved', () => {
  it('shows its own lines, the cache line apart, and the kits line, with no team text', async () => {
    st.usageSavings.mockResolvedValue({
      since: '2026-11-03',
      today: totals(1200),
      last7: totals(9300, 400_000),
      last30: totals(150_000),
      all: totals(2_500_000_000, 3_000_000),
      kitsMode: 'shadow',
      team: null,
    });
    render(<SettingsView tab="claude" />);
    const h = await screen.findByRole('heading', { name: 'Tokens saved' });
    const sec = h.closest('section') as HTMLElement;
    await screen.findByText('Today');
    const text = sec.textContent ?? '';
    expect(text).toContain('Saved by summarising long chats');
    expect(text).toContain('How much shorter chats became when Claude summarised them.');
    expect(text).toContain('Tokens are the small pieces of text Claude reads and writes.');
    expect(text).toContain('1.2k tokens');
    expect(text).toContain('9.3k tokens');
    expect(text).toContain('150k tokens');
    expect(text).toContain('Since 3 Nov 2026');
    expect(text).toContain('2.5B tokens');
    expect(text).toContain("Reused from Claude's memory");
    expect(text).toContain('3M tokens since 3 Nov 2026');
    expect(text).toContain('not counted as saved');
    expect(text).toContain('Start-up kits: watching, nothing switched off yet');
    expect(text).toContain('learning which tools each chat needs');
    expect(text.toLowerCase()).not.toContain('team');
  });
  it('says nothing is counted yet, and still shows the kits line', async () => {
    render(<SettingsView tab="claude" />);
    expect(await screen.findByText(/Nothing counted yet/)).toBeTruthy();
    expect(screen.queryByText('Today')).toBeNull();
    expect(screen.getByText(/Start-up kits: watching/)).toBeTruthy();
  });
  it('says it is loading the token figures while it waits', async () => {
    st.usageSavings.mockReturnValue(new Promise(() => {}));
    render(<SettingsView tab="claude" />);
    const el = await screen.findByText('Loading…');
    expect(el.getAttribute('role')).toBe('status');
  });
  it('says so when the figures cannot be loaded', async () => {
    st.usageSavings.mockRejectedValue(new Error('x'));
    render(<SettingsView tab="claude" />);
    expect(await screen.findByText(/Couldn't load the token figures/)).toBeTruthy();
    expect(screen.queryByText(/Start-up kits/)).toBeNull();
  });
});

describe('help links', () => {
  const pages: [string, 28 | 32][] = [
    ['tokens-saved', 32],
    ['change-todos-setting', 28],
    ['keyboard-shortcuts', 28],
    ['picking-the-client', 28],
    ['levels', 28],
    ['version-history', 32],
  ];

  it('an owner gets a link to each page, row links 28px and heading links 32px', () => {
    boot.identity = { ...boot.identity, role: 'owner' };
    boot.prefs = { directWrites: false, model: null, effort: null, levelMode: 'auto' } as typeof boot.prefs;
    setUpd();
    render(<AllTabs />);
    for (const [page, size] of pages) {
      const b = screen.getByRole('button', { name: `Help: ${page}` });
      expect(b.getAttribute('data-size')).toBe(size === 28 ? 'small' : null);
    }
    expect(screen.getByRole('button', { name: 'Help: health' })).toBeTruthy();
  });

  it('an owner gets the skill levels link when the section shows', () => {
    boot.identity = { ...boot.identity, role: 'owner' };
    st.skillLevels = { levels: {}, canSet: true, writable: true };
    setUpd();
    render(<AllTabs />);
    expect(screen.getByRole('button', { name: 'Help: skill-levels' })).toBeTruthy();
  });

  it('is shown to a team member too', () => {
    boot.prefs = { directWrites: false, model: null, effort: null, levelMode: 'auto' } as typeof boot.prefs;
    st.skillLevels = { levels: {}, canSet: true, writable: true };
    setUpd();
    render(<AllTabs />);
    expect(screen.getAllByRole('button', { name: /^Help:/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Read the Cortex Guide' })).toBeTruthy();
  });

  it('an owner can read the Cortex Guide from About', () => {
    boot.identity = { ...boot.identity, role: 'owner' };
    setUpd();
    render(<AllTabs />);
    fireEvent.click(screen.getByRole('button', { name: 'Read the Cortex Guide' }));
    expect(openView).toHaveBeenCalledWith('guide');
  });
});

describe('sections on their tabs', () => {
  const heading = (name: string | RegExp) => screen.queryByRole('heading', { name });
  const shows = (tab: 'general' | 'claude' | 'skill-levels' | 'health' | 'about') => {
    render(<SettingsView tab={tab} />);
    const found = {
      prefs: heading('Preferences') !== null,
      claude: heading('Claude in chats') !== null,
      saved: heading('Tokens saved') !== null,
      levels: heading('Skill levels') !== null,
      health: heading('How TDS Cortex is running') !== null,
      about: heading(/^About TDS Cortex/) !== null,
    };
    cleanup();
    return Object.entries(found)
      .filter(([, on]) => on)
      .map(([k]) => k);
  };

  it('puts each section on one tab only', () => {
    standalone(false);
    st.skillLevels = { levels: {}, canSet: false, writable: true };
    expect(shows('general')).toEqual(['prefs']);
    expect(shows('claude')).toEqual(['claude', 'saved']);
    expect(shows('skill-levels')).toEqual(['levels']);
    expect(shows('health')).toEqual(['health']);
    expect(shows('about')).toEqual(['about']);
  });

  it("shows What's changed on About for owners only", () => {
    standalone(false);
    boot.identity = { ...boot.identity, role: 'owner' };
    render(<SettingsView tab="about" />);
    expect(heading("What's changed")).not.toBeNull();
    cleanup();
    render(<SettingsView tab="general" />);
    expect(heading("What's changed")).toBeNull();
  });

  it('uses the checks it is handed instead of working out its own', () => {
    standalone(false);
    const checks = [{ id: 'brain', label: 'Brain', state: 'ok', text: 'Fine.' }] as never;
    render(<SettingsView tab="health" checks={checks} />);
    expect(screen.getByText('Fine.')).toBeTruthy();
    expect(screen.queryByText(/Lost the live connection/)).toBeNull();
  });
});
