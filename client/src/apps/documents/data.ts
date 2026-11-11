/**
 * Sample data for the example Documents app. Nothing here is read from a brain: the two clients
 * are the pretend ones the preview uses, and every document is made up.
 */

export type Format = 'pdf' | 'doc' | 'sheet' | 'deck';
export type Status = 'draft' | 'final' | 'sent';

export interface LibraryDoc {
  id: string;
  /** Client folder name, e.g. "acme-heating". */
  client: string;
  folder: string;
  format: Format;
  /** What a person calls it, e.g. "October performance report". */
  title: string;
  /** The file's name. */
  name: string;
  /** Where the file would sit in the brain. */
  path: string;
  /** Pages for a PDF, words for a doc, rows for a sheet, slides for a deck. */
  length: number;
  bytes: number;
  /** YYYY-MM-DD. */
  updated: string;
  by: string;
  status: Status;
  tags: string[];
  /** The headings inside it, in order. */
  outline: string[];
  /** What it belongs with, e.g. "To-do: Send the October report". */
  related: string[];
}

export const DOC_CLIENTS: { slug: string; name: string }[] = [
  { slug: 'acme-heating', name: 'Acme Heating Ltd' },
  { slug: 'northwind', name: 'Northwind' },
];

/** The order folders are shown in. */
export const DOC_FOLDERS = ['Reports', 'Plans', 'Briefs', 'Call notes', 'Notes'];

const FOLDER_PATHS: Record<string, string> = {
  Reports: 'reports',
  Plans: 'plans',
  Briefs: 'briefs',
  'Call notes': 'call-notes',
  Notes: 'notes',
};

export const FORMAT_WORDS: Record<Format, string> = { pdf: 'PDF', doc: 'Doc', sheet: 'Sheet', deck: 'Deck' };
export const STATUS_WORDS: Record<Status, string> = {
  draft: 'Draft',
  final: 'Final',
  sent: 'Sent to client',
};

type Row = [
  folder: string,
  format: Format,
  title: string,
  name: string,
  length: number,
  kb: number,
  updated: string,
  by: string,
  status: Status,
  tags: string,
  outline: string[],
  related?: string[],
];

function rows(client: string, list: Row[]): LibraryDoc[] {
  return list.map(
    ([folder, format, title, name, length, kb, updated, by, status, tags, outline, related]) => ({
      id: `${client}/${name}`,
      client,
      folder,
      format,
      title,
      name,
      path: `clients/${client}/${FOLDER_PATHS[folder] ?? 'notes'}/${name}`,
      length,
      bytes: kb * 1000,
      updated,
      by,
      status,
      tags: tags.split(' '),
      outline,
      related: related ?? [],
    }),
  );
}

const REPORT = ['Summary', 'Leads and cost per lead', 'What we changed', 'Search terms', 'Next month'];
const NOTES = ['Who was there', 'Decisions', 'Actions', 'Figures checked'];

