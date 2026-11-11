import { describe, expect, it } from 'vitest';
import { keepAcronyms, slugWords } from './words.ts';

describe('keepAcronyms', () => {
  it('puts known short forms in capitals, whole words only', () => {
    expect(keepAcronyms('Tds doc')).toBe('TDS doc');
    expect(keepAcronyms('Daily marketing ai post')).toBe('Daily marketing AI post');
    expect(keepAcronyms('Html to pdf')).toBe('HTML to PDF');
    expect(keepAcronyms('Seo auditor for ga4')).toBe('SEO auditor for GA4');
  });
  it('leaves ordinary words alone, even ones that contain a short form', () => {
    expect(keepAcronyms('Email campaign')).toBe('Email campaign');
    expect(keepAcronyms('Paid search costs')).toBe('Paid search costs');
  });
  it('gives a name its own spelling where capitals alone are wrong', () => {
    expect(keepAcronyms('Pmax auditor')).toBe('PMax auditor');
  });
});

describe('slugWords', () => {
  it('turns a folder name into words', () => {
    expect(slugWords('gladwell-and-patterson')).toBe('Gladwell and patterson');
    expect(slugWords('uc-ai-search')).toBe('UC AI search');
    expect(slugWords('the_digital_stride')).toBe('The digital stride');
  });
  it('leaves a name that is already words as it is', () => {
    expect(slugWords('Website rebuild')).toBe('Website rebuild');
  });
  it('returns an empty name unchanged', () => {
    expect(slugWords('')).toBe('');
    expect(slugWords('--')).toBe('--');
  });
});
