import { describe, expect, it } from 'vitest';
import { approvalsSentence } from './approvals.ts';

describe('approvalsSentence', () => {
  it('has a plain sentence for each mode', () => {
    expect(approvalsSentence('default')).toBe('Claude asks before it changes a file or runs a command.');
    expect(approvalsSentence('acceptEdits')).toContain('without asking');
    expect(approvalsSentence('auto')).toContain('those changes sync to the team');
  });
});
