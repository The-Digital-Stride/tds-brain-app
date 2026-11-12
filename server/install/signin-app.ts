import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIGNIN_APP_BUNDLE_ID, SIGNIN_APP_NAME } from '../../shared/install-contract.ts';

/** The file operations the bundle writer needs; tests may pass fakes. */
export interface SigninFs {
  mkdirSync(path: string, opts: { recursive: true }): unknown;
  writeFileSync(path: string, data: string): void;
  chmodSync(path: string, mode: number): void;
  rmSync(path: string, opts: { recursive: true; force: true }): void;
}

const realFs: SigninFs = { mkdirSync, writeFileSync, chmodSync, rmSync };

/** Single-quotes a string for sh, so spaces and quotes in paths are safe. */
export const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

export function renderInfoPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${SIGNIN_APP_BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${SIGNIN_APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${SIGNIN_APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>signin</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`;
}

/** Double-click: ask the running app for a sign-in and open it. Shows a dialog if that fails (no terminal here). */
export function renderSigninScript(appRoot: string): string {
  return `#!/bin/sh
out=$(${shellQuote(`${appRoot}/bin/tds-brain`)} open 2>&1) && exit 0
osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "TDS Brain" buttons {"OK"} default button "OK"' -e 'end run' "$out" >/dev/null 2>&1
exit 1
`;
}

/** What launchd runs. It sits inside the bundle so Login Items names the job after the bundle. */
export function renderServiceScript(appRoot: string): string {
  return `#!/bin/sh
exec ${shellQuote(`${appRoot}/bin/node`)} ${shellQuote(`${appRoot}/server/index.ts`)} --no-open
`;
}

/** Writes the whole bundle at `dir` (replacing an older one) with the scripts executable. */
export function writeSigninApp(dir: string, appRoot: string, fs: SigninFs = realFs): void {
  const macos = join(dir, 'Contents', 'MacOS');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(macos, { recursive: true });
  fs.writeFileSync(join(dir, 'Contents', 'Info.plist'), renderInfoPlist());
  for (const [name, body] of [
    ['signin', renderSigninScript(appRoot)],
    ['tds-brain-service', renderServiceScript(appRoot)],
  ] as const) {
    const file = join(macos, name);
    fs.writeFileSync(file, body);
    fs.chmodSync(file, 0o755);
  }
}
