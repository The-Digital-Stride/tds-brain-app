import { describe, expect, it } from 'vitest';
import { SETTINGS_TABS, settingsTabOrDefault, visibleSettingsTabs } from './settings-tabs.ts';

const ids = (hasSkillLevels: boolean) => visibleSettingsTabs({ hasSkillLevels }).map((t) => t.id);

describe('settings tabs', () => {
  it('lists the five tabs in order', () => {
    expect(ids(true)).toEqual(['general', 'claude', 'skill-levels', 'health', 'about']);
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual([
      'General',
      'Claude',
      'Skill levels',
      'Health',
      'About',
    ]);
  });

  it('hides Skill levels without levels', () => {
    expect(ids(false)).toEqual(['general', 'claude', 'health', 'about']);
  });

  it('falls back to general for an unknown, hidden or missing tab', () => {
    expect(settingsTabOrDefault('claude', { hasSkillLevels: false })).toBe('claude');
    expect(settingsTabOrDefault('skill-levels', { hasSkillLevels: true })).toBe('skill-levels');
    expect(settingsTabOrDefault('skill-levels', { hasSkillLevels: false })).toBe('general');
    expect(settingsTabOrDefault('nope', { hasSkillLevels: true })).toBe('general');
    expect(settingsTabOrDefault(null, { hasSkillLevels: true })).toBe('general');
    expect(settingsTabOrDefault(undefined, { hasSkillLevels: true })).toBe('general');
  });
});
