import { describe, expect, it } from 'vitest';
import { helpForContext } from './context.ts';
import type { HelpContext, HelpTopic } from './contract.ts';
import { createHelpLibrary } from './library.ts';
import { HELP_TOPIC_IDS } from './topics.ts';

const topics: HelpTopic[] = HELP_TOPIC_IDS.map((id, i) => ({
  id,
  title: id,
  area: 'home',
  order: i,
  summary: id,
  benefit: id,
  roles: 'all',
  related: [],
  since: '0.36.0',
  reviewed: '2026-11-20',
  body: '',
}));
const full = createHelpLibrary(topics);
const ctx = (over: Partial<HelpContext>): HelpContext => ({
  view: 'home',
  drawer: null,
  waiting: false,
  ...over,
});

describe('helpForContext', () => {
  const rows: [string, HelpContext, string][] = [
    ['chats drawer', ctx({ drawer: 'chats' }), 'chats-drawer'],
    ['todos drawer', ctx({ drawer: 'todos' }), 'todos'],
    ['skills drawer', ctx({ drawer: 'skills' }), 'skills'],
    ['drawer beats a waiting chat', ctx({ view: 'chat', waiting: true, drawer: 'todos' }), 'todos'],
    [
      'help drawer falls through to the view',
      ctx({ drawer: 'help' as unknown as HelpContext['drawer'], view: 'app:images' }),
      'images',
    ],
    ['waiting chat', ctx({ view: 'chat', waiting: true }), 'approvals-and-questions'],
    ['waiting does not matter on Home', ctx({ view: 'home', waiting: true }), 'home'],
    ['home', ctx({ view: 'home' }), 'home'],
    ['chat', ctx({ view: 'chat' }), 'talking-to-claude'],
    ['documents app', ctx({ view: 'app:documents' }), 'documents'],
    ['images app', ctx({ view: 'app:images' }), 'images'],
    ['other app', ctx({ view: 'app:other' }), 'welcome'],
    ['settings', ctx({ view: 'settings' }), 'settings'],
    ['settings, general tab', ctx({ view: 'settings', settingsTab: 'general' }), 'settings'],
    ['settings, claude tab', ctx({ view: 'settings', settingsTab: 'claude' }), 'levels'],
    ['settings, skill levels tab', ctx({ view: 'settings', settingsTab: 'skill-levels' }), 'skill-levels'],
    ['settings, health tab', ctx({ view: 'settings', settingsTab: 'health' }), 'health'],
    ['settings, about tab', ctx({ view: 'settings', settingsTab: 'about' }), 'settings'],
    ['settings, unknown tab', ctx({ view: 'settings', settingsTab: 'nope' }), 'settings'],
    ['profile', ctx({ view: 'profile' }), 'your-profile'],
    ['guide', ctx({ view: 'guide' }), 'cortex-guide'],
    ['a drawer beats settings', ctx({ view: 'settings', drawer: 'todos' }), 'todos'],
  ];
  for (const [name, c, id] of rows) it(name, () => expect(helpForContext(c, full)).toBe(id));

  it('falls back to welcome when the page is not in the library', () => {
    const partial = createHelpLibrary(topics.filter((t) => t.id === 'welcome'));
    expect(helpForContext(ctx({ drawer: 'todos' }), partial)).toBe('welcome');
  });
});

describe('helpForContext: sections and tools', () => {
  const lib = (ids: string[]) =>
    ({ byId: (id: string) => (ids.includes(id) ? ({ id } as never) : undefined) }) as never;
  const ctx = (over: object) => ({ view: 'home', drawer: null, waiting: false, ...over }) as never;

  it('the section drawer opens the Workbench page', () => {
    expect(helpForContext(ctx({ drawer: 'section' }), lib(['workbench', 'welcome']))).toBe('workbench');
  });

  it("a tool opens its own page, else its section's, else the fallback", () => {
    const view = 'tool:workbench/ad-manager';
    expect(helpForContext(ctx({ view }), lib(['ad-manager', 'workbench', 'welcome']))).toBe('ad-manager');
    expect(helpForContext(ctx({ view }), lib(['workbench', 'welcome']))).toBe('workbench');
    expect(helpForContext(ctx({ view }), lib(['welcome']))).toBe('welcome');
  });
});
