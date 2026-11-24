// Projects R2 phase 5 (plan docs/plans/2026-11-24-projects-r2-email-entries.md, decision 2): which project a draft
// is pre-selected for. Pure table test, written first.
import { describe, expect, it } from 'vitest';
import type { EmailRoute } from '../../shared/project-email-contract.ts';
import { type EmailRouteContext, type EmailRouteFacts, routeEmail } from './email-route.ts';

const facts = (over: Partial<EmailRouteFacts> = {}): EmailRouteFacts => ({
  requested: null,
  inboxOwner: 'sam-example',
  threadId: 'abc12345',
  emailKey: '<m1@x>',
  threadMessageIds: [],
  codesSubject: [],
  codesBody: [],
  fromDomain: 'acme.test',
  ...over,
});

const LIVE = new Set(['acme/web', 'acme/seo', 'skyseal/web', 'zeta/one']);
const ctx = (over: Partial<EmailRouteContext> = {}): EmailRouteContext => ({
  isLive: (k) => LIVE.has(k),
  linkedThread: () => null,
  linkedMessage: () => null,
  resolveCode: (c) =>
    ({ ACM1A2: 'acme/web', ACM3B4: 'acme/seo', ZET1A2: 'zeta/one', OLD1A2: 'acme/old' })[c] ?? null,
  liveProjectsOfDomain: (d) =>
    d === 'skyseal.test' ? ['skyseal/web'] : d === 'acme.test' ? ['acme/web', 'acme/seo'] : null,
  ...over,
});

const none: EmailRoute = { key: null, why: 'none' };

describe('routeEmail', () => {
  const rows: [string, Partial<EmailRouteFacts>, Partial<EmailRouteContext>, EmailRoute][] = [
    [
      'requested wins over everything',
      { requested: 'zeta/one', codesSubject: ['ACM1A2'] },
      {},
      { key: 'zeta/one', why: 'requested' },
    ],
    [
      'requested but not live falls through',
      { requested: 'gone/x', codesSubject: ['ACM1A2'] },
      {},
      { key: 'acme/web', why: 'subject-code' },
    ],
    [
      'a thread this owner already linked',
      { codesSubject: ['ZET1A2'] },
      { linkedThread: (o, t) => (o === 'sam-example' && t === 'abc12345' ? 'acme/seo' : null) },
      { key: 'acme/seo', why: 'thread' },
    ],
    [
      'linked thread in an archived project is skipped',
      { codesSubject: ['ZET1A2'] },
      { linkedThread: () => 'acme/archived' },
      { key: 'zeta/one', why: 'subject-code' },
    ],
    [
      'a Message-ID already in a project (the draft key)',
      { codesSubject: ['ZET1A2'] },
      { linkedMessage: (id) => (id === '<m1@x>' ? 'skyseal/web' : null) },
      { key: 'skyseal/web', why: 'message' },
    ],
    [
      'a Message-ID already in a project (another message of the thread)',
      { threadMessageIds: ['<a@x>', '<b@x>'] },
      { linkedMessage: (id) => (id === '<b@x>' ? 'skyseal/web' : null) },
      { key: 'skyseal/web', why: 'message' },
    ],
    ['one subject code', { codesSubject: ['ACM1A2'] }, {}, { key: 'acme/web', why: 'subject-code' }],
    ['one body code', { codesBody: ['ZET1A2'] }, {}, { key: 'zeta/one', why: 'body-code' }],
    [
      'subject code beats body code when they agree',
      { codesSubject: ['ACM1A2'], codesBody: ['ACM1A2'] },
      {},
      { key: 'acme/web', why: 'subject-code' },
    ],
    [
      'two different subject codes disagree',
      { codesSubject: ['ACM1A2', 'ZET1A2'] },
      {},
      { key: null, why: 'codes-disagree', codes: ['ACM1A2', 'ZET1A2'] },
    ],
    [
      'subject and body codes that differ disagree',
      { codesSubject: ['ACM1A2'], codesBody: ['ZET1A2'] },
      {},
      { key: null, why: 'codes-disagree', codes: ['ACM1A2', 'ZET1A2'] },
    ],
    [
      'two body codes disagree, no domain fallback',
      { codesBody: ['ACM1A2', 'ZET1A2'], fromDomain: 'skyseal.test' },
      {},
      { key: null, why: 'codes-disagree', codes: ['ACM1A2', 'ZET1A2'] },
    ],
    ['unknown code is ignored', { codesSubject: ['NOP1A2'], fromDomain: 'nobody.test' }, {}, none],
    [
      'unknown code does not block a real one',
      { codesSubject: ['NOP1A2', 'ACM1A2'] },
      {},
      { key: 'acme/web', why: 'subject-code' },
    ],
    [
      'a code for an archived or done project is ignored',
      { codesSubject: ['OLD1A2'], fromDomain: 'skyseal.test' },
      {},
      { key: 'skyseal/web', why: 'domain' },
    ],
    [
      'domain with one live project',
      { fromDomain: 'skyseal.test' },
      {},
      { key: 'skyseal/web', why: 'domain' },
    ],
    [
      'domain whose client has several live projects',
      { fromDomain: 'acme.test' },
      {},
      { key: null, why: 'domain-several' },
    ],
    ['domain of no client', { fromDomain: 'nobody.test' }, {}, none],
    ['client with no live project', { fromDomain: 'acme.test' }, { liveProjectsOfDomain: () => [] }, none],
    ['nothing at all', { fromDomain: '' }, {}, none],
  ];
  it.each(rows)('%s', (_name, f, c, want) => {
    expect(routeEmail(facts(f), ctx(c))).toEqual(want);
  });

  it('never returns a key that is not live, whatever the linked answers say', () => {
    const r = routeEmail(
      facts(),
      ctx({ linkedMessage: () => 'acme/archived', liveProjectsOfDomain: () => ['acme/archived'] }),
    );
    expect(r.key).toBeNull();
  });
});
