// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    await waitFor(() => expect(container.querySelectorAll('details')).toHaveLength(3));
    const folds = [...container.querySelectorAll('details')];
    expect(folds.map((d) => d.open)).toEqual([true, false, false]);
    expect(folds.map((d) => d.querySelector('summary')?.textContent)).toEqual([
      'Version 0.6.0, 13 November 2026 (this version)',
      'Version 0.5.0, 12 November 2026',
      'Version 0.4.0',
    ]);
  });

  it('says what kind each change is in plain words, with a capital letter', async () => {
    changelog.mockResolvedValue({ versions: VERSIONS });
    const { container } = render(<VersionHistory current="0.6.0" />);
    await waitFor(() => expect(container.querySelectorAll('details')).toHaveLength(3));
    const first = container.querySelectorAll('details')[0] as HTMLElement;
    expect(
      within(first)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['New: tdsapp-todo skill v0.3', 'Fixed: Keep a teammate’s fields']);
    const second = container.querySelectorAll('details')[1] as HTMLElement;
    expect(
      within(second)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Plain change', 'New: Add, edit and pass on']);
    const third = container.querySelectorAll('details')[2] as HTMLElement;
    expect(within(third).getByRole('listitem').textContent).toBe('Faster: Faster lists');
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
    await waitFor(() => expect(container.querySelectorAll('details')).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: 'Show older versions (2)' }));
    expect(container.querySelectorAll('details')).toHaveLength(7);
    expect(screen.queryByRole('button', { name: /Show older/ })).toBeNull();
  });
});
