// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelpTopic } from './contract.ts';
import { HelpArticle } from './HelpArticle.tsx';

afterEach(cleanup);

const topic: HelpTopic = {
  id: 'x',
  title: 'The title',
  area: 'home',
  order: 1,
  summary: 's',
  benefit: 'b',
  roles: 'all',
  related: [],
  since: '0.36.0',
  reviewed: '2026-11-20',
  body: '## What it does\nSee [site](https://example.com).',
};

describe('HelpArticle', () => {
  it('renders the body, not the title', () => {
    const { container } = render(<HelpArticle topic={topic} onOpen={() => {}} />);
    expect(container.querySelector('.help-article h4')?.textContent).toBe('What it does');
    expect(container.textContent).not.toContain('The title');
  });
  it('does not call onOpen for ordinary clicks', () => {
    const onOpen = vi.fn();
    const { container } = render(<HelpArticle topic={topic} onOpen={onOpen} />);
    const a = container.querySelector('a') as HTMLAnchorElement;
    fireEvent.click(a);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it('calls onOpen with the id of a page link and stops the jump', () => {
    const onOpen = vi.fn();
    const { container } = render(<HelpArticle topic={topic} onOpen={onOpen} />);
    const link = document.createElement('a');
    link.setAttribute('data-help-id', 'todos');
    link.href = '#help-todos';
    link.textContent = 'Tasks';
    container.querySelector('.help-article')?.append(link);
    const notStopped = fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith('todos');
    expect(notStopped).toBe(false);
  });
});
