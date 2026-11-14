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
  it('names helpers that are still working', () => {
    expect(closeConfirmText('working', 2)).toBe(
      'Claude and 2 helpers are still working. Closing stops them all. Close anyway?',
    );
    expect(closeConfirmText('working', 1)).toBe(
      'Claude and 1 helper are still working. Closing stops them all. Close anyway?',
    );
    expect(closeConfirmText('waiting', 2)).toBe(
      'Claude is waiting for your answer and 2 helpers are still working. Closing stops them all. Close anyway?',
    );
    expect(closeConfirmText('waiting', 1)).toContain('and 1 helper is still working');
  });
  it('is unchanged with no helpers working', () => {
    expect(closeConfirmText('working', 0)).toBe('Claude is still working. Close anyway?');
    expect(closeConfirmText('waiting')).toBe('Claude is waiting for your answer. Close anyway?');
    expect(closeConfirmText('idle', 0)).toBe('Close this chat?');
  });
});
