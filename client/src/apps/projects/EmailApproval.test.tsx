// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailDraftItem } from '../../../../shared/project-email-contract.ts';

const api = vi.hoisted(() => ({ projectEmailDraftAct: vi.fn() }));
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

const { EmailApproval, routeWords } = await import('./EmailApproval.tsx');

const draft = (over: Partial<EmailDraftItem> = {}): EmailDraftItem => ({
  id: 'abc123abc123',
  subject: 'Budget for December',
  from: 'Alex Smith',
  people: ['Jo Lee', 'Sam Roe'],
  sentAt: '2026-11-20T16:30:00Z',
  summary: 'They agreed the budget.',
  route: { key: 'skyseal/site', why: 'subject-code' },
  ...over,
});
const projects = [
  { key: 'skyseal/site', label: 'Skyseal: Site' },
  { key: 'skyseal/seo', label: 'Skyseal: SEO' },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('routeWords', () => {
  it('says why in plain words', () => {
    expect(routeWords({ key: 'a/b', why: 'subject-code' })).toBe('The project code is in the subject.');
    expect(routeWords({ key: null, why: 'codes-disagree', codes: ['SKY1A1', 'SKY2B2'] })).toBe(
      'The email has codes for different projects: SKY1A1, SKY2B2. Choose one.',
    );
    expect(routeWords({ key: null, why: 'none' })).toBe('No project matched this email. Choose one.');
    expect(routeWords({ key: 'a/b', why: 'thread-code' })).toBe('A project code earlier in this thread.');
  });
});

describe('EmailApproval', () => {
  it('pre-selects the routed project with its reason, and sends the edited fields', async () => {
    api.projectEmailDraftAct.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<EmailApproval draft={draft()} projects={projects} onDone={onDone} />);
    expect((screen.getByLabelText('Project') as HTMLSelectElement).value).toBe('skyseal/site');
    expect(screen.getByText('The project code is in the subject.')).toBeTruthy();
    expect((screen.getByLabelText('Client can see this') as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Budget, final' } });
    fireEvent.change(screen.getByLabelText('Who else was on it'), {
      target: { value: 'Smith, Alex\n Jo Lee \n' },
    });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: ' Agreed. ' } });
    fireEvent.click(screen.getByLabelText('Client can see this'));
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await waitFor(() =>
      expect(api.projectEmailDraftAct).toHaveBeenCalledWith({
        action: 'approve',
        id: 'abc123abc123',
        key: 'skyseal/site',
        summary: 'Agreed.',
        subject: 'Budget, final',
        from: 'Alex Smith',
        people: ['Smith, Alex', 'Jo Lee'],
        clientSafe: true,
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ done: 'saved', key: 'skyseal/site' }));
  });

  it('refuses an email address in the names before sending anything', () => {
    render(<EmailApproval draft={draft()} projects={projects} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Who else was on it'), { target: { value: 'jo@client.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    expect(api.projectEmailDraftAct).not.toHaveBeenCalled();
    expect(screen.getByText("Use people's names, not email addresses.")).toBeTruthy();
  });

  it('says why Save did nothing until a project is chosen, and the reason line follows the choice (UX review)', () => {
    render(
      <EmailApproval
        draft={draft({ route: { key: null, why: 'none' } })}
        projects={projects}
        onDone={vi.fn()}
      />,
    );
    const save = screen.getByRole('button', { name: 'Save to project' });
    expect(save.getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByText('No project matched this email. Choose one.')).toBeTruthy();
    fireEvent.click(save);
    expect(api.projectEmailDraftAct).not.toHaveBeenCalled();
    expect(screen.getByText('Choose a project first.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Project'));
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'skyseal/seo' } });
    expect(screen.getByText('You chose this project.')).toBeTruthy();
  });

  it('"Not for a project" dismisses', async () => {
    api.projectEmailDraftAct.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<EmailApproval draft={draft()} projects={projects} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not for a project' }));
    await waitFor(() =>
      expect(api.projectEmailDraftAct).toHaveBeenCalledWith({ action: 'dismiss', id: 'abc123abc123' }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ done: 'dismissed' }));
  });

  it('reports an email that is already in a project', async () => {
    api.projectEmailDraftAct.mockResolvedValue({
      ok: false,
      code: 'exists',
      key: 'skyseal/seo',
      byName: 'Sam',
    });
    const onDone = vi.fn();
    render(<EmailApproval draft={draft()} projects={projects} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ done: 'exists', key: 'skyseal/seo', byName: 'Sam' }),
    );
  });
});

describe('EmailApproval thread lines', () => {
  const thread = (over: Partial<NonNullable<EmailDraftItem['thread']>> = {}) => ({
    total: 4,
    fresh: 2,
    ...over,
  });
  const show = (d: EmailDraftItem) =>
    render(<EmailApproval draft={d} projects={projects} onDone={vi.fn()} />);

  it('says a code earlier in the thread picked the project', () => {
    show(draft({ route: { key: 'skyseal/site', why: 'thread-code' } }));
    expect(screen.getByText('A project code earlier in this thread.')).toBeTruthy();
  });

  it('says when the thread already in the project outranks a different code', () => {
    show(draft({ route: { key: 'skyseal/site', why: 'thread', overruled: 'SKY9Z9' }, thread: thread() }));
    expect(
      screen.getByText(/The newest email has the code SKY9Z9, but this thread is already in this project\./),
    ).toBeTruthy();
  });

  it('says which thread it adds to, and who saved it', () => {
    show(
      draft({
        thread: thread({ partOf: { key: 'skyseal/site', byName: 'Sam', at: '2026-11-20T10:00:00Z' } }),
      }),
    );
    expect(screen.getByText('Adds to a thread Sam saved on 20 Nov 2026.')).toBeTruthy();
  });

  it('calls an unnamed saver a teammate', () => {
    show(
      draft({
        thread: thread({ partOf: { key: 'skyseal/site', byName: null, at: '2026-11-20T10:00:00Z' } }),
      }),
    );
    expect(screen.getByText('Adds to a thread a teammate saved on 20 Nov 2026.')).toBeTruthy();
  });

  it('says how many messages the summary covers, in the singular and the plural, above Save', () => {
    show(draft({ thread: thread({ fresh: 1 }) }));
    const one = screen.getByText('This summary covers 1 message.');
    expect(one.compareDocumentPosition(screen.getByRole('button', { name: 'Save to project' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    cleanup();
    show(draft({ thread: thread({ fresh: 3 }) }));
    expect(screen.getByText('This summary covers 3 messages.')).toBeTruthy();
  });

  it('warns when a teammate saved part of the thread after the draft', () => {
    show(
      draft({
        thread: thread({
          overlap: true,
          partOf: { key: 'skyseal/site', byName: 'Sam', at: '2026-11-20T10:00:00Z' },
        }),
      }),
    );
    expect(
      screen.getByText(
        'Sam saved part of this thread after this was drafted. Check the summary for repeats.',
      ),
    ).toBeTruthy();
  });

  it('names an unknown saver in the warning as A teammate', () => {
    show(draft({ thread: thread({ overlap: true }) }));
    expect(
      screen.getByText(
        'A teammate saved part of this thread after this was drafted. Check the summary for repeats.',
      ),
    ).toBeTruthy();
  });

  it('shows none of it for a draft without thread', () => {
    show(draft());
    expect(screen.queryByText(/This summary covers/)).toBeNull();
    expect(screen.queryByText(/Adds to a thread/)).toBeNull();
    expect(screen.queryByText(/Check the summary for repeats/)).toBeNull();
    expect(screen.queryByText(/The newest email has the code/)).toBeNull();
  });
});