export const DOCUMENTS: LibraryDoc[] = [
  ...rows('acme-heating', [
    [
      'Reports',
      'pdf',
      'October performance report',
      '2026-11-03-october-performance-report.pdf',
      12,
      840,
      '2026-11-03',
      'Priya Shah',
      'sent',
      'monthly google-ads leads',
      REPORT,
      ['To-do: Send the October report', 'Call note: October review call'],
    ],
    [
      'Reports',
      'pdf',
      'September performance report',
      '2026-10-02-september-performance-report.pdf',
      11,
      792,
      '2026-10-02',
      'Priya Shah',
      'sent',
      'monthly google-ads leads',
      REPORT,
    ],
    [
      'Reports',
      'pdf',
      'Google Ads audit',
      '2026-09-15-google-ads-audit.pdf',
      24,
      2300,
      '2026-09-15',
      'Sam Example',
      'final',
      'audit google-ads tracking',
      ['Score', 'Tracking', 'Structure', 'Search terms', 'Bidding', 'Fix list'],
      ['Plan: Winter boiler campaign'],
    ],
    [
      'Reports',
      'deck',
      'Quarter three review',
      '2026-10-09-quarter-three-review.pptx',
      14,
      4100,
      '2026-10-09',
      'Sam Example',
      'sent',
      'quarterly review',
      ['Where we started', 'Leads by channel', 'Cost per lead', 'What worked', 'Plan for winter'],
      ['Call note: Quarter three review call'],
    ],
    [
      'Reports',
      'sheet',
      'Lead quality by campaign',
      '2026-11-05-lead-quality-by-campaign.csv',
      240,
      38,
      '2026-11-05',
      'Priya Shah',
      'draft',
      'leads crm quality',
      ['Campaign', 'Leads', 'Booked jobs', 'Cost per booked job'],
    ],
    [
      'Plans',
      'doc',
      'Winter boiler campaign',
      '2026-10-20-winter-boiler-campaign.md',
      1840,
      14,
      '2026-10-28',
      'Sam Example',
      'final',
      'campaign boiler winter',
      ['Goal', 'Audience', 'Offer', 'Campaign structure', 'Budget', 'Tracking', 'Dates'],
      ['Brief: Winter offer landing page', 'To-do: Build the winter campaign'],
    ],
    [
      'Plans',
      'sheet',
      'Winter budget split',
      '2026-10-21-winter-budget-split.xlsx',
      36,
      22,
      '2026-10-21',
      'Sam Example',
      'final',
      'budget winter',
      ['Channel', 'Monthly budget', 'Expected leads', 'Target cost per lead'],
      ['Plan: Winter boiler campaign'],
    ],
    [
      'Plans',
      'doc',
      'Tracking rebuild',
      '2026-09-22-tracking-rebuild.md',
      1210,
      9,
      '2026-09-30',
      'Priya Shah',
      'final',
      'tracking consent crm',
      ['What is wrong today', 'Conversions to keep', 'Consent', 'Offline imports', 'Order of work'],
    ],
    [
      'Plans',
      'doc',
      'Heat pump launch',
      '2026-11-06-heat-pump-launch.md',
      620,
      5,
      '2026-11-06',
      'Sam Example',
      'draft',
      'campaign heat-pump',
      ['Goal', 'Audience', 'Open questions'],
    ],
    [
      'Briefs',
      'doc',
      'Winter offer landing page',
      '2026-10-22-winter-offer-landing-page.md',
      780,
      6,
      '2026-10-22',
      'Sam Example',
      'final',
      'landing-page winter offer',
      ['What the page is for', 'Offer', 'Sections', 'Proof', 'Form'],
      ['Plan: Winter boiler campaign'],
    ],
    [
      'Briefs',
      'pdf',
      'Brand refresh request',
      '2026-08-04-brand-refresh-request.pdf',
      3,
      410,
      '2026-08-04',
      'Priya Shah',
      'final',
      'brand client-request',
      ['What the client asked for', 'Deadline', 'Files supplied'],
    ],
    [
      'Briefs',
      'doc',
      'Photo shoot shot list',
      '2026-09-01-photo-shoot-shot-list.md',
      430,
      4,
      '2026-09-03',
      'Priya Shah',
      'final',
      'photography van engineer',
      ['Vans', 'Engineers at work', 'Finished installs', 'Team'],
    ],
    [
      'Call notes',
      'doc',
      'October review call',
      '2026-11-04-october-review-call.md',
      960,
      8,
      '2026-11-04',
      'Sam Example',
      'final',
      'call review monthly',
      NOTES,
      ['Report: October performance report'],
    ],
    [
      'Call notes',
      'doc',
      'Quarter three review call',
      '2026-10-09-quarter-three-review-call.md',
      1320,
      10,
      '2026-10-10',
      'Sam Example',
      'final',
      'call review quarterly',
      NOTES,
    ],
    [
      'Call notes',
      'doc',
      'Tracking catch-up',
      '2026-09-24-tracking-catch-up.md',
      540,
      5,
      '2026-09-24',
      'Priya Shah',
      'final',
      'call tracking',
      NOTES,
    ],
    [
      'Notes',
      'doc',
      'Service areas and postcodes',
      '2026-07-14-service-areas-and-postcodes.md',
      310,
      3,
      '2026-10-15',
      'Priya Shah',
      'final',
      'geo targeting',
      ['Areas covered', 'Areas not covered', 'Postcode list'],
    ],
    [
      'Notes',
      'doc',
      'Reply to the pricing question',
      '2026-11-07-reply-to-the-pricing-question.md',
      180,
      2,
      '2026-11-07',
      'Sam Example',
      'draft',
      'email draft pricing',
      ['The question', 'Draft reply'],
    ],
    [
      'Notes',
      'sheet',
      'Competitor price check',
      '2026-10-30-competitor-price-check.csv',
      48,
      6,
      '2026-10-30',
      'Priya Shah',
      'final',
      'competitors pricing',
      ['Competitor', 'Boiler service price', 'Call-out fee', 'Checked on'],
    ],
  ]),
  ...rows('northwind', [
    [
      'Reports',
      'pdf',
      'October performance report',
      '2026-11-02-october-performance-report.pdf',
      9,
      610,
      '2026-11-02',
      'Sam Example',
      'sent',
      'monthly meta leads',
      REPORT,
    ],
    [
      'Reports',
      'pdf',
      'Website audit',
      '2026-10-12-website-audit.pdf',
      18,
      1900,
      '2026-10-12',
      'Priya Shah',
      'final',
      'audit seo website',
      ['Score', 'Speed', 'Indexing', 'Content', 'Fix list'],
    ],
    [
      'Plans',
      'doc',
      'Spring content plan',
      '2026-11-01-spring-content-plan.md',
      1460,
      11,
      '2026-11-05',
      'Priya Shah',
      'draft',
      'content seo',
      ['Goal', 'Topics', 'Calendar', 'Who writes what'],
    ],
    [
      'Briefs',
      'doc',
      'New service page',
      '2026-10-18-new-service-page.md',
      520,
      4,
      '2026-10-18',
      'Sam Example',
      'final',
      'landing-page service',
      ['What the page is for', 'Sections', 'Proof', 'Form'],
    ],
    [
      'Call notes',
      'doc',
      'Kick-off call',
      '2026-09-08-kick-off-call.md',
      1100,
      9,
      '2026-09-08',
      'Sam Example',
      'final',
      'call kick-off',
      NOTES,
    ],
    [
      'Notes',
      'sheet',
      'Keyword shortlist',
      '2026-10-25-keyword-shortlist.csv',
      120,
      12,
      '2026-10-25',
      'Priya Shah',
      'final',
      'keywords seo',
      ['Keyword', 'Monthly searches', 'Difficulty', 'Page'],
    ],
  ]),
];
