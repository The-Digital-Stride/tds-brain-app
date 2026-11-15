// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createRenderHelp } from './render.ts';

const render = createRenderHelp((id) => id === 'todos');
const img = (src: string) => (src === 'images/a.webp' ? '/assets/a-123.webp' : null);

describe('renderHelp', () => {
  it('keeps a help link to a known page', () => {
    expect(render('See [To-dos](help:todos).', img)).toContain(
      '<a href="#help-todos" data-help-id="todos">To-dos</a>',
    );
  });
  it('unwraps a help link to an unknown page', () => {
    const html = render('See [Nope](help:nope).', img);
    expect(html).toContain('See Nope.');
    expect(html).not.toContain('<a');
  });
  it('maps a known image and drops an unknown one', () => {
    const html = render('![Alt here](images/a.webp)\n\n![Other](images/b.webp)', img);
    expect(html).toContain('src="/assets/a-123.webp"');
    expect(html).toContain('alt="Alt here"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('b.webp');
  });
  it('eager pictures carry no lazy loading (the print copy needs every picture)', () => {
    const html = render('![Alt here](images/a.webp)', img, { eager: true });
    expect(html).toContain('src="/assets/a-123.webp"');
    expect(html).not.toContain('loading="lazy"');
    // The next ordinary render is lazy again.
    expect(render('![Alt here](images/a.webp)', img)).toContain('loading="lazy"');
  });
  it('strips scripts, iframes and raw images from outside', () => {
    const html = render(
      '<script>alert(1)</script><iframe src="x"></iframe><img src="https://evil/x.png">Hi',
      img,
    );
    expect(html).not.toMatch(/script|iframe|evil/);
    expect(html).toContain('Hi');
  });
  it('opens web links in a new tab safely', () => {
    const html = render('[Site](https://example.com)', img);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('unwraps other links, including javascript ones', () => {
    const html = render('[A](/x) [B](javascript:alert(1)) [C](#help-todos)', img);
    expect(html).not.toContain('<a');
    expect(html).toContain('A B C');
  });
  it('does not trust a forged help link written as HTML', () => {
    const html = render('<a href="#help-todos" data-help-id="todos">x</a>', img);
    expect(html).not.toContain('data-help-id');
  });
  it('renders ## as h4 and ### as h5 (the page title is the h3)', () => {
    const html = render('## One\n\n### Two', img);
    expect(html).toContain('<h4>One</h4>');
    expect(html).toContain('<h5>Two</h5>');
  });
});
