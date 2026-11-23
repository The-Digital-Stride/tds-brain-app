import { describe, expect, it } from 'vitest';
import {
  domainOf,
  type MatchClient,
  type MatchContext,
  type MatchMeeting,
  type MatchProject,
  matchClient,
  matchMeeting,
  websiteDomain,
} from './meeting-match.ts';

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
