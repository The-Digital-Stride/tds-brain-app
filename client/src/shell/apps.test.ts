import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('APPS', () => {
  it('is empty in a normal build, so the rail shows no Apps group', async () => {
    vi.resetModules();
    const { APPS } = await import('./apps.ts');
    expect(APPS).toEqual([]);
  });

  it('holds the example apps, each with a panel of its own, when the build asks for examples', async () => {
    vi.stubEnv('VITE_EXAMPLE_APPS', '1');
    vi.resetModules();
    const { APPS } = await import('./apps.ts');
    expect(APPS.map((a) => a.id)).toEqual(['images', 'documents']);
    expect(APPS[0]?.Panel).toBeDefined();
    expect(APPS[0]?.panelLabel).toBe('Image details');
    expect(APPS[1]?.Panel).toBeDefined();
    expect(APPS[1]?.panelLabel).toBe('Document details');
  });
});
