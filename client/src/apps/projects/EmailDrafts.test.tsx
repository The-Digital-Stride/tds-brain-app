// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailDraftItem } from '../../../../shared/project-email-contract.ts';
import { card, projectList } from './testing.ts';

const api = vi.hoisted(() => ({ projectEmailDrafts: vi.fn(), projectEmailDraftAct: vi.fn() }));
vi.mock('../../api.ts', () => ({
  api,
  ApiFailure: class ApiFailure extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

const { EmailDrafts } = await import('./EmailDrafts.tsx');

const SITE = card({ slug: 'site', title: 'Sky site' });
const SEO = card({ slug: 'seo', title: 'Sky SEO' });
const list = projectList([SITE, SEO]);
const clients = [{ slug: 'skyseal', name: 'Skyseal' }];

const draft = (id: string, key: string | null, subject = `Subject ${id}`): EmailDraftItem => ({
  id,
  subject,
  from: 'Alex Smith',
  people: [],
  sentAt: '2026-11-20T16:30:00Z',
  summary: 'Summary.',
  route: { key, why: key ? 'subject-code' : 'none' },
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EmailDrafts', () => {
  it('lists drafts with subject, sender and date', async () => {
    api.projectEmailDrafts.mockResolvedValue({
      drafts: [draft('a', SITE.key), draft('b', null)],
      unreadable: 0,
      canApprove: true,
    });
    render(<EmailDrafts list={list} clients={clients} />);
    expect(await screen.findByText('Subject a')).toBeTruthy();
    expect(screen.getByText('Subject b')).toBeTruthy();
    expect(screen.getAllByText(/From Alex Smith · 20 Nov 2026/)).toHaveLength(2);
    expect(api.projectEmailDrafts).toHaveBeenCalledWith(undefined);
  });

  it("on a project's Overview asks for that project's drafts only", async () => {
    api.projectEmailDrafts.mockResolvedValue({
      drafts: [draft('a', SITE.key)],
      unreadable: 0,
      canApprove: true,
    });
    render(<EmailDrafts list={list} clients={clients} projectKey={SITE.key} />);
    expect(await screen.findByText('Subject a')).toBeTruthy();
    expect(api.projectEmailDrafts).toHaveBeenCalledWith(SITE.key);
  });

  it('shows nothing with no drafts or without canApprove', async () => {
    api.projectEmailDrafts.mockResolvedValue({ drafts: [], unreadable: 0, canApprove: true });
    const { container, rerender } = render(<EmailDrafts list={list} clients={clients} />);
    await waitFor(() => expect(api.projectEmailDrafts).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    api.projectEmailDrafts.mockResolvedValue({
      drafts: [draft('a', null)],
      unreadable: 0,
      canApprove: false,
    });
    rerender(<EmailDrafts list={list} clients={clients} projectKey={SEO.key} />);
    await waitFor(() => expect(api.projectEmailDrafts).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe('');
  });

  it('opens the approval sheet pre-selected, saves, refreshes and tells the page', async () => {
    api.projectEmailDrafts
      .mockResolvedValueOnce({ drafts: [draft('a', SITE.key)], unreadable: 0, canApprove: true })
      .mockResolvedValue({ drafts: [], unreadable: 0, canApprove: true });
    api.projectEmailDraftAct.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    render(<EmailDrafts list={list} clients={clients} onSaved={onSaved} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review email: Subject a' }));
    expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe(SITE.key);
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(SITE.key));
    expect(api.projectEmailDrafts).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/^Saved to the project\./)).toBeTruthy();
    expect(screen.queryByText('Subject a')).toBeNull();
  });

  it('says where an email already is and drops the row', async () => {
    api.projectEmailDrafts
      .mockResolvedValueOnce({ drafts: [draft('a', null)], unreadable: 0, canApprove: true })
      .mockResolvedValue({ drafts: [], unreadable: 0, canApprove: true });
    api.projectEmailDraftAct.mockResolvedValue({ ok: false, code: 'exists', key: SEO.key, byName: 'Sam' });
    render(<EmailDrafts list={list} clients={clients} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review email: Subject a' }));
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: SITE.key } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    expect(await screen.findByText(/^Already in Sky SEO, added by Sam\./)).toBeTruthy();
    expect(screen.queryByText('Subject a')).toBeNull();
  });
});
