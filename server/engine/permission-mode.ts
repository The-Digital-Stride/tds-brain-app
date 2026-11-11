/**
 * Which approval mode a new chat starts in (A18): the person's own Claude Code setting, so the app
 * asks exactly as often as their terminal. Modes that stop asking altogether are never passed on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppPermissionMode } from '../../shared/contract.ts';

/** `permissions.defaultMode` from one settings file, or undefined when the file does not set it. */
function readDefaultMode(file: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const permissions = (parsed as Record<string, unknown>).permissions;
  if (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions)) return undefined;
  return (permissions as Record<string, unknown>).defaultMode;
}

/**
 * Reads `~/.claude/settings.json`, then the brain's `.claude/settings.json`, then its
 * `.claude/settings.local.json`; the last file that sets the mode wins. `acceptEdits` may come from
 * any of them, `auto` only from the person's own file (a brain file saying `auto` counts as
 * `default`). Only those two pass through; everything else (including `bypassPermissions`, `dontAsk` and `plan`)
 * becomes `default`. Reads that one field only and never logs file contents.
 */
export function resolvePermissionMode(brainPath: string, homeDir: string): AppPermissionMode {
  let value: unknown;
  const files: { file: string; shared: boolean }[] = [
    { file: join(homeDir, '.claude', 'settings.json'), shared: false },
    // The brain's files sync to the whole team: one shared file must never switch everyone to `auto`.
    { file: join(brainPath, '.claude', 'settings.json'), shared: true },
    { file: join(brainPath, '.claude', 'settings.local.json'), shared: true },
  ];
  for (const { file, shared } of files) {
    const found = readDefaultMode(file);
    if (found === undefined) continue;
    value = shared && found === 'auto' ? 'default' : found;
  }
  return value === 'auto' || value === 'acceptEdits' ? value : 'default';
}
