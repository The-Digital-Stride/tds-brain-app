// The rename guard (plan 2026-11-15-cortex-help-phase-3, decision 1). Written by the lead before the rename.
// Builders must not edit this file: if something must keep the old name, report it to the lead.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BRAND, BRAND_FORMER, BRAND_SHORT } from './brand.ts';
import { SESSION_COOKIE } from './contract.ts';
import {
  LAUNCH_AGENT_LABEL,
  SIGNIN_APP_BUNDLE_ID,
  SIGNIN_APP_NAME,
  SUPPORT_DIR_NAME,
} from './install-contract.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('brand', () => {
  it('is TDS Cortex, short Cortex, formerly TDS Brain', () => {
    expect([BRAND, BRAND_SHORT, BRAND_FORMER]).toEqual(['TDS Cortex', 'Cortex', 'TDS Brain']);
  });

  // These look like names but are addresses: renaming any of them signs people out, loses their data folder or
  // breaks the service, the sign-in helper or updates on Macs that already have the app.
  it('keeps every hidden working name exactly as it was', () => {
    expect(SUPPORT_DIR_NAME).toBe('TDS Brain');
    expect(SIGNIN_APP_NAME).toBe('TDS Brain Sign-in');
    expect(SIGNIN_APP_BUNDLE_ID).toBe('uk.co.thedigitalstride.tds-brain.signin');
    expect(LAUNCH_AGENT_LABEL).toBe('uk.co.thedigitalstride.tds-brain');
    expect(SESSION_COOKIE).toBe('tba_session');
  });

  it('the doctor still ends with the line the Brain update skill looks for', () => {
    expect(readFileSync(join(ROOT, 'server/cli.ts'), 'utf8')).toContain("'\\nEverything looks fine.'");
  });
});

/** Where the old name may still appear (each is a kept name, an old record, or says what it used to be). */
const ALLOWED = [
  /TDS Brain Sign-in/g, // SIGNIN_APP_NAME and instructions to open it (renamed in Phase 4)
  /'TDS Brain App'/g, // old to-do records' via stamp, still shown
  /Application Support\/TDS Brain/g, // the data folder path (SUPPORT_DIR_NAME)
  /SUPPORT_DIR_NAME = 'TDS Brain'/g,
  /BRAND_FORMER = 'TDS Brain'/g,
  /\(or TDS Brain\)/g, // uninstall wording: the Dock name depends on whether the person accepted the change
  /\(was TDS Brain\)/g,
  /with title "TDS Brain"/g, // the sign-in helper's dialog title, renamed with the helper in Phase 4
];

const SCAN = ['client/src', 'client/index.html', 'client/public', 'server', 'shared'];
const TEXT = /\.(ts|tsx|js|mjs|cjs|html|css|json|webmanifest|svg)$/;

function files(path: string): string[] {
  const abs = join(ROOT, path);
  if (!statSync(abs).isDirectory()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(path, e.name)) : TEXT.test(e.name) ? [join(abs, e.name)] : [],
  );
}

/** Lines a person could read that still say the old name. Comments are left alone. */
function leftovers(): string[] {
  const found: string[] = [];
  for (const file of SCAN.flatMap(files)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        let rest = line;
        for (const ok of ALLOWED) rest = rest.replace(ok, '');
        if (rest.includes('TDS Brain')) found.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe('the visible rename', () => {
  it('leaves no visible "TDS Brain" outside the kept names', () => {
    expect(leftovers()).toEqual([]);
  });
});
