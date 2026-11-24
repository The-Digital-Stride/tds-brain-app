import { describe, expect, it } from 'vitest';
import {
  cleanMeetingRefs,
  domainOf,
  type MatchClient,
  type MatchContext,
  type MatchMeeting,
  type MatchProject,
  matchClient,
  matchMeeting,
  websiteDomain,
} from './meeting-match.ts';
import { buildRefIndex } from './project-refs.ts';

const client = (slug: string, name: string, domain: string | null, aliases: string[] = []): MatchClient => ({
  slug,
  name,
  aliases,
  domain,
});
const project = (key: string, title: string, extra: Partial<MatchProject> = {}): MatchProject => ({
  key,
  client: key.split('/')[0] === 'personal' ? null : (key.split('/')[0] as string),
  title,
  status: 'active',
  archived: false,
  ...extra,
});
const meeting = (title: string, emails: string[] = [], extra: Partial<MatchMeeting> = {}): MatchMeeting => ({
  title,
  allDay: false,
  attendees: emails.map((email) => ({ name: null, email })),
  ...extra,
});

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  clients: [
    client('acme-heating', 'Acme Heating', 'acmeheating.co.uk'),
    client('skyseal', 'Skyseal', 'skyseal.com', ['SS', 'Sky Seal Roofing']),
    client('the-digital-stride', 'The Digital Stride', 'thedigitalstride.co.uk'),
  ],
  projects: [
    project('acme-heating/website-rebuild', 'Website rebuild'),
    project('acme-heating/ppc-campaign', 'PPC campaign'),
    project('skyseal/seo', 'SEO retainer'),
    project('the-digital-stride/internal-tools', 'Internal tooling'),
    project('personal/reading', 'Reading list'),
  ],
  ignoreDomains: ['thedigitalstride.co.uk'],
  selfEmails: ['me@thedigitalstride.co.uk'],
  ...over,
});

describe('domainOf and websiteDomain', () => {
  it('lowercases and rejects non-emails', () => {
    expect(domainOf('Jo@Acme.CO.uk')).toBe('acme.co.uk');
    expect(domainOf('nope')).toBeNull();
    expect(domainOf(null)).toBeNull();
  });
  it('reads the Website line, or a website: frontmatter line, without www', () => {
    expect(websiteDomain('# Acme\n\n**Website:** https://www.AcmeHeating.co.uk/about\n')).toBe(
      'acmeheating.co.uk',
    );
    expect(websiteDomain('---\nclient: X\nwebsite: "http://x.com"\n---\n')).toBe('x.com');
    // The brain's own profiles write it as a bullet.
    expect(websiteDomain('# Kinedo\n\n- **Website:** https://www.kinedo.co.uk\n')).toBe('kinedo.co.uk');
    expect(websiteDomain('- **Website:** https://bookvault.app — **always without www**\n')).toBe(
      'bookvault.app',
    );
    expect(websiteDomain('**Website:** not a url')).toBeNull();
    expect(websiteDomain('nothing')).toBeNull();
  });
});

describe('matchClient: by attendee domain', () => {
  it('matches the website domain and a subdomain of it', () => {
    expect(matchClient(meeting('x', ['a@acmeheating.co.uk']), ctx())).toBe('acme-heating');
    expect(matchClient(meeting('x', ['a@mail.acmeheating.co.uk']), ctx())).toBe('acme-heating');
  });
  it('does not match a look-alike domain', () => {
    expect(matchClient(meeting('x', ['a@notacmeheating.co.uk']), ctx())).toBeNull();
  });
  it('ignores agency, public and own addresses', () => {
    const c = ctx({
      clients: [client('tds', 'TDS Co', 'thedigitalstride.co.uk'), client('g', 'Gee', 'gmail.com')],
    });
    expect(matchClient(meeting('x', ['me@thedigitalstride.co.uk', 'a@gmail.com']), c)).toBeNull();
    const own = ctx({ ignoreDomains: [], selfEmails: ['me@acmeheating.co.uk'] });
    expect(matchClient(meeting('x', ['me@acmeheating.co.uk']), own)).toBeNull();
  });
  it('two domain clients fall to the title', () => {
    const m = meeting('Acme Heating catch up', ['a@acmeheating.co.uk', 'b@skyseal.com']);
    expect(matchClient(m, ctx())).toBe('acme-heating');
    expect(matchClient(meeting('Catch up', ['a@acmeheating.co.uk', 'b@skyseal.com']), ctx())).toBeNull();
  });
});

