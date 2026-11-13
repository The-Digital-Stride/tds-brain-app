import { describe, expect, it } from 'vitest';
import { classify, groupFor, isNeverListed, orderGroups, RULES, tidyFileName } from './library-rules.ts';

describe('groupFor', () => {
  it('puts each rule folder in its card', () => {
    const cases: [string, string][] = [
      ['reports/x.pdf', 'Reports'],
      ['plans/x.docx', 'Plans'],
      ['briefs/x.md', 'Briefs'],
      ['call-notes/2026-11-01-x.md', 'Call notes'],
      ['notes/x.md', 'Notes'],
      ['context/brand/logo.png', 'Brand'],
      ['context/reference/price-list.pdf', 'Reference'],
      ['context/analysis/seo/audit.md', 'Analysis'],
      ['landing-pages/boiler/hero.jpg', 'Landing pages'],
      ['created/2026-11-02-keywords.csv', 'Ad builds'],
      ['website/2026-11-02-redirects.csv', 'Website'],
      ['crm/import-map.csv', 'CRM'],
      ['CRM/field-map.csv', 'CRM'],
    ];
    for (const [rel, group] of cases) expect(groupFor(rel, 'client'), rel).toBe(group);
  });

  it('matches rule folders whatever their case', () => {
    expect(groupFor('Reports/x.pdf', 'client')).toBe('Reports');
    expect(groupFor('Context/Brand/logo.png', 'client')).toBe('Brand');
  });

  it('names a card after the first folder when no rule matches, and "Other" for a loose file', () => {
    expect(groupFor('media/van.webp', 'client')).toBe('Media');
    expect(groupFor('context/misc/x.md', 'client')).toBe('Context');
    expect(groupFor('social-posts/a/b.png', 'client')).toBe('Social posts');
    expect(groupFor('profile.md', 'client')).toBe('Other');
    expect(groupFor('seo-audits/x.pdf', 'client')).toBe('SEO audits');
    expect(groupFor('ppc/x.pdf', 'client')).toBe('PPC');
    expect(groupFor('google-ads/x.pdf', 'client')).toBe('Google ads');
    expect(groupFor('crm/x.csv', 'personal')).toBe('CRM');
  });

  it('names every personal card after its folder, never by the rules', () => {
    expect(groupFor('reports/x.pdf', 'personal')).toBe('Reports');
    expect(groupFor('clients/acme/2026-11-01-call.md', 'personal')).toBe('Clients');
    expect(groupFor('context/brand/x.png', 'personal')).toBe('Context');
    expect(groupFor('explainer.html', 'personal')).toBe('Other');
  });
});

describe('orderGroups', () => {
  it('puts rule cards in rule order, then folder cards A to Z, then Other', () => {
    expect(orderGroups(['Other', 'Media', 'Brand', 'Reports', 'Assets'], 'client')).toEqual([
      'Reports',
      'Brand',
      'Assets',
      'Media',
      'Other',
    ]);
  });

  it('sorts personal cards A to Z with Other last', () => {
    expect(orderGroups(['Screens', 'Other', 'Notes', 'Reports'], 'personal')).toEqual([
      'Notes',
      'Reports',
      'Screens',
      'Other',
    ]);
  });

  it('keeps the rules in the order the plan gives', () => {
    expect(RULES.map((r) => r.group)).toEqual([
      'Reports',
      'Plans',
      'Briefs',
      'Call notes',
      'Notes',
      'Brand',
      'Reference',
      'Analysis',
      'Landing pages',
      'Ad builds',
      'Website',
      'CRM',
    ]);
  });
});

