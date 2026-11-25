import { describe, expect, it, vi } from 'vitest';
import { HOME_ITEMS } from '../shell/home-items.ts';
import {
  isShown,
  panelItems,
  resolveShortcut,
  type ShortcutSources,
  shortcutChoices,
} from './home-layout.ts';

const actions = { startSkill: vi.fn(), openTool: vi.fn(), openPlace: vi.fn(), openDrawer: vi.fn() };
const src = (over: Partial<ShortcutSources> = {}): ShortcutSources => ({
  skills: [
    { name: 'gm', title: 'Good morning' },
    { name: 'standup', title: 'Standup' },
    { name: 'meeting-notes', title: 'Meeting notes' },
  ],
  tools: [{ section: 'workbench', tool: 'ad-manager', title: 'Ads Manager' }],
  places: [
    { id: 'projects', title: 'Projects' },
    { id: 'documents', title: 'Documents' },
  ],
  drawers: [
    { id: 'todos', title: 'Tasks' },
    { id: 'chats', title: 'Chats' },
  ],
  actions,
  ...over,
});

describe('isShown', () => {
  it('shows unless hidden, and needs its own condition too', () => {
    expect(isShown('files', undefined)).toBe(true);
    expect(isShown('files', [])).toBe(true);
    expect(isShown('files', ['files'])).toBe(false);
    expect(isShown('ads', [], false)).toBe(false);
    expect(isShown('ads', [], true)).toBe(true);
    expect(isShown('ads', ['ads'], true)).toBe(false);
  });
});

describe('resolveShortcut', () => {
  it('a skill in the Brain is ready and starts the skill', () => {
    const r = resolveShortcut({ kind: 'skill', name: 'standup' }, src());
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') return;
    expect(r.label).toBe('Standup');
    expect(r.key).toBe('skill:standup');
    r.run();
    expect(actions.startSkill).toHaveBeenCalledWith('standup');
  });
  it('a skill that is not in the Brain is gone, keeping its name as the label', () => {
    expect(resolveShortcut({ kind: 'skill', name: 'old' }, src())).toEqual({
      state: 'gone',
      key: 'skill:old',
      label: 'old',
    });
  });
  it('a tool is ready and opens the tool', () => {
    const r = resolveShortcut({ kind: 'tool', section: 'workbench', tool: 'ad-manager' }, src());
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') return;
    expect(r.label).toBe('Ads Manager');
    r.run();
    expect(actions.openTool).toHaveBeenCalledWith('workbench', 'ad-manager');
  });
  it('a tool waits while the tool list is loading', () => {
    expect(
      resolveShortcut({ kind: 'tool', section: 'workbench', tool: 'ad-manager' }, src({ tools: null })),
    ).toEqual({
      state: 'waiting',
      key: 'tool:workbench/ad-manager',
    });
  });
  it('a tool missing from a loaded list is gone', () => {
    const r = resolveShortcut({ kind: 'tool', section: 'workbench', tool: 'nope' }, src());
    expect(r.state).toBe('gone');
  });
});

describe('resolveShortcut for places and drawers', () => {
  it('a place is ready, labelled by its title, and opens it', () => {
    const r = resolveShortcut({ kind: 'place', place: 'documents' }, src());
    expect(r).toMatchObject({ state: 'ready', key: 'place:documents', label: 'Documents' });
    if (r.state === 'ready') r.run();
    expect(actions.openPlace).toHaveBeenCalledWith('documents');
  });
  it('a drawer is ready, labelled by its title, and opens it', () => {
    const r = resolveShortcut({ kind: 'drawer', drawer: 'todos' }, src());
    expect(r).toMatchObject({ state: 'ready', key: 'drawer:todos', label: 'Tasks' });
    if (r.state === 'ready') r.run();
    expect(actions.openDrawer).toHaveBeenCalledWith('todos');
  });
  it('a place or drawer this app no longer has is gone', () => {
    expect(resolveShortcut({ kind: 'place', place: 'images' }, src())).toMatchObject({
      state: 'gone',
      label: 'images',
    });
    expect(resolveShortcut({ kind: 'drawer', drawer: 'chats' }, src({ drawers: [] }))).toMatchObject({
      state: 'gone',
      label: 'chats',
    });
  });
});

describe('resolveShortcut with a static tool title', () => {
  it('a gone tool uses the static title, then the raw id', () => {
    const t: { kind: 'tool'; section: string; tool: string } = {
      kind: 'tool',
      section: 'workbench',
      tool: 'old',
    };
    expect(resolveShortcut(t, src({ tools: [], toolTitle: () => 'Old tool' }))).toEqual({
      state: 'gone',
      key: 'tool:workbench/old',
      label: 'Old tool',
    });
    expect(resolveShortcut(t, src({ tools: [] }))).toMatchObject({ state: 'gone', label: 'old' });
  });
});

describe('shortcutChoices', () => {
  it('lists Skills then Tools, without gm', () => {
    const c = shortcutChoices([], src());
    expect(c.map((x) => [x.group, x.label])).toEqual([
      ['Skills', 'Standup'],
      ['Skills', 'Meeting notes'],
      ['Tools', 'Ads Manager'],
      ['Places', 'Projects'],
      ['Places', 'Documents'],
      ['Drawers', 'Tasks'],
      ['Drawers', 'Chats'],
    ]);
  });
  it('leaves out what is already added', () => {
    const c = shortcutChoices(
      [
        { kind: 'skill', name: 'standup' },
        { kind: 'tool', section: 'workbench', tool: 'ad-manager' },
        { kind: 'place', place: 'projects' },
        { kind: 'drawer', drawer: 'chats' },
      ],
      src(),
    );
    expect(c.map((x) => x.label)).toEqual(['Meeting notes', 'Documents', 'Tasks']);
  });
  it('has no tools while the tool list loads', () => {
    expect(shortcutChoices([], src({ tools: null })).some((x) => x.group === 'Tools')).toBe(false);
  });
  it('marks a pinned skill "Also in Pinned skills"', () => {
    const c = shortcutChoices([], src(), ['meeting-notes']);
    expect(c.find((x) => x.label === 'Meeting notes')?.meta).toBe('Also in Pinned skills');
    expect(c.find((x) => x.label === 'Standup')?.meta).toBeUndefined();
  });
});

describe('panelItems', () => {
  const ids = (ctx: { hasGm: boolean; hasAds: boolean }) => panelItems(ctx).map((i) => i.id);
  it('drops start-my-day without gm and ads without access', () => {
    expect(ids({ hasGm: false, hasAds: false })).toEqual(
      HOME_ITEMS.map((i) => i.id).filter((i) => i !== 'start-my-day' && i !== 'ads'),
    );
  });
  it('keeps both when allowed, in Home order', () => {
    expect(ids({ hasGm: true, hasAds: true })).toEqual(HOME_ITEMS.map((i) => i.id));
  });
});
