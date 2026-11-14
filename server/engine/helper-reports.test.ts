import { describe, expect, it } from 'vitest';
import { HelperNames, isHelperTurn, parseHelperReport } from './helper-reports.ts';

const FRAME =
  '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:';
const handBack = (from: string, report: string) =>
  `Another Claude session sent a message:\n<agent-message from="${from}">\n${FRAME}\n${report}\n</agent-message>\n\nThat "other Claude session" is an agent working inside this same session.`;

describe('isHelperTurn', () => {
  it('knows a finish notice and a hand-back, with or without the lead-in', () => {
    expect(isHelperTurn('<task-notification>\n<status>completed</status>\n</task-notification>')).toBe(true);
    expect(isHelperTurn(handBack('a1', '  hi'))).toBe(true);
    expect(isHelperTurn('<agent-message from="a1">\nhi\n</agent-message>')).toBe(true);
  });
  it('leaves the person’s own words alone', () => {
    expect(isHelperTurn('Another Claude session sent a message: tell me about it')).toBe(false);
    expect(isHelperTurn('What does <task-notification> mean?')).toBe(false);
  });
});

describe('parseHelperReport', () => {
  it('takes the report out of its frame, undoing the two-space indent, and drops the trailing note', () => {
    const r = parseHelperReport(
      handBack('a8bf', '  ## Findings\n  \n  1. **Drawing cost** is high.\n    - nested'),
    );
    expect(r).toEqual({ from: 'a8bf', text: '## Findings\n\n1. **Drawing cost** is high.\n  - nested' });
  });
  it('keeps the whole body when there is no frame line', () => {
    expect(parseHelperReport('<agent-message from="x">\nJust this.\n</agent-message>')).toEqual({
      from: 'x',
      text: 'Just this.',
    });
  });
  it('is null for a finish notice, a person’s words, or an empty report', () => {
    expect(parseHelperReport('<task-notification>\n</task-notification>')).toBeNull();
    expect(parseHelperReport('Another Claude session sent a message: hi')).toBeNull();
    expect(parseHelperReport(handBack('a', '  '))).toBeNull();
  });
});

describe('HelperNames', () => {
  const start = (id: string, description: unknown) => ({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id, name: 'Agent', input: { description, prompt: 'p' } }] },
  });
  const result = (id: string, content: unknown) => ({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });

  it('names a helper by the description of the step that started it, found by its agent id', () => {
    const names = new HelperNames();
    names.observe(start('t1', 'Audit Sortie drawing cost'));
    names.observe(
      result('t1', [
        { type: 'text', text: 'Async agent launched successfully.\nagentId: ab74d8a3 (internal ID)' },
      ]),
    );
    expect(names.name('ab74d8a3')).toBe('Audit Sortie drawing cost');
  });
  it('reads a plain-string result too, and is null for an agent it never saw', () => {
    const names = new HelperNames();
    names.observe(start('t2', 'Vite move'));
    names.observe(result('t2', 'agentId: c0ffee'));
    expect(names.name('c0ffee')).toBe('Vite move');
    expect(names.name('nope')).toBeNull();
  });
  it('ignores other tools and steps with no description', () => {
    const names = new HelperNames();
    names.observe({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't3', name: 'Bash', input: { description: 'x' } }] },
    });
    names.observe(result('t3', 'agentId: aaa'));
    names.observe(start('t4', 42));
    names.observe(result('t4', 'agentId: bbb'));
    expect(names.name('aaa')).toBeNull();
    expect(names.name('bbb')).toBeNull();
  });
});