describe('classify', () => {
  it('knows images by extension, whatever the case', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'PNG', 'Jpg']) {
      expect(classify(ext), ext).toEqual({ kind: 'image', format: null, view: 'image' });
    }
  });

  it('knows documents and how each opens', () => {
    expect(classify('pdf')).toEqual({ kind: 'document', format: 'pdf', view: 'pdf' });
    expect(classify('md')).toEqual({ kind: 'document', format: 'doc', view: 'text' });
    expect(classify('txt')).toEqual({ kind: 'document', format: 'doc', view: 'text' });
    expect(classify('docx')).toEqual({ kind: 'document', format: 'doc', view: null });
    expect(classify('html')).toEqual({ kind: 'document', format: 'doc', view: 'page' });
    expect(classify('htm')).toEqual({ kind: 'document', format: 'doc', view: 'page' });
    expect(classify('csv')).toEqual({ kind: 'document', format: 'sheet', view: null });
    expect(classify('xlsx')).toEqual({ kind: 'document', format: 'sheet', view: null });
    expect(classify('pptx')).toEqual({ kind: 'document', format: 'deck', view: null });
  });

  it('lists nothing else', () => {
    for (const ext of ['js', 'json', 'env', 'ts', 'yaml', 'cjs', '', 'exe', 'svgz', 'doc']) {
      expect(classify(ext), ext).toBeNull();
    }
  });
});

describe('isNeverListed', () => {
  it('refuses every never-listed place, whatever the case', () => {
    const refused = [
      'clients/acme/.private/x.md',
      'clients/acme/reports/.draft.md',
      '.claude/skills/x.md',
      'personal/.secret/a.png',
      'clients/acme/node_modules/pkg/readme.md',
      'personal/tool/NODE_MODULES/x.md',
      'clients/acme/config/secret.png',
      'clients/acme/Config/secret.png',
      'clients/acme/CONFIG/x/y.png',
      'clients/acme/config',
      'clients/acme/crm/data',
      'clients/acme/context/google-ads/data',
      'clients/acme/crm/data/customers.csv',
      'clients/acme/CRM/Data/customers.csv',
      'clients/acme/context/google-ads/data/export.csv',
      'clients/acme/Context/Google-Ads/DATA/export.csv',
      'clients/_archive/old.png',
      'clients/_ARCHIVE/old.png',
      'clients/.hidden/x.md',
      '',
      'a/../b.png',
      'clients/acme/./x.png',
      'clients//x.png',
    ];
    for (const rel of refused) expect(isNeverListed(rel), rel).toBe(true);
  });

  it('refuses personal to-dos: they are to-dos, not documents (the folder itself too, so a walk never goes in)', () => {
    const refused = [
      'personal/todo',
      'personal/todo/20261113-feed-the-cat.md',
      'personal/todo/done/20261101-x.md',
      'personal/todo/deleted/20261101-x.md',
      'personal/Todo/x.md',
    ];
    for (const rel of refused) expect(isNeverListed(rel), rel).toBe(true);
    // Only that one folder: a file or folder merely named "todo" elsewhere is still listed.
    const allowed = [
      'personal/todo.md',
      'personal/todos/x.md',
      'personal/projects/todo/x.md',
      'clients/acme/context/brand/style-guide/todo.md',
    ];
    for (const rel of allowed) expect(isNeverListed(rel), rel).toBe(false);
  });

  it('allows ordinary places', () => {
    const allowed = [
      'clients/acme/reports/x.pdf',
      'clients/acme/crm/import-map.csv',
      'clients/acme/context/google-ads/summary.md',
      'clients/acme/context/brand/logo.png',
      'clients/acme/landing-pages/config-page/hero.png',
      'personal/notes/idea.md',
      'personal/config/x.md',
    ];
    for (const rel of allowed) expect(isNeverListed(rel), rel).toBe(false);
  });
});

describe('tidyFileName', () => {
  it('drops the extension and dashes, keeping the date-free words', () => {
    expect(tidyFileName('monthly-report.pdf')).toBe('Monthly report');
    expect(tidyFileName('20261101-renew_contract.md')).toBe('Renew contract');
    expect(tidyFileName('2026-11-02-keywords.csv')).toBe('Keywords');
    expect(tidyFileName('2026-11-02.csv')).toBe('2026-11-02');
    expect(tidyFileName('logo.png')).toBe('Logo');
    expect(tidyFileName('ga4-setup-pdf-notes.md')).toBe('GA4 setup PDF notes');
    expect(tidyFileName('seo.md')).toBe('SEO');
    expect(tidyFileName('crmish-notes.md')).toBe('Crmish notes');
  });
});
