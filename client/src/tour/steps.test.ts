// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { APPS } from '../shell/apps.ts';
import { DRAWER_LABELS } from '../shell/Rail.tsx';
import { SECTIONS } from '../shell/sections.ts';
import { NOT_TOURED, TOUR_HISTORY, TOUR_STEPS, TOUR_VERSION } from './steps.ts';

/**
 * These keep the tour in step with Cortex: a new app or rail section needs a tour step (or a reason in
 * NOT_TOURED), and a change to the steps needs a TOUR_VERSION bump, which shows the new tour to everyone once.
 */
describe('the tour keeps up with Cortex', () => {
  it('has a step for every app, rail section and drawer, unless NOT_TOURED says why', () => {
    const places = [
      ...APPS.map((a) => `app:${a.id}`),
      ...SECTIONS.map((s) => `section:${s.id}`),
      ...Object.keys(DRAWER_LABELS).map((d) => `drawer:${d}`),
    ];
    const covered = new Set(TOUR_STEPS.flatMap((s) => s.covers ?? []));
    const missing = places.filter((p) => !covered.has(p) && !(p in NOT_TOURED));
    expect(
      missing,
      'Add a tour step (with `covers`) in client/src/tour/steps.ts, then bump TOUR_VERSION and add its TOUR_HISTORY line',
    ).toEqual([]);
    // Nothing stale: every covers or NOT_TOURED key still names a real place.
    const stale = [...covered, ...Object.keys(NOT_TOURED)].filter((k) => !places.includes(k));
    expect(stale).toEqual([]);
  });

  it('bumps TOUR_VERSION whenever the steps change', () => {
    expect(
      TOUR_HISTORY[TOUR_VERSION],
      'The steps changed: bump TOUR_VERSION and add a TOUR_HISTORY line for it, so everyone sees the new tour once',
    ).toBe(TOUR_STEPS.map((s) => s.id).join(','));
    expect(Math.max(...Object.keys(TOUR_HISTORY).map(Number))).toBe(TOUR_VERSION);
  });

  it('has the task-updates step, placed after Your tasks, and a history line for it', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(ids.indexOf('task-updates')).toBe(ids.indexOf('todos') + 1);
    const step = TOUR_STEPS.find((s) => s.id === 'task-updates');
    expect(step?.text).toMatch(/updates, finishes or hands back/);
    expect(TOUR_HISTORY[TOUR_VERSION]).toContain('task-updates');
    expect(TOUR_HISTORY[TOUR_VERSION - 1]).not.toContain('task-updates');
  });

  it('never reuses a step id', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