describe('matchClient: by title', () => {
  it('matches the name or an alias as whole words, ignoring case', () => {
    expect(matchClient(meeting('call with ACME heating team'), ctx())).toBe('acme-heating');
    expect(matchClient(meeting('Skyseals review'), ctx())).toBeNull();
    expect(matchClient(meeting('Sky Seal Roofing chat'), ctx())).toBe('skyseal');
  });
  it('a short alias only counts in capitals as written', () => {
    expect(matchClient(meeting('SS monthly'), ctx())).toBe('skyseal');
    expect(matchClient(meeting('ss monthly'), ctx())).toBeNull();
  });
  it('more than one: the most words matched; tied: none', () => {
    const c = ctx({
      clients: [client('a', 'Acme', null), client('b', 'Acme Heating', null)],
    });
    expect(matchClient(meeting('Acme Heating review'), c)).toBe('b');
    expect(matchClient(meeting('Acme review'), c)).toBe('a');
    const tie = ctx({ clients: [client('a', 'Acme', null), client('b', 'Heating', null)] });
    expect(matchClient(meeting('Acme Heating review'), tie)).toBeNull();
  });
});

describe('matchMeeting: project', () => {
  it('skips all-day events', () => {
    expect(matchMeeting(meeting('Skyseal SEO', [], { allDay: true }), ctx())).toBeNull();
  });
  it('scores title words of three letters or more, so SEO and PPC count', () => {
    expect(matchMeeting(meeting('Skyseal SEO check'), ctx())).toEqual({ key: 'skyseal/seo', match: 'title' });
    expect(matchMeeting(meeting('Acme Heating PPC'), ctx())).toEqual({
      key: 'acme-heating/ppc-campaign',
      match: 'title',
    });
  });
  it("leaves the client's own name out of the score", () => {
    const c = ctx({
      projects: [
        project('acme-heating/heating-audit', 'Acme Heating audit'),
        project('acme-heating/w', 'Website'),
      ],
    });
    expect(matchMeeting(meeting('Acme Heating website'), c)).toEqual({
      key: 'acme-heating/w',
      match: 'title',
    });
  });
  it('highest score wins; a tie means none', () => {
    expect(matchMeeting(meeting('Acme Heating website rebuild'), ctx())).toEqual({
      key: 'acme-heating/website-rebuild',
      match: 'title',
    });
    expect(matchMeeting(meeting('Acme Heating website PPC'), ctx())).toBeNull();
  });
  it('a project with no qualifying words cannot match by title', () => {
    const c = ctx({ projects: [project('skyseal/x', 'SC'), project('skyseal/y', 'Go on')] });
    expect(matchMeeting(meeting('Skyseal SC go on'), c)).toBeNull();
    const lone = ctx({ projects: [project('skyseal/x', 'SC'), project('skyseal/z', 'Link audit')] });
    expect(matchMeeting(meeting('Skyseal SC link'), lone)).toEqual({ key: 'skyseal/z', match: 'title' });
  });
  it('common words like "the" and "call" never score', () => {
    const c = ctx({
      projects: [
        project('acme-heating/new', 'The new website'),
        project('acme-heating/calls', 'Weekly call notes'),
      ],
    });
    expect(matchMeeting(meeting('Acme Heating: the weekly call'), c)).toBeNull();
    expect(matchMeeting(meeting('Acme Heating website'), c)).toEqual({
      key: 'acme-heating/new',
      match: 'title',
    });
  });
  it('exactly one open project and no title match is a likely match', () => {
    expect(matchMeeting(meeting('Skyseal catch up'), ctx())).toEqual({ key: 'skyseal/seo', match: 'only' });
  });
  it('several projects and no title match: none', () => {
    expect(matchMeeting(meeting('Acme Heating catch up'), ctx())).toBeNull();
  });
  it('done and archived projects never match', () => {
    const c = ctx({
      projects: [
        project('skyseal/seo', 'SEO retainer', { status: 'done' }),
        project('skyseal/old', 'Old stuff', { archived: true }),
      ],
    });
    expect(matchMeeting(meeting('Skyseal SEO retainer old stuff'), c)).toBeNull();
  });
  it('one open project among a done one is the only one', () => {
    const c = ctx({
      projects: [project('skyseal/seo', 'SEO retainer'), project('skyseal/old', 'Old', { status: 'done' })],
    });
    expect(matchMeeting(meeting('Skyseal chat'), c)).toEqual({ key: 'skyseal/seo', match: 'only' });
  });
  it('an outside guest with no known client never lands on an internal or personal project', () => {
    const c = ctx({
      clients: [
        client('acme-heating', 'Acme Heating', null),
        client('skyseal', 'Skyseal', 'skyseal.com'),
        client('the-digital-stride', 'The Digital Stride', 'thedigitalstride.co.uk'),
      ],
      projects: [
        project('the-digital-stride/seo-audit', 'SEO audit'),
        project('personal/website', 'Website'),
      ],
    });
    // Acme has no Website line, so its guest can't be placed.
    expect(matchMeeting(meeting('SEO monthly review', ['jo@acmeheating.co.uk']), c)).toBeNull();
    // Two clients invited and the title names neither.
    expect(
      matchMeeting(meeting('SEO joint workshop', ['jo@acmeheating.co.uk', 'x@skyseal.com']), c),
    ).toBeNull();
    // A stranger's invite can't reach a personal project either.
    expect(matchMeeting(meeting('Website chat', ['someone@elsewhere.io']), c)).toBeNull();
    // Agency-only meetings still match internal projects by title.
    expect(matchMeeting(meeting('SEO audit planning', ['amy@thedigitalstride.co.uk']), c)).toEqual({
      key: 'the-digital-stride/seo-audit',
      match: 'title',
    });
  });
  it('internal and personal projects match by title words only', () => {
    expect(matchMeeting(meeting('Internal tooling sync'), ctx())).toEqual({
      key: 'the-digital-stride/internal-tools',
      match: 'title',
    });
    expect(matchMeeting(meeting('Reading list time'), ctx())).toEqual({
      key: 'personal/reading',
      match: 'title',
    });
    expect(matchMeeting(meeting('The Digital Stride all hands'), ctx())).toBeNull();
    expect(matchMeeting(meeting('Lunch'), ctx())).toBeNull();
  });
  it('matches through the domain with the project from the title', () => {
    expect(matchMeeting(meeting('Weekly SEO', ['x@skyseal.com']), ctx())).toEqual({
      key: 'skyseal/seo',
      match: 'title',
    });
  });
});

