import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SIGNIN_APP_BUNDLE_ID, SIGNIN_APP_NAME } from '../../shared/install-contract.ts';
import {
  renderInfoPlist,
  renderServiceScript,
  renderSigninScript,
  shellQuote,
  writeSigninApp,
} from './signin-app.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('signin app contents', () => {
  it('quotes paths with spaces and quotes for sh', () => {
    expect(shellQuote("/a b/it's")).toBe(`'/a b/it'\\''s'`);
  });

  it('Info.plist names the bundle and hides the Dock icon', () => {
    const p = renderInfoPlist();
    expect(p).toContain(`<key>CFBundleIdentifier</key>\n  <string>${SIGNIN_APP_BUNDLE_ID}</string>`);
    expect(p).toContain(`<key>CFBundleName</key>\n  <string>${SIGNIN_APP_NAME}</string>`);
    expect(p).toContain('<key>CFBundleExecutable</key>\n  <string>signin</string>');
    expect(p).toContain('<key>LSUIElement</key>\n  <true/>');
    expect(p).toContain('<key>CFBundlePackageType</key>\n  <string>APPL</string>');
  });

  it('signin runs tds-brain open; the service execs node on index.ts without opening a browser', () => {
    const app = '/Users/a/Library/Application Support/TDS Brain/app';
    expect(renderSigninScript(app)).toContain(`'${app}/bin/tds-brain' open`);
    const svc = renderServiceScript(app);
    expect(svc.startsWith('#!/bin/sh\n')).toBe(true);
    expect(svc).toContain(`exec '${app}/bin/node' '${app}/server/index.ts' --no-open`);
  });
});

describe('writeSigninApp', () => {
  it('writes the bundle with executable scripts', () => {
    const root = mkdtempSync(join(tmpdir(), 'tds-signin-'));
    dirs.push(root);
    const bundle = join(root, `${SIGNIN_APP_NAME}.app`);
    writeSigninApp(bundle, '/app', undefined);
    expect(readFileSync(join(bundle, 'Contents', 'Info.plist'), 'utf8')).toContain(SIGNIN_APP_BUNDLE_ID);
    for (const f of ['signin', 'tds-brain-service']) {
      const s = statSync(join(bundle, 'Contents', 'MacOS', f));
      expect(s.mode & 0o111).toBe(0o111);
    }
  });

  it('replaces an older bundle', () => {
    const root = mkdtempSync(join(tmpdir(), 'tds-signin-'));
    dirs.push(root);
    const bundle = join(root, 'x.app');
    writeSigninApp(bundle, '/one');
    writeSigninApp(bundle, '/two');
    expect(readFileSync(join(bundle, 'Contents', 'MacOS', 'tds-brain-service'), 'utf8')).toContain(
      "'/two/bin/node'",
    );
  });
});
