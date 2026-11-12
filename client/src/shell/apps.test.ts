import { describe, expect, it } from 'vitest';
import { APPS } from './apps.ts';

describe('APPS', () => {
  it('holds the library apps in a normal build, each with a panel of its own', () => {
    expect(APPS.map((a) => a.id)).toEqual(['images', 'documents']);
    expect(APPS[0]?.Panel).toBeDefined();
    expect(APPS[0]?.panelLabel).toBe('Image details');
    expect(APPS[1]?.Panel).toBeDefined();
    expect(APPS[1]?.panelLabel).toBe('Document details');
  });
});
