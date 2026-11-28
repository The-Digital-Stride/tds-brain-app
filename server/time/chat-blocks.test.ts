import { describe, expect, it } from 'vitest';
import {
  CHAT_TIME,
  type ChatBlock,
  type ChatBlocksFn,
  type ChatInput,
  type TranscriptMark,
} from '../../shared/time-contract.ts';
import { chatBlocks } from './chat-blocks.ts';

// It fits the contract's seam.
chatBlocks satisfies ChatBlocksFn;

// Winter day (GMT = UTC) unless a test says otherwise.
const DAY = '2026-11-20';
const t = (hhmm: string, day = DAY) => `${day}T${hhmm.length === 5 ? `${hhmm}:00` : hhmm}.000Z`;
const p = (hhmm: string, day?: string): TranscriptMark => ({ at: t(hhmm, day), kind: 'prompt' });
const a = (hhmm: string, day?: string): TranscriptMark => ({ at: t(hhmm, day), kind: 'answer' });

function chat(chatId: string, marks: TranscriptMark[], over: Partial<ChatInput> = {}): ChatInput {
  return { chatId, marks, place: { client: 'acme', project: null }, personal: false, ...over };
}

const span = (b: ChatBlock) => `${b.chatId} ${b.startAt.slice(11, 16)}-${b.endAt.slice(11, 16)} ${b.minutes}`;

describe('chatBlocks: one prompt', () => {
  it('counts the allowance before the prompt and after the last answer', () => {
    const [b] = chatBlocks([chat('c1', [p('10:00'), a('10:01')])], DAY);
    expect(b).toEqual({
      chatId: 'c1',
      captureKey: 'c1@2026-11-20T09:58:00.000Z',
      workDate: DAY,
      startAt: t('09:58'),
      endAt: t('10:03'),
      minutes: 5,
      claudeMinutes: 1,
      prompts: 1,
    });
  });

  it('a prompt with no answer gets the tail after the prompt', () => {
    expect(chatBlocks([chat('c1', [p('10:00')])], DAY).map(span)).toEqual(['c1 09:58-10:02 4']);
  });

  it('a long Claude run is capped at maxRun after the prompt; the whole run inside stays as evidence', () => {
    const [b] = chatBlocks([chat('c1', [p('10:00'), a('10:05'), a('10:30')])], DAY);
    expect(span(b as ChatBlock)).toBe('c1 09:58-10:10 12');
    expect(b?.claudeMinutes).toBe(10);
  });

  it('rounds the edges to whole minutes', () => {
    expect(chatBlocks([chat('c1', [p('10:00:40')])], DAY).map(span)).toEqual(['c1 09:59-10:03 4']);
  });

  it('ignores answers before the first prompt, bad timestamps and unsorted input', () => {
    const marks: TranscriptMark[] = [a('10:01'), { at: 'nonsense', kind: 'prompt' }, a('09:00'), p('10:00')];
    expect(chatBlocks([chat('c1', marks)], DAY).map(span)).toEqual(['c1 09:58-10:03 5']);
  });
});

describe('chatBlocks: merging within a chat', () => {
  it('merges intervals less than 10 minutes apart into one block', () => {
    // 09:58-10:02 and 10:11-10:15: a 9-minute gap.
    const out = chatBlocks([chat('c1', [p('10:00'), p('10:13')])], DAY);
    expect(out.map(span)).toEqual(['c1 09:58-10:15 17']);
    expect(out[0]?.prompts).toBe(2);
  });

  it('a gap of exactly 10 minutes or more makes two blocks', () => {
    expect(chatBlocks([chat('c1', [p('10:00'), p('10:14')])], DAY).map(span)).toEqual([
      'c1 09:58-10:02 4',
      'c1 10:12-10:16 4',
    ]);
  });

  it('a run of quick prompts stays one block', () => {
    const marks = [p('10:00'), a('10:01'), p('10:03'), a('10:04'), p('10:06'), a('10:09')];
    const [b] = chatBlocks([chat('c1', marks)], DAY);
    expect(span(b as ChatBlock)).toBe('c1 09:58-10:11 13');
    expect(b?.claudeMinutes).toBe(5);
    expect(b?.prompts).toBe(3);
  });
});

