import { describe, expect, it } from 'vitest';
import { closeConfirmText, isClearCommand, needsCloseConfirm } from './close.ts';

describe('isClearCommand', () => {
  it('matches /clear alone, trimmed and in any case', () => {
    expect(isClearCommand('/clear')).toBe(true);
    expect(isClearCommand('  /CLEAR \n')).toBe(true);
  });
  it('does not match anything else', () => {
    expect(isClearCommand('/clear please')).toBe(false);
    expect(isClearCommand('clear')).toBe(false);
    expect(isClearCommand('/time /clear')).toBe(false);
  });
});

describe('needsCloseConfirm', () => {
  it('asks while starting, working or waiting only', () => {
    expect(needsCloseConfirm('starting')).toBe(true);
    expect(needsCloseConfirm('working')).toBe(true);
    expect(needsCloseConfirm('waiting')).toBe(true);
    expect(needsCloseConfirm('idle')).toBe(false);
    expect(needsCloseConfirm('error')).toBe(false);
    expect(needsCloseConfirm('closed')).toBe(false);
  });
  it('words the question for the state', () => {
    expect(closeConfirmText('waiting')).toContain('waiting for your answer');
    expect(closeConfirmText('working')).toContain('still working');
  });
});
