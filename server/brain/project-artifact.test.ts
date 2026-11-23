import { describe, expect, it } from 'vitest';
import { artifactRefusal, artifactSlug, artifactTarget, cleanArtifactTitle } from './project-artifact.ts';

describe('artifactSlug', () => {
  it.each([
    ['Pricing page', 'pricing-page'],
    ['  Café — Menu 2026!  ', 'cafe-menu-2026'],
    ['!!!', 'claude-page'],
    ['', 'claude-page'],
    ['../../etc/passwd', 'etc-passwd'],
    ['a'.repeat(100), 'a'.repeat(60)],
    [`${'a'.repeat(59)} b`, 'a'.repeat(59)],
  ])('%j gives %j', (title, slug) => expect(artifactSlug(title)).toBe(slug));
});

describe('artifactRefusal and artifactTarget', () => {
  const ok = { card: 'ok', archived: false } as const;
  it('allows only live client and personal project folders', () => {
    expect(artifactRefusal({ ...ok, folder: 'clients/acme/projects/web' })).toBeNull();
    expect(artifactRefusal({ ...ok, folder: 'personal/projects/plan' })).toBeNull();
    expect(artifactRefusal({ ...ok, folder: 'projects/old' })).toBe('legacy');
    expect(artifactRefusal({ ...ok, folder: 'clients/acme/projects/web', archived: true })).toBe('archived');
    expect(artifactRefusal({ ...ok, card: 'none', folder: 'clients/acme/projects/web' })).toBe('no-card');
    expect(artifactRefusal({ ...ok, card: 'unreadable', folder: 'clients/acme/projects/web' })).toBe(
      'no-card',
    );
    expect(artifactRefusal({ ...ok, folder: 'clients/_archive/acme/projects/web' })).toBe('legacy');
  });
  it('builds <folder>/files/<slug>.html', () => {
    expect(artifactTarget({ folder: 'clients/acme/projects/web' }, 'Pricing page')).toBe(
      'clients/acme/projects/web/files/pricing-page.html',
    );
  });
});

describe('cleanArtifactTitle', () => {
  it('trims, and refuses empty, long and control characters', () => {
    expect(cleanArtifactTitle('  Hi  ')).toBe('Hi');
    for (const t of ['', '  ', 'a'.repeat(201), 'x\ny', 'x\u007f', 5])
      expect(cleanArtifactTitle(t)).toBeNull();
  });
});
