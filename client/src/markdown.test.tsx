// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Markdown, renderMarkdown } from './markdown.tsx';

describe('Markdown', () => {
  it('strips scripts, event handlers, styles and forms, and hardens links', () => {
    const text = [
      'Hello **there**',
      '<script>alert(1)</script>',
      '<img src="x" onerror="alert(2)">',
      '<p style="color:red">styled</p>',
      '<form action="/x"><input name="a"><button>Go</button></form>',
      '[a link](https://example.com)',
    ].join('\n\n');
    const { container } = render(<Markdown text={text} />);
    const html = container.innerHTML;
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('style=');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('there');
    const link = container.querySelector('a');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('removes class and id so a reply cannot pass as the app', () => {
    const { container } = render(
      <Markdown text='<section class="approval" id="x"><a class="btn" href="https://example.com">Allow</a></section>' />,
    );
    const inner = container.firstElementChild?.innerHTML ?? '';
    expect(inner).not.toContain('class=');
    expect(inner).not.toContain('id=');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});

describe('chat file links', () => {
  const known: Record<string, string> = { 'clients/acme/brief.md': 'key one/1', 'personal/n.md': 'k2' };
  const link = (raw: string) => known[raw.replace(/^\.\//, '')] ?? null;

  it('turns a known link target and a known code span into chat-file links', () => {
    const html = renderMarkdown('See [the brief](clients/acme/brief.md) and `personal/n.md`.', link);
    expect(html).toContain('<a href="#chat-file=key%20one%2F1">the brief</a>');
    expect(html).toContain('<a href="#chat-file=k2"><code>personal/n.md</code></a>');
    expect(html).not.toContain('target=');
  });

  it('shows an unknown relative link as plain text and an unknown code span as code', () => {
    const html = renderMarkdown('[old](clients/zzz/gone.md) and `clients/zzz/gone.md`', link);
    expect(html).not.toContain('<a');
    expect(html).toContain('old and <code>clients/zzz/gone.md</code>');
  });

  it('without a linker no file links are made', () => {
    expect(renderMarkdown('[x](clients/acme/brief.md) `personal/n.md`')).not.toContain('<a');
  });

  it('unwraps raw HTML links to chat files the linker did not issue, or to relative paths', () => {
    const html = renderMarkdown(
      '<a href="#chat-file=forged">one</a> <a href="clients/acme/brief.md">two</a> <a href="javascript:alert(1)">three</a>',
      link,
    );
    expect(html).not.toContain('<a');
    expect(html).toContain('one');
    expect(html).toContain('two');
    expect(html).toContain('three');
  });

  it('keeps a raw chat-file link only if issued, and gives it no target', () => {
    const html = renderMarkdown('`personal/n.md` <a href="#chat-file=k2" target="_blank">again</a>', link);
    expect((html.match(/<a /g) ?? []).length).toBe(2);
    expect(html).not.toContain('target=');
  });

  it('leaves http, https and mailto links as before and does not leak context between renders', () => {
    const html = renderMarkdown('[a](https://example.com) [m](mailto:a@b.co)', link);
    expect((html.match(/target="_blank" rel="noopener noreferrer"/g) ?? []).length).toBe(2);
    expect(renderMarkdown('<a href="#chat-file=k2">x</a>')).not.toContain('<a');
  });

  it('adds no class or data attributes', () => {
    const html = renderMarkdown('[a](clients/acme/brief.md) [b](nowhere.md)', link);
    expect(html).not.toContain('class=');
    expect(html).not.toContain('data-');
  });

  it('click on a file link calls onFile with the decoded key and prevents default', () => {
    const onFile = vi.fn();
    const { container } = render(
      <Markdown text="[the brief](clients/acme/brief.md)" link={link} onFile={onFile} />,
    );
    const a = container.querySelector('a') as HTMLAnchorElement;
    const notPrevented = fireEvent.click(a);
    expect(notPrevented).toBe(false);
    expect(onFile).toHaveBeenCalledWith('key one/1');
  });

  it('click on a web link does nothing special', () => {
    const onFile = vi.fn();
    const { container } = render(<Markdown text="[a](https://example.com)" onFile={onFile} />);
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement);
    expect(onFile).not.toHaveBeenCalled();
  });

  it('does not let an svg link bypass the link rules', () => {
    const html = renderMarkdown(
      '<svg><a href="https://evil.example/login"><image href="https://evil.example/btn.png"/></a></svg>' +
        '<svg><a href="#chat-file=anything">x</a></svg>',
      link,
    );
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('#chat-file=');
    expect(html).not.toContain('<svg');
  });
});
