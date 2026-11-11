import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Identity } from '../../shared/contract.ts';

export const FIXTURE = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'brain');

/** A fresh writable copy of the fake brain. */
export function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tba-brain-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export function person(slug: string, role: Identity['role']): Identity {
  return { name: slug, slug, email: null, role, knownMember: true };
}
