// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const changelog = vi.fn();
vi.mock('../api.ts', () => ({ api: { changelog: () => changelog() } }));

const { VersionHistory } = await import('./VersionHistory.tsx');

const VERSIONS = [
  {
    version: '0.6.0',
    date: '2026-11-13',
    changes: [
      { kind: 'feat', text: 'tdsapp-todo skill v0.3' },
      { kind: 'fix', text: 'keep a teammate’s fields' },
    ],
  },
  {
    version: '0.5.0',
    date: '2026-11-12',
    changes: [
      { kind: '', text: 'plain change' },
      { kind: 'feat', text: 'add, edit and pass on' },
    ],
  },
  { version: '0.4.0', date: null, changes: [{ kind: 'perf', text: 'faster lists' }] },
];

afterEach(() => {
  cleanup();
  changelog.mockReset();
});

describe('VersionHistory', () => {
  it('lists every version newest first, each folding open and closed, with only the newest open', async () => {
    changelog.mockResolvedValue({ versions: VERSIONS });
    const { container } = render(<VersionHistory current="0.6.0" />);
    await waitFor(() => expect(container.querySelectorAll('.fold')).toHaveLength(3));
    const heads = screen.getAllByRole('button', { name: /^Version / });
    expect(heads.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false']);
    expect(heads.map((b) => b.textContent)).toEqual([
      'Version 0.6.0, 13 November 2026 (this version)',
      'Version 0.5.0, 12 November 2026',
      'Version 0.4.0',
    ]);
    fireEvent.click(heads[1] as HTMLElement);
    expect(heads[1]?.getAttribute('aria-expanded')).toBe('true');
  });

  it("uses the same fold and chevron as the drawers, not the browser's own arrow", async () => {
    changelog.mockResolvedValue({ versions: VERSIONS });
    const { container } = render(<VersionHistory current="0.6.0" />);
    await waitFor(() => expect(container.querySelectorAll('.fold')).toHaveLength(3));
    expect(container.querySelector('details')).toBeNull();
    for (const head of container.querySelectorAll('.fold-head > button')) {
      expect(head.querySelector('svg.icon')).not.toBeNull();
    }
  });

  it('says what kind each change is in plain words, with a capital letter', async () => {
    changelog.mockResolvedValue({ versions: VERSIONS });
    const { container } = render(<VersionHistory current="0.6.0" />);
    await waitFor(() => expect(container.querySelectorAll('.fold')).toHaveLength(3));
    const changes = (n: number) =>
      [
        ...(container.querySelectorAll('.fold')[n] as HTMLElement).querySelectorAll('.version-changes > li'),
      ].map((li) => li.textContent);
    expect(changes(0)).toEqual(['New: tdsapp-todo skill v0.3', 'Fixed: Keep a teammate’s fields']);
    expect(changes(1)).toEqual(['Plain change', 'New: Add, edit and pass on']);
    expect(changes(2)).toEqual(['Faster: Faster lists']);
  });

  it('says so when the history cannot be loaded, or is empty', async () => {
    changelog.mockRejectedValue(new Error('nope'));
    render(<VersionHistory current="0.6.0" />);
    expect(await screen.findByText("The version history couldn't be loaded.")).toBeTruthy();
    cleanup();
    changelog.mockResolvedValue({ versions: [] });
    render(<VersionHistory current="0.6.0" />);
    expect(await screen.findByText('No versions recorded yet.')).toBeTruthy();
  });

  it('shows the newest five, then the rest behind "Show older versions"', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      version: `0.${7 - i}.0`,
      date: null,
      changes: [{ kind: 'feat', text: `change ${i}` }],
    }));
    changelog.mockResolvedValue({ versions: many });
    const { container } = render(<VersionHistory current="0.7.0" />);
    await waitFor(() => expect(container.querySelectorAll('.fold')).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: 'Show older versions (2)' }));
    expect(container.querySelectorAll('.fold')).toHaveLength(7);
    expect(screen.queryByRole('button', { name: /Show older/ })).toBeNull();
  });
});
