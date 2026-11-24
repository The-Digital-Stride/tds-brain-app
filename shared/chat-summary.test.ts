// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../client/src/markdown.tsx';
import {
  composeChatSummary,
  normaliseChatSummaryFields,
  readChatSummary,
  writableChatTitle,
} from './chat-summary.ts';
import {
  CHAT_DOC_NAME_MAX,
  CHAT_DOCUMENTS_MAX,
  CHAT_FIGURE_MAX,
  CHAT_FIGURES_MAX,
  CHAT_NEXT_STEP_MAX,
  CHAT_NEXT_STEPS_MAX,
  CHAT_OBJECTIVE_MAX,
  CHAT_OUTCOME_MAX,
  type ChatSummaryFields,
} from './chat-summary-contract.ts';
import { UPDATE_SUMMARY_MAX } from './project-updates-contract.ts';

const full: ChatSummaryFields = {
  objective: 'Fix the checkout',
  outcome: 'Done, shipped.',
  figures: ['Conversion 2.1% to 2.9%', '12 pages'],
  documents: [{ ref: 'clients/acme/projects/web/report.md', name: 'Report' }],
  nextSteps: ['Tell the client', 'Re-run the audit'],
};

describe('composeChatSummary', () => {
  it('uses the contract layout and order', () => {
    expect(composeChatSummary(full)).toBe(
      [
        '**Objective:** Fix the checkout',
        '**Outcome:** Done, shipped.',
        '**Key figures:**\n- Conversion 2.1% to 2.9%\n- 12 pages',
        '**Documents:**\n- [Report](clients/acme/projects/web/report.md)',
        '**Next steps:**\n- Tell the client\n- Re-run the audit',
      ].join('\n\n'),
    );
  });

  it('folds line ends, trims, and drops empty items and sections', () => {
    const body = composeChatSummary({
      objective: '  one\n\ntwo\r\nthree ',
      outcome: 'ok',
      figures: ['  ', ''],
      documents: [{ ref: '', name: 'x' }],
      nextSteps: [' a\nb ', ''],
    });
    expect(body).toBe('**Objective:** one two three\n\n**Outcome:** ok\n\n**Next steps:**\n- a b');
  });

  it('round trips the normalised fields', () => {
    const f: ChatSummaryFields = {
      objective: 'A [link](https://x.test) and ![img](https://x.test/a.png) <b>',
      outcome: 'back\\slash *star* _under_ `tick`',
      figures: ['[x](y)'],
      documents: [{ ref: 'a b/(c).md', name: 'Name [with](brackets)' }],
      nextSteps: ['Do `it`'],
    };
    expect(readChatSummary(composeChatSummary(f))).toEqual(normaliseChatSummaryFields(f));
  });

  it('round trips the plain example', () => {
    expect(readChatSummary(composeChatSummary(full))).toEqual(full);
  });

  it('never renders a link or image from text fields', () => {
    const evil =
      '[x](https://evil.test) ![i](https://evil.test/a.png) <img src="https://evil.test/p"> <https://evil.test>';
    const html = renderMarkdown(
      composeChatSummary({
        objective: evil,
        outcome: evil,
        figures: [evil],
        documents: [{ ref: 'a.md', name: evil }],
        nextSteps: [evil],
      }),
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('img, a[href]')).toHaveLength(0);
  });

  it('keeps a ref inside the link target however it is written', () => {
    const body = composeChatSummary({
      objective: 'o',
      outcome: 'p',
      figures: [],
      documents: [{ ref: 'a) [evil](https://evil.test) (b\n"c"', name: 'n' }],
      nextSteps: [],
    });
    const html = renderMarkdown(body);
    expect(html).not.toContain('evil.test"');
    expect((html.match(/<a /g) ?? []).length).toBeLessThanOrEqual(1);
    expect(readChatSummary(body)?.documents[0]?.ref).toBe('a) [evil](https://evil.test) (b "c"');
  });

  it('breaks a web address glued to a word, so it never autolinks (security review)', () => {
    const fields = {
      objective: 'see foo_https://evil.example/x and 1https://e2.example and a_www.e3.example',
      outcome: 'o',
      figures: [],
      documents: [],
      nextSteps: [],
    };
    const body = composeChatSummary(fields);
    expect(renderMarkdown(body)).not.toContain('<a ');
    expect(readChatSummary(body)?.objective).toBe(fields.objective);
  });

  it('fits UPDATE_SUMMARY_MAX at maximal fields, cutting the lowest-priority sections', () => {
    const nasty = (n: number) => '[*'.repeat(n / 2);
    const body = composeChatSummary({
      objective: nasty(CHAT_OBJECTIVE_MAX),
      outcome: nasty(CHAT_OUTCOME_MAX),
      figures: Array.from({ length: CHAT_FIGURES_MAX }, () => nasty(CHAT_FIGURE_MAX)),
      documents: Array.from({ length: CHAT_DOCUMENTS_MAX }, (_, i) => ({
        ref: `https://example.test/${'a'.repeat(300)}${i}`,
        name: nasty(CHAT_DOC_NAME_MAX),
      })),
      nextSteps: Array.from({ length: CHAT_NEXT_STEPS_MAX }, () => nasty(CHAT_NEXT_STEP_MAX)),
    });
    expect(body.length).toBeLessThanOrEqual(UPDATE_SUMMARY_MAX);
    const back = readChatSummary(body);
    expect(back?.objective.length).toBe(CHAT_OBJECTIVE_MAX);
    expect(back?.documents.length ?? 0).toBeLessThan(CHAT_DOCUMENTS_MAX);
  });
});

