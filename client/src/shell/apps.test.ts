import { describe, expect, it } from 'vitest';
import { APPS } from './apps.ts';
import { searchSources } from './search-sources.ts';
import { SECTIONS } from './sections.ts';

/**
 * Apps that may declare `search: null`, each with the reason. Empty today: both apps are searchable. A new
 * app is searchable as part of building it (plan 2026-11-13-global-search, decision 9); an entry here
 * needs a reason a reviewer would accept, e.g. "holds nothing a person would look up".
 */
const NULL_SEARCH_REASONS: Record<string, string> = {};

describe('APPS', () => {
  it('holds the library apps in a normal build, each with a panel of its own', () => {
    expect(APPS.map((a) => a.id)).toEqual(['images', 'documents']);
    expect(APPS[0]?.Panel).toBeDefined();
    expect(APPS[0]?.panelLabel).toBe('Image details');
    expect(APPS[1]?.Panel).toBeDefined();
    expect(APPS[1]?.panelLabel).toBe('Document details');
  });
});

describe('APPS and the global search', () => {
  it('every app declares search, or is listed with a reason for having none', () => {
    const unexplained = APPS.filter((a) => a.search === null && !NULL_SEARCH_REASONS[a.id]).map((a) => a.id);
    expect(
      unexplained,
      `These apps have \`search: null\` with no reason in NULL_SEARCH_REASONS: ${unexplained.join(', ')}. ` +
        'Give the app an AppSlot.search source, or add a reason here.',
    ).toEqual([]);
  });

  it('a reason is only listed for an app that exists and really has no search', () => {
    for (const id of Object.keys(NULL_SEARCH_REASONS)) {
      const app = APPS.find((a) => a.id === id);
      expect(app, `${id} is in NULL_SEARCH_REASONS but is not in APPS`).toBeDefined();
      expect(app?.search, `${id} has a search source: drop its reason`).toBeNull();
    }
  });

  it("every app's search source is in the palette's sources, exactly once, with a way to search", () => {
    const ids = searchSources().map((s) => s.id);
    for (const app of APPS) {
      if (!app.search) continue;
      expect(ids.filter((id) => id === app.search?.id)).toHaveLength(1);
      expect(searchSources()).toContain(app.search);
      expect(Boolean(app.search.search) !== Boolean(app.search.searchAsync)).toBe(true);
      expect(app.search.title.length).toBeGreaterThan(0);
    }
  });

  it('source ids are unique, and async sources come last', () => {
    const sources = searchSources();
    const ids = sources.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstAsync = sources.findIndex((s) => s.searchAsync);
    expect(sources.slice(firstAsync).every((s) => s.searchAsync)).toBe(true);
  });

  it('the apps are in "Go to" too', () => {
    const go = searchSources()[0]?.idle?.({
      me: '',
      todos: null,
      live: [],
      past: [],
      skills: [],
      pins: [],
      clients: [],
    });
    expect(go?.map((h) => h.label)).toEqual(expect.arrayContaining(APPS.map((a) => a.title)));
  });
});

/** Tools that may declare `search: null`, each with the reason (same rule as apps). */
const TOOL_NULL_SEARCH_REASONS: Record<string, string> = {};

describe('section tools and the global search', () => {
  const tools = SECTIONS.flatMap((s) => s.tools);

  it('every tool declares search, or is listed with a reason for having none', () => {
    const unexplained = tools
      .filter((t) => t.search === null && !TOOL_NULL_SEARCH_REASONS[t.id])
      .map((t) => t.id);
    expect(unexplained, `Tools with \`search: null\` and no reason: ${unexplained.join(', ')}`).toEqual([]);
  });

  it("a tool's search source is in the palette's sources exactly once", () => {
    const ids = searchSources().map((s) => s.id);
    for (const t of tools) {
      if (!t.search) continue;
      expect(ids.filter((id) => id === t.search?.id)).toHaveLength(1);
      expect(searchSources()).toContain(t.search);
    }
  });

  it('a reason is only listed for a tool that exists and really has no search', () => {
    for (const id of Object.keys(TOOL_NULL_SEARCH_REASONS)) {
      const tool = tools.find((t) => t.id === id);
      expect(tool, `${id} is in TOOL_NULL_SEARCH_REASONS but is not a tool`).toBeDefined();
      expect(tool?.search).toBeNull();
    }
  });

  it('tool ids are unique across sections', () => {
    const ids = tools.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
