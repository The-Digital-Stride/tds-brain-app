import { describe, expect, it } from 'vitest';
import { chooseInitialChat } from './resume.ts';

describe('chooseInitialChat', () => {
  it('returns the remembered chat when it is still open', () => {
    expect(chooseInitialChat('a', ['b', 'a'])).toBe('a');
  });
  it('starts fresh when the remembered chat has gone', () => {
    expect(chooseInitialChat('a', ['b'])).toBeNull();
  });
  it('starts fresh when nothing was remembered', () => {
    expect(chooseInitialChat(null, ['a'])).toBeNull();
  });
});
