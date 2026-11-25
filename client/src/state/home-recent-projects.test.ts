import { describe, expect, it } from 'vitest';
import type { ProjectCard } from '../../../shared/projects-contract.ts';
import { recentProjects } from './home-pins.ts';

const card = (key: string, at: string | null, over: Partial<ProjectCard> = {}): ProjectCard =>
  ({
    key,
    status: 'active',
    archived: false,
    lastChanged: at ? { by: 'ian', at } : null,
    ...over,
  }) as ProjectCard;

describe('recentProjects', () => {
  it('lists open projects newest-worked first', () => {
    const rows = recentProjects([card('a', '2026-11-01T10:00:00Z'), card('b', '2026-11-24T10:00:00Z')]);
    expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
  });
  it('leaves out done, archived and never-changed projects', () => {
    const rows = recentProjects([
      card('done', '2026-11-24T10:00:00Z', { status: 'done' }),
      card('arch', '2026-11-24T10:00:00Z', { archived: true }),
      card('none', null),
      card('ok', '2026-11-02T10:00:00Z'),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['ok']);
  });
  it('lists only projects this person worked on, by their own last change, once the server says', () => {
    const rows = recentProjects([
      card('team-newest', '2026-11-25T10:00:00Z', { lastMine: null }),
      card('mine-old', '2026-11-25T09:00:00Z', { lastMine: '2026-11-02T10:00:00Z' }),
      card('mine-new', '2026-11-01T10:00:00Z', { lastMine: '2026-11-20T10:00:00Z' }),
      card('mine-done', '2026-11-01T10:00:00Z', { lastMine: '2026-11-24T10:00:00Z', status: 'done' }),
    ]);
    expect(rows.map((r) => r.key)).toEqual(['mine-new', 'mine-old']);
  });
  it("falls back to anyone's last change when the server sends no lastMine (older server, history unread)", () => {
    const rows = recentProjects([card('a', '2026-11-01T10:00:00Z'), card('b', '2026-11-24T10:00:00Z')]);
    expect(rows.map((r) => r.key)).toEqual(['b', 'a']);
  });
  it('copes with no list yet', () => {
    expect(recentProjects(undefined)).toEqual([]);
  });
});
