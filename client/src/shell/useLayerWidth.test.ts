import { describe, expect, it } from 'vitest';
import {
  CHAT_DRAWER_PAD,
  CONTENT_MIN,
  chatDrawerLimits,
  clampWidth,
  KEY_STEP,
  KEY_STEP_BIG,
  maxBesideContent,
  stepWidth,
  VIEWER_PAD,
  viewerLimits,
} from './useLayerWidth.ts';

describe('viewerLimits', () => {
  it('the narrowest is the default width: 1040px, or what fits beside the rail', () => {
    expect(viewerLimits(1600).min).toBe(1040);
    expect(viewerLimits(1000).min).toBe(1000 - 2 * VIEWER_PAD - 70);
  });
  it('the widest leaves the rail and the pad in view', () => {
    expect(viewerLimits(1600).max).toBe(1600 - 2 * VIEWER_PAD - 70);
  });
  it('never has a widest below the narrowest', () => {
    const l = viewerLimits(700);
    expect(l.max).toBe(l.min);
  });
});

describe('chatDrawerLimits', () => {
  it('is bounded by the sheet it sits in, not the window, down to 380px', () => {
    expect(chatDrawerLimits(700)).toEqual({ min: 380, max: 700 - 2 * CHAT_DRAWER_PAD });
    // A sheet narrower than 380px plus the gaps: the drawer takes what room there is and cannot move.
    expect(chatDrawerLimits(300)).toEqual({ min: 276, max: 276 });
  });
});

describe('clampWidth', () => {
  const l = { min: 1040, max: 1400 };
  it('holds a width inside the limits', () => {
    expect(clampWidth(1200, l)).toBe(1200);
    expect(clampWidth(500, l)).toBe(1040);
    expect(clampWidth(5000, l)).toBe(1400);
  });
  it('rounds to whole pixels', () => {
    expect(clampWidth(1200.6, l)).toBe(1201);
  });
  it('clamps again when the window shrinks', () => {
    expect(clampWidth(1400, viewerLimits(1300))).toBe(1300 - 2 * VIEWER_PAD - 70);
  });
});

describe('stepWidth', () => {
  const l = { min: 1040, max: 1400 };
  it('Right narrows and Left widens, by 32px (128px with Shift)', () => {
    expect(stepWidth(1200, 'ArrowLeft', false, l)).toBe(1200 + KEY_STEP);
    expect(stepWidth(1200, 'ArrowRight', false, l)).toBe(1200 - KEY_STEP);
    expect(stepWidth(1200, 'ArrowLeft', true, l)).toBe(1200 + KEY_STEP_BIG);
    expect(stepWidth(1200, 'ArrowRight', true, l)).toBe(1200 - KEY_STEP_BIG);
  });
  it('Home is narrowest, End is widest', () => {
    expect(stepWidth(1200, 'Home', false, l)).toBe(1040);
    expect(stepWidth(1200, 'End', false, l)).toBe(1400);
  });
  it('stops at the limits', () => {
    expect(stepWidth(1390, 'ArrowLeft', true, l)).toBe(1400);
    expect(stepWidth(1050, 'ArrowRight', true, l)).toBe(1040);
  });
  it('ignores other keys', () => {
    expect(stepWidth(1200, 'a', false, l)).toBeNull();
  });
});

describe('maxBesideContent', () => {
  it('leaves 600px beside the drawer and its gaps', () => {
    expect(maxBesideContent(1200)).toBe(1200 - 2 * CHAT_DRAWER_PAD - CONTENT_MIN);
  });
  it("never goes under the drawer's narrowest", () => {
    expect(maxBesideContent(900)).toBe(380);
  });
});
