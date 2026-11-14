import { describe, expect, it } from 'vitest';
import { reportTitle, STEP_WORDS } from './steps.ts';

describe('step words', () => {
  it('names a helper’s report, or says whose when the name is not known', () => {
    expect(reportTitle('Audit memory')).toBe("Helper's report: Audit memory");
    expect(reportTitle(null)).toBe("A helper's report");
  });
  it('says each status in plain words', () => {
    expect(STEP_WORDS).toEqual({ running: 'working', ok: 'done', failed: 'did not work' });
  });
});
