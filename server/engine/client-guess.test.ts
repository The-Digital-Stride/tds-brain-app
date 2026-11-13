import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ClientGuessResponse } from '../../shared/contract.ts';
import { createBrainReaders } from '../brain/index.ts';
import { copyFixture } from '../brain/test-helpers.ts';
import { handleApi, type RouteContext } from '../http/routes.ts';
import {
  CLIENT_GUESS_MAX_CHARS,
  CLIENT_GUESS_THRESHOLDS,
  type ClientAlias,
  clientCriteria,
  createClientGuesser,
  type JevAsk,
  nameMatches,
} from './client-guess.ts';

// Shaped like the brain's real clients/map.json (aliases include folder-style spellings).
const CLIENTS: ClientAlias[] = [
  {
    slug: 'the-digital-stride',
    name: 'The Digital Stride',
    aliases: ['TDS', 'Digital Stride', 'Our Account', 'the_digital_stride', 'the-digital-stride'],
  },
  {
    slug: 'urban-cooling',
    name: 'Urban Cooling',
    aliases: ['Urban Cooling', 'UC', 'AC', 'Air Con', 'urban_cooling', 'urban-cooling'],
  },
  { slug: 'skyseal', name: 'Skyseal', aliases: ['Skyseal', 'Rooflights', 'skyseal'] },
  {
    slug: 'h2o-restoration',
    name: 'H2O Restoration',
    aliases: ['H2O', 'H2O Restorations', 'H2O Restoration', 'h2o_restorations', 'h2o-restoration'],
  },
  { slug: 'book-vault', name: 'Book Vault', aliases: ['Book Vault', 'Bookvault', 'BookVault', 'BV'] },
  { slug: 'astrum', name: 'Astrum', aliases: [] },
  { slug: 'weightmans', name: 'Weightmans', aliases: [] },
  { slug: 'weightmans-litigation', name: 'Weightmans Litigation', aliases: [] },
];

type JevAnswer = Awaited<ReturnType<JevAsk>>;

function answer(choice: string, probabilities: Record<string, number>, confidence = 0.95): JevAnswer {
  return { choice, confidence, probabilities };
}

/** A Jev stub that records what it was sent. */
function jev(result: JevAnswer | (() => Promise<JevAnswer>)) {
  const calls: { state: string; criteria: Record<string, string> }[] = [];
  const ask = vi.fn<JevAsk>(async (state, criteria) => {
    calls.push({ state, criteria });
    return typeof result === 'function' ? result() : result;
  });
  return { ask, calls };
}

describe('nameMatches', () => {
  it('finds a real name, the slug as words and name-like aliases, whole words, any case', () => {
    expect(nameMatches('Can you check skyseal ads?', CLIENTS).named).toEqual(['skyseal']);
    expect(nameMatches('urban cooling report', CLIENTS).named).toEqual(['urban-cooling']);
    expect(nameMatches('Write a post for digital stride', CLIENTS).named).toEqual(['the-digital-stride']);
    expect(nameMatches('h2o leads this week', CLIENTS).named).toEqual(['h2o-restoration']);
    expect(nameMatches('Bookvault stock page', CLIENTS).named).toEqual(['book-vault']);
    expect(nameMatches('the-digital-stride folder', CLIENTS).named).toEqual(['the-digital-stride']);
    expect(nameMatches('ASTRUM, please', CLIENTS).named).toEqual(['astrum']);
  });

  it('needs whole words', () => {
    expect(nameMatches('skysealing the roof', CLIENTS).named).toEqual([]);
    expect(nameMatches('astrumental', CLIENTS).named).toEqual([]);
  });

  it('treats nicknames as hints only, matching short or capital ones by exact case', () => {
    expect(nameMatches('TDS website copy', CLIENTS)).toEqual({ named: [], hinted: ['the-digital-stride'] });
    expect(nameMatches('the tds website', CLIENTS).hinted).toEqual([]);
    expect(nameMatches('the air con campaign', CLIENTS)).toEqual({ named: [], hinted: ['urban-cooling'] });
    expect(nameMatches('new rooflights page', CLIENTS)).toEqual({ named: [], hinted: ['skyseal'] });
    expect(nameMatches('our account budget', CLIENTS).hinted).toEqual(['the-digital-stride']);
    expect(nameMatches('AC servicing ads', CLIENTS).hinted).toEqual(['urban-cooling']);
    expect(nameMatches('an ac unit', CLIENTS).hinted).toEqual([]);
    expect(nameMatches('TACTICS', CLIENTS).hinted).toEqual([]);
  });

  it('does not hint a client that is already named', () => {
    expect(nameMatches('Urban Cooling AC ads', CLIENTS)).toEqual({ named: ['urban-cooling'], hinted: [] });
  });

  it('keeps the longer name when one client name sits inside another', () => {
    expect(nameMatches('Weightmans Litigation brief', CLIENTS).named).toEqual(['weightmans-litigation']);
    expect(nameMatches('Weightmans brief', CLIENTS).named).toEqual(['weightmans']);
    expect(nameMatches('Weightmans and Weightmans Litigation', CLIENTS).named).toEqual([
      'weightmans',
      'weightmans-litigation',
    ]);
  });

  it('lists matches in the order the clients are given', () => {
    expect(nameMatches('astrum vs skyseal', CLIENTS).named).toEqual(['skyseal', 'astrum']);
  });
});

