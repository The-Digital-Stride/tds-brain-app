/**
 * What "Same as Claude Code" means for the model: the top-level `model` from the person's own
 * Claude Code settings and the brain's, so Settings can name it and a chat can fall back to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_PREF_MAX, MODEL_PREF_PATTERN } from '../../shared/contract.ts';

/** Top-level `model` from one settings file, or undefined when it is missing or not a usable id. */
function readModel(file: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const model = (parsed as Record<string, unknown>).model;
  return typeof model === 'string' && model.length <= MODEL_PREF_MAX && MODEL_PREF_PATTERN.test(model)
    ? model
    : undefined;
}

/**
 * Reads `~/.claude/settings.json`, then the brain's `.claude/settings.json`, then its
 * `.claude/settings.local.json`; the last file that sets a usable `model` wins. Reads that one
 * field only and never logs file contents.
 */
export function resolveEngineDefaults(brainPath: string, homeDir: string): { model: string | null } {
  let model: string | null = null;
  for (const file of [
    join(homeDir, '.claude', 'settings.json'),
    join(brainPath, '.claude', 'settings.json'),
    join(brainPath, '.claude', 'settings.local.json'),
  ]) {
    model = readModel(file) ?? model;
  }
  return { model };
}

/** "claude-opus-5-5" → "Opus 5.5". An alias or id it does not recognise is shown as it is. (Same rule as the client's `modelName`.) */
export function modelLabel(id: string): string {
  const m = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(id);
  if (!m?.[1] || !m[2]) return id;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}${/\[1m\]/i.test(id) ? ' (1M context)' : ''}`;
}