describe('matchMeeting: project codes (decision 10)', () => {
  const codes = new Map<string, string | null>([
    ['acme-heating', 'ACM'],
    ['skyseal', 'SKY'],
    ['the-digital-stride', 'TDS'],
  ]);
  const card = (key: string, ref: string | null, space: 'client' | 'personal' = 'client') => ({
    key,
    space,
    client: space === 'personal' ? null : (key.split('/')[0] as string),
    ref,
  });
  const withRefs = (
    cards = [
      card('acme-heating/website-rebuild', 'ACM4K7'),
      card('acme-heating/ppc-campaign', 'ACM5M2'),
      card('skyseal/seo', 'SKY4K7'),
      card('personal/reading', 'TDS9A9', 'personal'),
      card('skyseal/dup-a', 'SKY6N3'),
      card('skyseal/dup-b', 'SKY6N3'),
    ],
  ): MatchContext => ctx({ refs: buildRefIndex(cards, codes).index });

  it('matches one code in the title, with no title words or attendees needed', () => {
    expect(matchMeeting(meeting('Catch up [ACM4K7]'), withRefs())).toEqual({
      key: 'acme-heating/website-rebuild',
      match: 'ref',
    });
    expect(matchMeeting(meeting('acm4k7 call'), withRefs())?.match).toBe('ref');
  });

  it('reads the cached refs defensively and combines them with the title', () => {
    const c = withRefs();
    expect(matchMeeting(meeting('Lunch', [], { refs: ['sky4k7'] }), c)?.key).toBe('skyseal/seo');
    expect(matchMeeting(meeting('ACM4K7', [], { refs: ['ACM4K7'] }), c)?.key).toBe(
      'acme-heating/website-rebuild',
    );
    for (const bad of ['SKY4K7', 42, { a: 1 }, [1, null, 'nope'], null]) {
      expect(matchMeeting(meeting('Lunch', [], { refs: bad }), c)).toBeNull();
    }
  });

  it('two different projects ignore codes and run the phase 4 rules', () => {
    const m = meeting('PPC campaign ACM4K7 ACM5M2', ['x@acmeheating.co.uk']);
    expect(matchMeeting(m, withRefs())).toEqual({ key: 'acme-heating/ppc-campaign', match: 'title' });
  });

  it('a domain pointing at another client ignores the code', () => {
    const m = meeting('Weekly SEO ACM4K7', ['x@skyseal.com']);
    expect(matchMeeting(m, withRefs())).toEqual({ key: 'skyseal/seo', match: 'title' });
  });

  it('a domain of the same client, public mail or the agency still matches by code', () => {
    const c = withRefs();
    expect(matchMeeting(meeting('ACM4K7', ['x@acmeheating.co.uk']), c)?.match).toBe('ref');
    expect(matchMeeting(meeting('ACM4K7', ['x@gmail.com', 'me2@thedigitalstride.co.uk']), c)?.match).toBe(
      'ref',
    );
  });

  it('personal and duplicate codes never match', () => {
    const c = withRefs();
    expect(matchMeeting(meeting('TDS9A9'), c)).toBeNull();
    expect(matchMeeting(meeting('SKY6N3'), c)).toBeNull();
  });

  it('a moved card keeps its code and the client comes from the card', () => {
    const c = ctx({
      refs: buildRefIndex([card('skyseal/moved', 'ACM4K7')], codes).index,
      projects: [project('skyseal/moved', 'Moved thing')],
    });
    expect(matchMeeting(meeting('ACM4K7', ['x@acmeheating.co.uk']), c)).toBeNull();
    expect(matchMeeting(meeting('ACM4K7', ['x@skyseal.com']), c)).toEqual({
      key: 'skyseal/moved',
      match: 'ref',
    });
  });

  it('an archived project is ignored for codes (overseer); a done one still matches', () => {
    const refs = buildRefIndex(
      [card('acme-heating/old', 'ACM4K7'), card('acme-heating/finished', 'ACM5M2')],
      codes,
    ).index;
    const c = ctx({
      refs,
      projects: [
        project('acme-heating/old', 'Old', { archived: true }),
        project('acme-heating/finished', 'Finished', { status: 'done' }),
        project('acme-heating/website-rebuild', 'Website rebuild'),
      ],
    });
    expect(matchMeeting(meeting('Catch up ACM4K7', ['x@acmeheating.co.uk']), c)).toEqual({
      key: 'acme-heating/website-rebuild',
      match: 'only',
    });
    expect(matchMeeting(meeting('ACM5M2'), c)).toEqual({ key: 'acme-heating/finished', match: 'ref' });
  });

  it('a context or cache with no refs behaves as before', () => {
    expect(matchMeeting(meeting('Website rebuild ACM4K7', ['x@acmeheating.co.uk']), ctx())).toEqual({
      key: 'acme-heating/website-rebuild',
      match: 'title',
    });
    expect(matchMeeting(meeting('Lunch ACM4K7'), withRefs([]))).toBeNull();
  });

  it('cleanMeetingRefs upper-cases, validates, de-duplicates and caps', () => {
    expect(cleanMeetingRefs(['acm4k7', 'ACM4K7', 'AB123', 5])).toEqual(['ACM4K7']);
    const many = Array.from({ length: 40 }, (_, i) => `ACM${(i % 8) + 2}K${(i % 7) + 2}`);
    expect(cleanMeetingRefs(many).length).toBeLessThanOrEqual(20);
  });
});