describe('chatBlocks: overlaps', () => {
  it('counts overlapping time once: each minute goes to the latest prompt', () => {
    const out = chatBlocks([chat('A', [p('10:00'), a('10:08')]), chat('B', [p('10:05'), a('10:06')])], DAY);
    // A 09:58-10:10, B 10:03-10:08 (its lead starts when it is written).
    expect(out.map(span)).toEqual(['A 09:58-10:03 5', 'B 10:03-10:08 5', 'A 10:08-10:10 2']);
    expect(out.reduce((s, b) => s + b.minutes, 0)).toBe(12);
  });

  it("a personal chat's overlap is taken from the client chat and then dropped", () => {
    const out = chatBlocks(
      [
        chat('A', [p('10:00'), a('10:08')]),
        chat('B', [p('10:05'), a('10:06')], { personal: true, place: null }),
      ],
      DAY,
    );
    expect(out.map(span)).toEqual(['A 09:58-10:03 5', 'A 10:08-10:10 2']);
  });

  it('a personal chat alone makes no blocks', () => {
    expect(chatBlocks([chat('P', [p('10:00')], { personal: true })], DAY)).toEqual([]);
  });

  it('ties go to a chat with a place, then the lower chat id, whatever the input order', () => {
    const x = chat('x', [p('10:00')], { place: null });
    const y = chat('y', [p('10:00')]);
    expect(chatBlocks([x, y], DAY).map(span)).toEqual(['y 09:58-10:02 4']);
    expect(chatBlocks([y, x], DAY).map(span)).toEqual(['y 09:58-10:02 4']);
    const m = chat('m', [p('10:00')]);
    const n = chat('n', [p('10:00')]);
    expect(chatBlocks([n, m], DAY).map(span)).toEqual(['m 09:58-10:02 4']);
    expect(chatBlocks([m, n], DAY).map(span)).toEqual(['m 09:58-10:02 4']);
  });

  it('a place with neither client nor project counts as no place', () => {
    const x = chat('a', [p('10:00')], { place: { client: null, project: null } });
    const y = chat('b', [p('10:00')]);
    expect(chatBlocks([x, y], DAY).map(span)).toEqual(['b 09:58-10:02 4']);
  });

  it('marks for one chat given twice are joined', () => {
    const out = chatBlocks([chat('c1', [p('10:00')]), chat('c1', [p('10:05')])], DAY);
    expect(out.map(span)).toEqual(['c1 09:58-10:07 9']);
  });
});

describe('chatBlocks: days', () => {
  it('splits at London midnight in winter', () => {
    const marks = [p('23:55', '2026-11-20'), a('00:03', '2026-11-21')];
    expect(chatBlocks([chat('c1', marks)], '2026-11-20').map(span)).toEqual(['c1 23:53-00:00 7']);
    const next = chatBlocks([chat('c1', marks)], '2026-11-21');
    expect(next.map(span)).toEqual(['c1 00:00-00:05 5']);
    expect(next[0]?.workDate).toBe('2026-11-21');
    expect(next[0]?.prompts).toBe(0);
  });

  it('uses BST in summer: 00:30 London is 23:30 UTC the day before', () => {
    const marks = [p('23:30', '2026-06-30')];
    expect(chatBlocks([chat('c1', marks)], '2026-07-01').map(span)).toEqual(['c1 23:28-23:32 4']);
    expect(chatBlocks([chat('c1', marks)], '2026-06-30')).toEqual([]);
    // Split at 23:00 UTC = London midnight.
    const late = [p('22:58', '2026-06-30')];
    expect(chatBlocks([chat('c1', late)], '2026-06-30').map(span)).toEqual(['c1 22:56-23:00 4']);
    expect(chatBlocks([chat('c1', late)], '2026-07-01')).toEqual([]);
  });

  it('handles the spring change day (23 hours)', () => {
    const marks = [p('00:30', '2026-03-29'), p('23:30', '2026-03-29')];
    // 00:30 UTC is 00:30 GMT on the 29th; 23:30 UTC is 00:30 BST on the 30th.
    expect(chatBlocks([chat('c1', marks)], '2026-03-29').map(span)).toEqual(['c1 00:28-00:32 4']);
    expect(chatBlocks([chat('c1', marks)], '2026-03-30').map(span)).toEqual(['c1 23:28-23:32 4']);
  });

  it('handles the autumn change day (25 hours)', () => {
    const marks = [p('23:30', '2026-10-24'), p('23:30', '2026-10-25')];
    // 23:30 UTC on the 24th is 00:30 BST on the 25th; 23:30 UTC on the 25th is 23:30 GMT on the 25th.
    expect(chatBlocks([chat('c1', marks)], '2026-10-25').map(span)).toEqual([
      'c1 23:28-23:32 4',
      'c1 23:28-23:32 4',
    ]);
    expect(chatBlocks([chat('c1', marks)], '2026-10-24')).toEqual([]);
  });

  it('a prompt just before midnight gives the next day its tail', () => {
    expect(chatBlocks([chat('c1', [p('23:59', '2026-11-19')])], DAY).map(span)).toEqual(['c1 00:00-00:01 1']);
  });

  it('a bad work date gives nothing', () => {
    expect(chatBlocks([chat('c1', [p('10:00')])], '2026-11-31')).toEqual([]);
  });
});

describe('chatBlocks: short blocks', () => {
  it('drops blocks shorter than minBlockMinutes', () => {
    const rules = { ...CHAT_TIME, minBlockMinutes: 5 };
    const out = chatBlocks(
      [chat('A', [p('10:00'), a('10:08')]), chat('B', [p('10:05'), a('10:06')])],
      DAY,
      rules,
    );
    expect(out.map(span)).toEqual(['A 09:58-10:03 5', 'B 10:03-10:08 5']);
  });
});
