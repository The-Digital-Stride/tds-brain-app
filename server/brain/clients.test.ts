import { describe, expect, it } from 'vitest';
import { createBrainReaders } from './index.ts';
import { FIXTURE } from './test-helpers.ts';

describe('clients', () => {
  it('lists folders only, skipping _ and . names, naming from accounts.json when it matches', async () => {
    expect(await createBrainReaders(FIXTURE).clients()).toEqual([
      { slug: 'acme-heating', name: 'Acme Heating Ltd' },
      { slug: 'northwind', name: 'Northwind' },
    ]);
  });

  it('returns an empty list when clients/ is missing', async () => {
    expect(await createBrainReaders('/nonexistent/brain').clients()).toEqual([]);
  });
});
