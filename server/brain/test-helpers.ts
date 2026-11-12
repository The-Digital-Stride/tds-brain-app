import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import type { Identity } from '../../shared/contract.ts';

export const FIXTURE = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'brain');

const made: string[] = [];

// Removes every temp copy this test file made.
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh writable copy of the fake brain. */
export function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-brain-'));
  made.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export function person(slug: string, role: Identity['role']): Identity {
  return { name: slug, slug, email: null, role, knownMember: true, departments: [] };
}
