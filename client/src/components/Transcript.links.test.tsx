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
