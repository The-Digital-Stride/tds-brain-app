import { describe, expect, it } from 'vitest';
import { humanise } from './util.ts';

describe('humanise', () => {
  it('turns a folder or file name into words', () => {
    expect(humanise('meeting-notes')).toBe('Meeting notes');
    expect(humanise('20261111-plan_for-home.md')).toBe('Plan for home');
  });
  it('keeps short forms in capitals', () => {
    expect(humanise('tds-doc')).toBe('TDS doc');
    expect(humanise('daily-marketing-ai-post')).toBe('Daily marketing AI post');
    expect(humanise('ai-stores')).toBe('AI stores');
  });
});
