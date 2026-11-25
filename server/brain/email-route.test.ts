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
      { key: 'acme/seo', why: 'thread', overruled: 'ZET1A2' },
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
      { key: 'skyseal/web', why: 'message', overruled: 'ZET1A2' },
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
    [
      'one thread code',
      { codesThread: ['ZET1A2'], fromDomain: 'skyseal.test' },
      {},
      { key: 'zeta/one', why: 'thread-code' },
    ],
    [
      'a body code beats a different thread code',
      { codesBody: ['ACM1A2'], codesThread: ['ZET1A2'] },
      {},
      { key: 'acme/web', why: 'body-code' },
    ],
    [
      'a subject code beats a different thread code',
      { codesSubject: ['ACM1A2'], codesThread: ['ZET1A2'] },
      {},
      { key: 'acme/web', why: 'subject-code' },
    ],
    [
      'two thread codes disagree',
      { codesThread: ['ACM1A2', 'ZET1A2'], fromDomain: 'skyseal.test' },
      {},
      { key: null, why: 'codes-disagree', codes: ['ACM1A2', 'ZET1A2'] },
    ],
    [
      'two thread codes for one project are one project',
      { codesThread: ['ACM1A2', 'ACM1A2'] },
      {},
      { key: 'acme/web', why: 'thread-code' },
    ],
    [
      'a thread code for a project that is not live is ignored',
      { codesThread: ['OLD1A2'], fromDomain: 'skyseal.test' },
      {},
      { key: 'skyseal/web', why: 'domain' },
    ],
    [
      'a thread key already in a project',
      { threadKeys: ['x:aaa', 'x:bbb'] },
      { linkedMessage: (id) => (id === 'x:bbb' ? 'skyseal/web' : null) },
      { key: 'skyseal/web', why: 'message' },
    ],
    [
      'a near key already in a project',
      { threadKeys: ['x:aaa'], nearKeys: { 'x:aaa': 'x:near' } },
      { linkedMessage: (id) => (id === 'x:near' ? 'skyseal/web' : null) },
      { key: 'skyseal/web', why: 'message' },
    ],
    [
      'the draft’s own near key',
      { emailKey: 'x:own', nearKeys: { 'x:own': 'x:ownnear' } },
      { linkedMessage: (id) => (id === 'x:ownnear' ? 'zeta/one' : null) },
      { key: 'zeta/one', why: 'message' },
    ],
    [
      'overruled: a saved thread beats a newer code for another project',
      { codesSubject: ['ZET1A2'] },
      { linkedThread: () => 'acme/seo' },
      { key: 'acme/seo', why: 'thread', overruled: 'ZET1A2' },
    ],
    [
      'overruled: a held message beats a body code for another project',
      { threadKeys: ['x:aaa'], codesBody: ['ZET1A2'] },
      { linkedMessage: () => 'acme/seo' },
      { key: 'acme/seo', why: 'message', overruled: 'ZET1A2' },
    ],
    [
      'not overruled when the newer code names the same project',
      { threadKeys: ['x:aaa'], codesBody: ['ACM3B4'] },
      { linkedMessage: () => 'acme/seo' },
      { key: 'acme/seo', why: 'message' },
    ],
    [
      'not overruled by a code for a project that is not live',
      { codesBody: ['OLD1A2'] },
      { linkedThread: () => 'acme/seo' },
      { key: 'acme/seo', why: 'thread' },
    ],
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
