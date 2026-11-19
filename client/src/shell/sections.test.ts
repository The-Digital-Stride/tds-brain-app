import { describe, expect, it } from 'vitest';
import type { AdsSummary } from '../../../shared/ads-contract.ts';
import {
  SECTIONS,
  sectionBadge,
  sectionKeys,
  toolFor,
  toolView,
  visibleSections,
  visibleToolFor,
  visibleTools,
} from './sections.ts';
import type { ToolSlot } from './sections-contract.ts';

const ads = (patch: Partial<AdsSummary> = {}): AdsSummary => ({
  visible: true,
  me: { slug: 'sam', name: 'Sam' } as AdsSummary['me'],
  sameIdentity: true,
  waiting: 3,
  clients: [],
  ...patch,
});
const workbench = SECTIONS[0];
if (!workbench) throw new Error('no sections');

describe('SECTIONS', () => {
  it('holds Workbench with W, and ids and keys are unique and lowercase', () => {
    expect(workbench.id).toBe('workbench');
    expect(workbench.key).toBe('w');
    expect(new Set(SECTIONS.map((s) => s.id)).size).toBe(SECTIONS.length);
    for (const s of SECTIONS) expect(s.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("no section key clashes with the shell's own single keys", () => {
    const taken = ['t', 'c', 's', 'h', 'p', 'n', '[', '/', '?'];
    for (const s of SECTIONS) if (s.key) expect(taken).not.toContain(s.key);
  });
});

describe('visibleTools', () => {
  it('shows nothing while the ads summary is unknown, or not visible', () => {
    expect(visibleTools(workbench, { ads: null })).toEqual([]);
    expect(visibleTools(workbench, { ads: ads({ visible: false }) })).toEqual([]);
  });

  it('shows the three Ads tools once visible, in order, all in the Ads group', () => {
    const shown = visibleTools(workbench, { ads: ads() });
    expect(shown.map((t) => t.id)).toEqual(['ad-manager', 'ads-command-centre', 'ads-account-summary']);
    expect(shown.map((t) => t.title)).toEqual(['Ads Manager', 'Ads Command Centre', 'Ads Account Summary']);
    expect(shown.every((t) => t.group === 'Ads')).toBe(true);
  });

  it('keeps the order of tools and drops the hidden ones', () => {
    const tool = (id: string, visible: boolean): ToolSlot =>
      ({ id, visible: () => visible }) as unknown as ToolSlot;
    const section = { ...workbench, tools: [tool('a', true), tool('b', false), tool('c', true)] };
    expect(visibleTools(section, { ads: null }).map((t) => t.id)).toEqual(['a', 'c']);
  });
});

describe('the rail', () => {
  it('lists a section only with a visible tool', () => {
    expect(visibleSections({ ads: null })).toEqual([]);
    expect(visibleSections({ ads: ads() })).toEqual([workbench]);
  });

  it('counts the visible tools badges, and W only while visible', () => {
    expect(sectionBadge(workbench, { ads: ads({ waiting: 4 }) })).toBe(4);
    // Due tasks are a note on the drawer row, never part of the rail's waiting count.
    expect(sectionBadge(workbench, { ads: ads({ waiting: 4 }), adsDue: 9 })).toBe(4);
    expect(sectionBadge(workbench, { ads: null })).toBe(0);
    expect(sectionKeys({ ads: null })).toEqual({});
    expect(sectionKeys({ ads: ads() })).toEqual({ w: 'workbench' });
  });
});

describe('tool views', () => {
  it('round-trips a tool view, and refuses unknown or malformed ones', () => {
    const view = toolView('workbench', 'ad-manager');
    expect(view).toBe('tool:workbench/ad-manager');
    expect(toolFor(view)?.tool.id).toBe('ad-manager');
    expect(toolFor('tool:workbench/nope')).toBeNull();
    expect(toolFor('tool:nope/ad-manager')).toBeNull();
    expect(toolFor('tool:workbench')).toBeNull();
    expect(toolFor('tool:workbench/ad-manager/x')).toBeNull();
    expect(toolFor('app:images')).toBeNull();
  });

  it('each Ads tool opens directly at its own view, with no visit to Ads Manager first', () => {
    for (const id of ['ad-manager', 'ads-command-centre', 'ads-account-summary']) {
      const view = toolView('workbench', id);
      expect(view).toBe(`tool:workbench/${id}`);
      expect(toolFor(view)?.tool.id).toBe(id);
      expect(visibleToolFor(view, { ads: ads() })?.tool.id).toBe(id);
      expect(visibleToolFor(view, { ads: null })).toBeNull();
    }
  });

  it('each Ads tool shows a note and count as it should', () => {
    const [manager, command, summary] = workbench.tools;
    const snap = { ads: ads({ waiting: 2 }), adsDue: 3 };
    expect(manager?.badge?.(snap)).toBe(2);
    expect(manager?.rowNote?.(snap) ?? null).toBeNull();
    expect(command?.badge?.(snap)).toBe(0);
    expect(command?.rowNote?.(snap)).toBe('3 due');
    expect(command?.rowNote?.({ ads: ads(), adsDue: 0 })).toBeNull();
    expect(command?.rowNote?.({ ads: ads(), adsDue: null })).toBeNull();
    expect(command?.rowNote?.({ ads: ads() })).toBeNull();
    expect(summary?.badge).toBeUndefined();
    expect(summary?.rowNote).toBeUndefined();
  });

  it('Rate calls is the Ads Command Centre panel, and the others keep theirs', () => {
    const [manager, command, summary] = workbench.tools;
    expect(command?.Panel).toBeDefined();
    expect(command?.panelLabel).toBe('Rate calls');
    expect(manager?.panelLabel).toBe('Proposal');
    expect(summary?.Panel).toBeUndefined();
  });

  it('an invisible tool view resolves to nothing (so the sheet shows Home)', () => {
    expect(visibleToolFor('tool:workbench/ad-manager', { ads: null })).toBeNull();
    expect(visibleToolFor('tool:workbench/ad-manager', { ads: ads() })?.tool.id).toBe('ad-manager');
  });
});
