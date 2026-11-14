// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatFile } from '../../../shared/contract.ts';
import { Transcript } from './Transcript.tsx';

afterEach(cleanup);

const scope = { id: 'client:acme', name: 'Acme', kind: 'client' as const };
const file = (key: string, path: string): ChatFile => ({
  key,
  path,
  item: null,
  scope,
  actions: ['mentioned'],
  toolUseIds: [],
  edits: 0,
  order: 1,
});

const reply = (id: string, text: string) => ({ kind: 'assistant' as const, id, text, done: true });

function renderReplies(texts: string[], files: ChatFile[]) {
  const onFile = vi.fn();
  render(
    <Transcript
      items={texts.map((t, i) => reply(`a${i}`, t))}
      sessionId="s"
      sessionState="idle"
      files={files}
      brainRoot="/brain"
      onFile={onFile}
    />,
  );
  return onFile;
}

const linksIn = (n: number) =>
  Array.from(document.querySelectorAll('.thread .markdown'))[n]?.querySelectorAll('a[href^="#chat-file="]') ??
  [];

describe('reply links to chat files', () => {
  it('links a lone name only in the reply that names its folder', () => {
    const onFile = renderReplies(
      ['All in `clients/acme/reports/`: `audit.md`.', 'For Beta, `audit.md` is due as well.'],
      [file('k1', 'clients/acme/reports/audit.md')],
    );
    expect(Array.from(linksIn(0)).map((a) => a.textContent)).toEqual(['audit.md']);
    expect(linksIn(1)).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('link', { name: 'audit.md' })[0] as Element);
    expect(onFile).toHaveBeenCalledWith('k1');
  });

  it('links no lone name the reply gives no folder for, even when the chat has only one file by that name', () => {
    renderReplies(
      ['`profile.md` and `context/business.md` need updating.'],
      [file('k1', 'clients/acme/profile.md'), file('k2', 'clients/acme/context/business.md')],
    );
    expect(linksIn(0)).toHaveLength(0);
  });

  it('still links a full path, and a path that names its client folder', () => {
    renderReplies(
      ['See `clients/acme/profile.md` and `acme/context/business.md`.'],
      [file('k1', 'clients/acme/profile.md'), file('k2', 'clients/acme/context/business.md')],
    );
    expect(linksIn(0)).toHaveLength(2);
  });
});

describe('reply links to pages', () => {
  const page = {
    key: 'pg1',
    title: 'Quarterly page',
    url: 'https://claude.ai/artifact/abc123',
    versions: [{ n: 1, remote: null, at: null, hasCopy: true }],
    live: false,
    draft: false,
    fileKey: null,
    multiFile: false,
    toolUseIds: ['tu1'],
    order: 1,
  };

  function renderWithPages(texts: string[], pages = [page]) {
    const onPage = vi.fn();
    const onFile = vi.fn();
    render(
      <Transcript
        items={texts.map((t, i) => reply(`a${i}`, t))}
        sessionId="s"
        sessionState="idle"
        files={[]}
        pages={pages}
        brainRoot="/brain"
        onFile={onFile}
        onPage={onPage}
      />,
    );
    return { onPage, onFile };
  }

  it('opens the viewer for a known address, written as a link or a bare address', () => {
    const { onPage, onFile } = renderWithPages([
      'Here: [the page](https://claude.ai/artifact/abc123) and https://claude.ai/artifact/abc123.',
    ]);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    fireEvent.click(links[0] as Element);
    expect(onPage).toHaveBeenCalledWith('pg1');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('leaves an unknown address as an outside link', () => {
    const { onPage } = renderWithPages(['See [it](https://claude.ai/artifact/zzz999).']);
    const a = screen.getByRole('link', { name: 'it' });
    expect(a.getAttribute('href')).toBe('https://claude.ai/artifact/zzz999');
    expect(a.getAttribute('target')).toBe('_blank');
    fireEvent.click(a);
    expect(onPage).not.toHaveBeenCalled();
  });

  it('links a page that arrives after the reply that names it', () => {
    const onPage = vi.fn();
    const items = [reply('a0', 'Published: https://claude.ai/artifact/abc123')];
    const view = render(
      <Transcript
        items={items}
        sessionId="s"
        sessionState="idle"
        files={[]}
        pages={[]}
        onFile={vi.fn()}
        onPage={onPage}
      />,
    );
    expect(document.querySelectorAll('a[href^="#chat-file="]')).toHaveLength(0);
    view.rerender(
      <Transcript
        items={items}
        sessionId="s"
        sessionState="idle"
        files={[]}
        pages={[page]}
        onFile={vi.fn()}
        onPage={onPage}
      />,
    );
    expect(document.querySelectorAll('a[href^="#chat-file="]')).toHaveLength(1);
  });
});
