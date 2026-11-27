import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom has no layout, so the narrow-foot rule is checked in the stylesheet itself.
describe('the task panel foot', () => {
  it('keeps the second group (Edit) on the right when the buttons wrap', () => {
    const css = readFileSync(new URL('./todo-panel.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.todo-foot-group \+ \.todo-foot-group\s*\{[^}]*margin-left:\s*auto;/);
  });
});