describe('normaliseChatSummaryFields', () => {
  it('trims and cuts to the contract limits', () => {
    const n = normaliseChatSummaryFields({
      objective: ` ${'a'.repeat(900)} `,
      outcome: 'b'.repeat(2000),
      figures: Array.from({ length: 20 }, () => 'f'.repeat(300)),
      documents: Array.from({ length: 20 }, () => ({ ref: 'x.md', name: 'n'.repeat(300) })),
      nextSteps: Array.from({ length: 20 }, () => 's'.repeat(300)),
    });
    expect(n.objective).toHaveLength(CHAT_OBJECTIVE_MAX);
    expect(n.outcome).toHaveLength(CHAT_OUTCOME_MAX);
    expect(n.figures).toHaveLength(CHAT_FIGURES_MAX);
    expect(n.figures[0]).toHaveLength(CHAT_FIGURE_MAX);
    expect(n.documents).toHaveLength(CHAT_DOCUMENTS_MAX);
    expect(n.documents[0]?.name).toHaveLength(CHAT_DOC_NAME_MAX);
    expect(n.nextSteps).toHaveLength(CHAT_NEXT_STEPS_MAX);
    expect(n.nextSteps[0]).toHaveLength(CHAT_NEXT_STEP_MAX);
  });
});

describe('readChatSummary', () => {
  it('returns null for a body that is not the layout', () => {
    expect(readChatSummary('Just a note')).toBeNull();
    expect(readChatSummary('')).toBeNull();
    expect(readChatSummary('**Outcome:** x\n\n**Objective:** y')).toBeNull();
    expect(readChatSummary('**Objective:** x\n\nstray paragraph')).toBeNull();
    expect(readChatSummary('**Objective:** x\n\n**Documents:**\n- not a link')).toBeNull();
  });
});

describe('writableChatTitle', () => {
  it('swaps quote marks only when a title holds both kinds (or a backslash with an apostrophe)', () => {
    expect(writableChatTitle(`Plan: Alex's "big" launch`)).toBe(`Plan: Alex's 'big' launch`);
    expect(writableChatTitle(`"Hero" copy for Alex's site`)).toBe(`'Hero' copy for Alex's site`);
    expect(writableChatTitle(`C:\\files for Sam's call`)).toBe(`C:/files for Sam's call`);
    expect(writableChatTitle('Plan: the "big" launch')).toBe('Plan: the "big" launch');
    expect(writableChatTitle("Alex's\n  launch")).toBe("Alex's launch");
  });
});
