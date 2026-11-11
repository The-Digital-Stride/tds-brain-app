// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from './markdown.tsx';

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