describe('clientCriteria', () => {
  it('describes each client with its nicknames, the agency itself and none', () => {
    const c = clientCriteria(CLIENTS);
    expect(c['urban-cooling']).toBe('The client Urban Cooling (also called UC, AC, Air Con)');
    expect(c.skyseal).toBe('The client Skyseal (also called Rooflights)');
    expect(c.astrum).toBe('The client Astrum');
    expect(c['book-vault']).toBe('The client Book Vault (also called Bookvault, BV)');
    expect(c['the-digital-stride']).toBe("The Digital Stride's own marketing: its ads, website and SEO");
    expect(c.none).toBe(
      'Not about any one client: internal agency work, admin, tools, hiring or general questions',
    );
    expect(Object.keys(c)).toHaveLength(CLIENTS.length + 1);
  });
});

describe('createClientGuesser', () => {
  it('is sure without Jev when the message names one client', async () => {
    const { ask } = jev(answer('astrum', { astrum: 1 }));
    const guess = createClientGuesser({ ask });
    expect(await guess('Draft the Skyseal newsletter', CLIENTS)).toEqual({
      kind: 'sure',
      client: 'skyseal',
      how: 'named',
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('asks with both when two clients are named, without Jev', async () => {
    const { ask } = jev(answer('astrum', { astrum: 1 }));
    const guess = createClientGuesser({ ask });
    expect(await guess('Compare Astrum and Skyseal spend', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['skyseal', 'astrum'],
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('never trusts a nickname alone: it asks Jev, and puts the hint first when Jev is unsure', async () => {
    for (const [text, slug] of [
      ['TDS homepage copy', 'the-digital-stride'],
      ['air con leads are down', 'urban-cooling'],
      ['rooflights landing page', 'skyseal'],
    ] as const) {
      const { ask, calls } = jev(answer('astrum', { astrum: 0.5, [slug]: 0.3, none: 0.2 }, 0.4));
      const out = await createClientGuesser({ ask })(text, CLIENTS);
      expect(calls).toHaveLength(1);
      expect(out).toEqual({ kind: 'ask', options: [slug, 'astrum'] });
    }
  });

  it('puts hinted clients first when Jev is down', async () => {
    const guess = createClientGuesser({ ask: async () => null });
    expect(await guess('rooflights landing page', CLIENTS)).toEqual({ kind: 'ask', options: ['skyseal'] });
  });

  it('is sure when Jev is', async () => {
    const { ask, calls } = jev(answer('urban-cooling', { 'urban-cooling': 0.93, none: 0.07 }, 0.85));
    const out = await createClientGuesser({ ask })('the aircon ads', CLIENTS);
    expect(out).toEqual({ kind: 'sure', client: 'urban-cooling', how: 'jev' });
    expect(calls[0]?.state).toBe('the aircon ads');
    expect(calls[0]?.criteria).toEqual(clientCriteria(CLIENTS));
  });

  it('asks when Jev picks a client with too little probability or confidence', async () => {
    const low = jev(answer('skyseal', { skyseal: 0.89, astrum: 0.11 }, 0.99));
    expect(await createClientGuesser({ ask: low.ask })('roof stuff', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['skyseal', 'astrum'],
    });
    const unsure = jev(answer('skyseal', { skyseal: 0.95, astrum: 0.05 }, 0.79));
    expect(await createClientGuesser({ ask: unsure.ask })('roof stuff', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['skyseal'],
    });
  });

  it('says none when Jev is sure it is not client work', async () => {
    const { ask } = jev(answer('none', { none: 0.8, astrum: 0.2 }, 0.1));
    expect(await createClientGuesser({ ask })('How do I book holiday?', CLIENTS)).toEqual({ kind: 'none' });
  });

  it('asks when Jev leans to none but not enough', async () => {
    const { ask } = jev(answer('none', { none: 0.79, astrum: 0.21 }));
    expect(await createClientGuesser({ ask })('star chart', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['astrum'],
    });
  });

  it('drops options under 0.10 and keeps at most 2 from Jev, best first', async () => {
    const { ask } = jev(
      answer(
        'astrum',
        { astrum: 0.4, skyseal: 0.3, 'book-vault': 0.2, 'urban-cooling': 0.09, none: 0.01 },
        0.5,
      ),
    );
    expect(await createClientGuesser({ ask })('which one', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['astrum', 'skyseal'],
    });
  });

  it('caps options at 3 with hints first, without repeats', async () => {
    const { ask } = jev(answer('skyseal', { skyseal: 0.4, 'urban-cooling': 0.3, astrum: 0.2 }, 0.5));
    expect(await createClientGuesser({ ask })('TDS and AC and rooflights', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['the-digital-stride', 'urban-cooling', 'skyseal'],
    });
  });

  it('ignores probabilities for slugs it did not offer', async () => {
    const { ask } = jev(answer('astrum', { astrum: 0.5, 'made-up': 0.4 }, 0.5));
    expect(await createClientGuesser({ ask })('hmm', CLIENTS)).toEqual({ kind: 'ask', options: ['astrum'] });
  });

  it('treats a choice outside the criteria as Jev unavailable', async () => {
    const { ask } = jev(answer('made-up', { 'made-up': 0.99 }, 0.99));
    expect(await createClientGuesser({ ask })('air con', CLIENTS)).toEqual({
      kind: 'ask',
      options: ['urban-cooling'],
    });
  });

  it('asks with no options when Jev returns null, throws, or is not set up', async () => {
    expect(await createClientGuesser({ ask: async () => null })('hello', CLIENTS)).toEqual({
      kind: 'ask',
      options: [],
    });
    const throws = createClientGuesser({
      ask: async () => {
        throw new Error('boom');
      },
    });
    expect(await throws('hello', CLIENTS)).toEqual({ kind: 'ask', options: [] });
    expect(await createClientGuesser({ ask: null })('hello', CLIENTS)).toEqual({ kind: 'ask', options: [] });
  });

  it('gives up on Jev after the timeout and aborts the call', async () => {
    let signal: AbortSignal | undefined;
    const guess = createClientGuesser({
      timeoutMs: 20,
      ask: (_state, _criteria, s) => {
        signal = s;
        return new Promise<JevAnswer>(() => {});
      },
    });
    expect(await guess('hello', CLIENTS)).toEqual({ kind: 'ask', options: [] });
    expect(signal?.aborted).toBe(true);
  });

  it('keeps its thresholds in one exported block', () => {
    expect(CLIENT_GUESS_THRESHOLDS).toMatchObject({
      sureProbability: 0.9,
      sureConfidence: 0.8,
      noneProbability: 0.8,
      optionProbability: 0.1,
    });
  });

  it('skips Jev for 60 seconds after a failure', async () => {
    let t = 1_000_000;
    let fail = true;
    const ask = vi.fn<JevAsk>(async () => (fail ? null : answer('astrum', { astrum: 0.99 }, 0.99)));
    const guess = createClientGuesser({ ask, now: () => t });
    expect(await guess('hello', CLIENTS)).toEqual({ kind: 'ask', options: [] });
    fail = false;
    t += 59_999;
    expect(await guess('hello', CLIENTS)).toEqual({ kind: 'ask', options: [] });
    expect(ask).toHaveBeenCalledTimes(1);
    t += 1;
    expect(await guess('hello', CLIENTS)).toEqual({ kind: 'sure', client: 'astrum', how: 'jev' });
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('says none for empty text or a skill with nothing after it, sending nothing', async () => {
    const { ask } = jev(answer('astrum', { astrum: 1 }));
    const guess = createClientGuesser({ ask });
    expect(await guess('', CLIENTS)).toEqual({ kind: 'none' });
    expect(await guess('   \n ', CLIENTS)).toEqual({ kind: 'none' });
    expect(await guess('/seo-audit', CLIENTS)).toEqual({ kind: 'none' });
    expect(await guess('/seo-audit  for Skyseal', CLIENTS)).toEqual({
      kind: 'sure',
      client: 'skyseal',
      how: 'named',
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it('cuts the text to 4,000 characters before matching and sending', async () => {
    const { ask, calls } = jev(answer('none', { none: 0.99 }));
    const text = `${'x'.repeat(CLIENT_GUESS_MAX_CHARS)} Skyseal`;
    expect(await createClientGuesser({ ask })(text, CLIENTS)).toEqual({ kind: 'none' });
    expect(calls[0]?.state).toHaveLength(CLIENT_GUESS_MAX_CHARS);
  });

  it('says none when there are no clients at all', async () => {
    const { ask } = jev(answer('none', { none: 1 }));
    expect(await createClientGuesser({ ask })('hello', [])).toEqual({ kind: 'none' });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe('POST /api/client-guess', () => {
  async function call(body: string, method = 'POST', guess?: RouteContext['clientGuess']) {
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      method,
      headers: { 'content-length': String(Buffer.byteLength(body)) },
    });
    const sent = { status: 0, body: '' };
    const res = {
      headersSent: false,
      writeHead: (status: number) => {
        sent.status = status;
      },
      end: (text: string) => {
        sent.body = text;
      },
    };
    const root = copyFixture();
    const ctx = { brain: createBrainReaders(root), clientGuess: guess, log: () => {} };
    await handleApi(
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      new URL('http://127.0.0.1:3877/api/client-guess'),
      ctx as unknown as RouteContext,
    );
    return { status: sent.status, json: JSON.parse(sent.body) as unknown };
  }

  it('answers with the guess for the brain’s clients', async () => {
    const out = await call(JSON.stringify({ text: 'Acme Heating boiler ads' }));
    expect(out).toEqual({ status: 200, json: { kind: 'sure', client: 'acme-heating', how: 'named' } });
  });

  it('passes the clients with their map.json aliases and cuts the text to 4,000', async () => {
    const seen: { text: string; slugs: string[] }[] = [];
    const guess = async (text: string, clients: ClientAlias[]): Promise<ClientGuessResponse> => {
      seen.push({ text, slugs: clients.map((c) => c.slug) });
      return { kind: 'none' };
    };
    const out = await call(JSON.stringify({ text: 'y'.repeat(9_000) }), 'POST', guess);
    expect(out).toEqual({ status: 200, json: { kind: 'none' } });
    expect(seen[0]?.text).toHaveLength(CLIENT_GUESS_MAX_CHARS);
    expect(seen[0]?.slugs.sort()).toEqual(['acme-heating', 'northwind']);
  });

  it('says none for empty text', async () => {
    expect(await call(JSON.stringify({ text: '' }))).toEqual({ status: 200, json: { kind: 'none' } });
  });

  it('refuses text that is not a string, and other methods', async () => {
    for (const body of [JSON.stringify({ text: 42 }), JSON.stringify({}), JSON.stringify(['x'])]) {
      const out = await call(body);
      expect(out.status).toBe(400);
      expect(out.json).toMatchObject({ error: { code: 'bad-request' } });
    }
    expect((await call('', 'GET')).status).toBe(405);
  });
});
