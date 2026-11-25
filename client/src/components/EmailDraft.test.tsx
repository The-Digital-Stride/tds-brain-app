// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEmail } from '../../../shared/chat-email-draft-contract.ts';
import { EmailDraftCard } from './EmailDraft.tsx';

vi.mock('../store.tsx', () => ({
  useStore: () => ({ boot: { identity: { email: 'me@tds.example' } } }),
}));

const email = (over: Partial<ChatEmail> = {}): ChatEmail => ({
  to: ['jo@acme.co.uk'],
  cc: [],
  bcc: [],
  subject: 'Boiler quote',
  body: 'Hi Jo,\n\n**not bold** and a [link](https://x.example)\n\nRef: [ACM4K7]',
  dropped: 0,
  over: 0,
  ...over,
});
const open = vi.fn();
const writeText = vi.fn(async () => {});

beforeEach(() => {
  open.mockClear();
  writeText.mockClear();
  vi.stubGlobal('open', open);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = () => screen.getByRole('group', { name: /^Email draft/ });
const gmail = () => screen.getByRole('link', { name: /Open in Gmail/ });

describe('EmailDraftCard', () => {
  it('shows who it goes to, the subject and the text as plain text', () => {
    render(<EmailDraftCard email={email({ cc: ['kim@acme.co.uk'], bcc: ['boss@acme.co.uk'] })} ready />);
    expect(card().getAttribute('aria-label')).toBe('Email draft: Boiler quote');
    const rows = Array.from(card().querySelectorAll('dl > div')).map((d) => d.textContent);
    expect(rows).toEqual([
      'Tojo@acme.co.uk',
      'Cckim@acme.co.uk',
      'Bccboss@acme.co.uk',
      'SubjectBoiler quote',
    ]);
    // Markdown marks stay as written: this is what Gmail gets.
    const body = card().querySelector('.email-draft-body');
    expect(body?.textContent).toBe(email().body);
    expect(body?.querySelector('strong, a')).toBeNull();
  });

  it('says so when nobody is named, and leaves out empty lines', () => {
    render(<EmailDraftCard email={email({ to: [], subject: '' })} ready />);
    expect(card().getAttribute('aria-label')).toBe('Email draft');
    const rows = Array.from(card().querySelectorAll('dl > div')).map((d) => d.textContent);
    expect(rows).toEqual(['ToNobody yet. Add them in Gmail.']);
  });

  it('a plain click opens the small Gmail window filled in; the link itself goes to the same place', () => {
    render(<EmailDraftCard email={email()} ready />);
    const link = screen.getByRole('link', {
      name: 'Open in Gmail: Boiler quote (opens Gmail in a small window)',
    });
    const href = link.getAttribute('href') ?? '';
    const q = new URL(href).searchParams;
    expect(q.get('authuser')).toBe('me@tds.example');
    expect(q.get('to')).toBe('jo@acme.co.uk');
    expect(q.get('su')).toBe('Boiler quote');
    expect(q.get('body')).toBe(email().body);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe(href);
    expect(open.mock.calls[0]?.[2]).toMatch(/popup=yes,width=680,height=760,.*noopener,noreferrer/);
  });

  it('a click that asks for a tab is left to the browser', () => {
    render(<EmailDraftCard email={email()} ready />);
    expect(fireEvent.click(gmail(), { metaKey: true })).toBe(true);
    expect(fireEvent.click(gmail(), { button: 1 })).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('Copy text copies the message and says so', async () => {
    render(<EmailDraftCard email={email()} ready />);
    const copy = screen.getByRole('button', { name: 'Copy text: Boiler quote' });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(email().body);
    await waitFor(() => expect(within(card()).getByRole('status').textContent).toBe('Copied'));
    // The button's name still holds the words now on it.
    expect(screen.getByRole('button', { name: 'Copied: Boiler quote' })).toBe(copy);
  });

  it('a text too long for a link opens Gmail without it and says to copy it in', () => {
    render(<EmailDraftCard email={email({ body: 'long words '.repeat(1200) })} ready />);
    expect(card().textContent).toContain(
      'This email is too long to fill in for you. Press Copy text, then paste it into the Gmail window.',
    );
    const q = new URL(gmail().getAttribute('href') ?? '').searchParams;
    expect(q.has('body')).toBe(false);
    expect(q.get('to')).toBe('jo@acme.co.uk');
    // The card still shows all of it.
    expect(card().querySelector('.email-draft-body')?.textContent).toHaveLength(11 * 1200);
  });

  it('says when addresses were left out', () => {
    const { rerender } = render(<EmailDraftCard email={email({ dropped: 1 })} ready />);
    expect(card().textContent).toContain("1 address was left out: it didn't look like an email address.");
    rerender(<EmailDraftCard email={email({ dropped: 3, over: 2 })} ready />);
    expect(card().textContent).toContain("3 addresses were left out: they didn't look like email addresses.");
    expect(card().textContent).toContain("2 more addresses didn't fit. Add them in Gmail.");
    rerender(<EmailDraftCard email={email({ over: 1 })} ready />);
    expect(card().textContent).toContain("1 more address didn't fit. Add it in Gmail.");
  });

  it('has no buttons or notices while the email is still arriving', () => {
    render(<EmailDraftCard email={email({ dropped: 1 })} ready={false} />);
    expect(card().textContent).toContain('Hi Jo,');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(card().textContent).not.toContain('left out');
    expect(card().getAttribute('aria-busy')).toBe('true');
    expect(card().querySelector('.hint')?.textContent).toBe('Still writing…');
  });
});
