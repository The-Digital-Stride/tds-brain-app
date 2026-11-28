import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyLine, createTranscriptReader, MSG_NO_HISTORY, projectDirName } from './transcript-times.ts';

// Synthetic lines with the shape of Claude Code's jsonl (keys and enum values only; no real text).
const TS = '2026-11-20T10:00:00.000Z';
const base = {
  parentUuid: null,
  isSidechain: false,
  userType: 'external',
  cwd: '/x',
  sessionId: 's',
  version: '2',
};
const user = (content: unknown, over: Record<string, unknown> = {}) => ({
  ...base,
  type: 'user',
  message: { role: 'user', content },
  uuid: 'u',
  timestamp: TS,
  ...over,
});
const assistant = (over: Record<string, unknown> = {}) => ({
  ...base,
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'SECRET-ANSWER' }] },
  uuid: 'a',
  timestamp: TS,
  ...over,
});

describe('classifyLine: person turns', () => {
  it('a typed prompt, an SDK prompt and older lines with no promptSource are prompts', () => {
    expect(classifyLine(user('SECRET', { promptSource: 'typed', turnOrigin: 'human' }))).toBe('prompt');
    expect(classifyLine(user('SECRET', { promptSource: 'queued', turnOrigin: 'human' }))).toBe('prompt');
    expect(classifyLine(user('SECRET', { promptSource: 'suggestion_accepted', turnOrigin: 'human' }))).toBe(
      'prompt',
    );
    expect(classifyLine(user('SECRET', { promptSource: 'sdk', turnOrigin: 'sdk' }))).toBe('prompt');
    expect(
      classifyLine(user('SECRET', { promptSource: 'sdk', turnOrigin: 'human', origin: { kind: 'human' } })),
    ).toBe('prompt');
    expect(classifyLine(user('SECRET'))).toBe('prompt');
    expect(classifyLine(user([{ type: 'text', text: 'SECRET' }]))).toBe('prompt');
  });
  it('an image-only prompt is a prompt', () => {
    expect(classifyLine(user([{ type: 'image', source: {} }]))).toBe('prompt');
  });
  it('slash commands, shell input, pasted content and attachments are person turns', () => {
    expect(classifyLine(user('<command-message>x</command-message>\n<command-name>/x</command-name>'))).toBe(
      'prompt',
    );
    expect(classifyLine(user('<command-name>/gm</command-name>'))).toBe('prompt');
    expect(classifyLine(user('<bash-input>ls</bash-input>'))).toBe('prompt');
    expect(
      classifyLine(
        user('<tds-attachments>…</tds-attachments> SECRET', { promptSource: 'sdk', turnOrigin: 'sdk' }),
      ),
    ).toBe('prompt');
    expect(
      classifyLine(
        user('<pasted_content>…</pasted_content>', { promptSource: 'typed', turnOrigin: 'human' }),
      ),
    ).toBe('prompt');
  });
  it('a typed prompt is trusted whatever it starts with', () => {
    expect(classifyLine(user('<div>SECRET', { promptSource: 'typed', turnOrigin: 'human' }))).toBe('prompt');
  });
});

describe('classifyLine: not person turns', () => {
  it('tool results', () => {
    expect(
      classifyLine(
        user([{ type: 'tool_result', tool_use_id: 't', content: 'SECRET' }], { toolUseResult: {} }),
      ),
    ).toBeNull();
    expect(classifyLine(user([{ type: 'tool_result', tool_use_id: 't', content: 'x' }]))).toBeNull();
    expect(classifyLine(user('x', { toolUseResult: 'x' }))).toBeNull();
  });
  it('meta lines, compaction summaries and sidechains', () => {
    expect(classifyLine(user('SECRET', { isMeta: true }))).toBeNull();
    expect(
      classifyLine(user('SECRET', { isCompactSummary: true, isVisibleInTranscriptOnly: true })),
    ).toBeNull();
    expect(
      classifyLine(user('This session is being continued from a previous conversation that ran out')),
    ).toBeNull();
    expect(classifyLine(user('SECRET', { isSidechain: true }))).toBeNull();
    expect(classifyLine(assistant({ isSidechain: true }))).toBeNull();
  });
  it('machine-made turns: task notifications, peers and system sources', () => {
    expect(
      classifyLine(
        user('<task-notification>x</task-notification>', {
          promptSource: 'system',
          turnOrigin: 'task_notification',
          origin: { kind: 'task-notification', producer: 'x', runId: 'y' },
        }),
      ),
    ).toBeNull();
    expect(classifyLine(user('x', { promptSource: 'system' }))).toBeNull();
    expect(classifyLine(user('x', { turnOrigin: 'peer', origin: { kind: 'peer' } }))).toBeNull();
    expect(classifyLine(user('x', { turnOrigin: 'task_notification' }))).toBeNull();
    expect(classifyLine(user('x', { origin: { kind: 'peer' } }))).toBeNull();
    expect(classifyLine(user('x', { promptSource: 'something-new' }))).toBeNull();
  });
  it('tag-led notices and interruptions', () => {
    expect(classifyLine(user('<local-command-stdout>x</local-command-stdout>'))).toBeNull();
    expect(classifyLine(user('<bash-stdout>x</bash-stdout>'))).toBeNull();
    expect(classifyLine(user('<task-notification>x</task-notification>'))).toBeNull();
    expect(classifyLine(user('  <system-reminder>x</system-reminder>'))).toBeNull();
    expect(classifyLine(user([{ type: 'text', text: '[Request interrupted by user]' }]))).toBeNull();
    expect(classifyLine(user(''))).toBeNull();
    expect(classifyLine(user(42))).toBeNull();
  });
  it('other line types and bad timestamps', () => {
    expect(classifyLine({ type: 'attachment', timestamp: TS })).toBeNull();
    expect(classifyLine({ type: 'system', timestamp: TS })).toBeNull();
    expect(classifyLine({ type: 'ai-title' })).toBeNull();
    expect(classifyLine(user('x', { timestamp: 'soon' }))).toBeNull();
    expect(classifyLine(user('x', { timestamp: undefined }))).toBeNull();
    expect(classifyLine(null)).toBeNull();
  });
  it('an assistant line is an answer', () => {
    expect(classifyLine(assistant())).toBe('answer');
  });
});

// ─── The reader ────────────────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'tba-tt-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY = '2026-11-20';
const CHAT = '0b6c2a3e-1111-4111-8111-111111111111';
const CHAT2 = '0b6c2a3e-2222-4222-8222-222222222222';
const at = (hhmm: string, day = DAY) => `${day}T${hhmm}:00.000Z`;
const lines = (...objs: unknown[]) => `${objs.map((o) => JSON.stringify(o)).join('\n')}\n`;
const touch = (file: string, iso: string) => utimesSync(file, new Date(iso), new Date(iso));

function setup() {
  const config = tmp();
  const projectDir = join(config, 'projects', 'brain');
  mkdirSync(projectDir, { recursive: true });
  const env = { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: 'brain' };
  return { config, projectDir, env };
}

describe('transcript reader', () => {
  it('reads top-level chats only and keeps times and kinds, never text', async () => {
    const { projectDir, env } = setup();
    const file = join(projectDir, `${CHAT}.jsonl`);
    writeFileSync(
      file,
      `${lines(
        { type: 'ai-title', aiTitle: 'SECRET TITLE' },
        user('SECRET PROMPT', { timestamp: at('10:00'), promptSource: 'typed', turnOrigin: 'human' }),
        assistant({ timestamp: at('10:01') }),
        user([{ type: 'tool_result', content: 'SECRET TOOL' }], {
          timestamp: at('10:02'),
          toolUseResult: {},
        }),
        assistant({ timestamp: at('10:03') }),
      )}{ broken line\n`,
    );
    touch(file, at('12:00'));
    mkdirSync(join(projectDir, CHAT, 'subagents'), { recursive: true });
    writeFileSync(
      join(projectDir, CHAT, 'subagents', 'agent-x.jsonl'),
      lines(user('x', { timestamp: at('11:00') })),
    );
    writeFileSync(join(projectDir, 'notes.txt'), 'x');
    symlinkSync(file, join(projectDir, `${CHAT2}.jsonl`));

    const read = createTranscriptReader({ env });
    const out = await read('/brain', DAY);
    expect(out.chats).toEqual([
      {
        chatId: CHAT,
        marks: [
          { at: at('10:00'), kind: 'prompt' },
          { at: at('10:01'), kind: 'answer' },
          { at: at('10:03'), kind: 'answer' },
        ],
      },
    ]);
    expect(out.notes).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/SECRET|brain|projects/);
  });

  it('skips files last changed before the day, and keeps marks near the day only', async () => {
    const { projectDir, env } = setup();
    const old = join(projectDir, `${CHAT}.jsonl`);
    writeFileSync(old, lines(user('x', { timestamp: at('10:00', '2026-11-18') })));
    touch(old, at('10:05', '2026-11-18'));
    const recent = join(projectDir, `${CHAT2}.jsonl`);
    writeFileSync(
      recent,
      lines(
        user('x', { timestamp: at('10:00', '2026-11-01') }),
        user('x', { timestamp: at('23:50', '2026-11-19') }),
        user('x', { timestamp: at('09:00') }),
        user('x', { timestamp: at('09:00', '2026-11-22') }),
      ),
    );
    touch(recent, at('09:00', '2026-11-22'));
    const out = await createTranscriptReader({ env })('/brain', DAY);
    expect(out.chats).toEqual([
      {
        chatId: CHAT2,
        marks: [
          { at: at('23:50', '2026-11-19'), kind: 'prompt' },
          { at: at('09:00'), kind: 'prompt' },
        ],
      },
    ]);
  });

  it('skips a file over the size cap and says so', async () => {
    const { projectDir, env } = setup();
    const file = join(projectDir, `${CHAT}.jsonl`);
    writeFileSync(file, lines(user('x'.repeat(500), { timestamp: at('10:00') })));
    touch(file, at('12:00'));
    const out = await createTranscriptReader({ env, maxBytes: 100 })('/brain', DAY);
    expect(out.chats).toEqual([]);
    expect(out.notes).toEqual(["One chat is too large to read, so its time isn't shown."]);
  });

  it('caches marks per file by size and modified time', async () => {
    const { projectDir, env } = setup();
    const file = join(projectDir, `${CHAT}.jsonl`);
    const v1 = lines(user('aa', { timestamp: at('10:00') }));
    writeFileSync(file, v1);
    touch(file, at('12:00'));
    const read = createTranscriptReader({ env });
    expect((await read('/brain', DAY)).chats[0]?.marks).toHaveLength(1);
    // Same size and time: the cached marks stand (the file isn't read again).
    writeFileSync(file, v1.replace('10:00', '11:00'));
    touch(file, at('12:00'));
    expect((await read('/brain', DAY)).chats[0]?.marks[0]?.at).toBe(at('10:00'));
    // A changed size reads it again.
    writeFileSync(file, lines(user('aa', { timestamp: at('11:00') }), assistant({ timestamp: at('11:01') })));
    touch(file, at('12:00'));
    expect((await read('/brain', DAY)).chats[0]?.marks).toEqual([
      { at: at('11:00'), kind: 'prompt' },
      { at: at('11:01'), kind: 'answer' },
    ]);
  });

  it('says no chat history is kept this far back when nothing is as old as the day', async () => {
    const { projectDir, env } = setup();
    const file = join(projectDir, `${CHAT}.jsonl`);
    writeFileSync(file, lines(user('x', { timestamp: at('10:00', '2026-11-25') })));
    touch(file, at('10:05', '2026-11-25'));
    const out = await createTranscriptReader({ env })('/brain', '2026-10-01');
    expect(out).toEqual({ chats: [], notes: [MSG_NO_HISTORY] });
    // History older than the day exists: an empty day is just empty.
    const older = join(projectDir, `${CHAT2}.jsonl`);
    writeFileSync(older, lines(user('x', { timestamp: at('10:00', '2026-09-20') })));
    touch(older, at('10:05', '2026-09-20'));
    expect(await createTranscriptReader({ env })('/brain', '2026-10-01')).toEqual({ chats: [], notes: [] });
  });

  it('a missing folder or a bad folder name reads as nothing', async () => {
    const config = tmp();
    expect(
      await createTranscriptReader({
        env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: 'none' },
      })('/b', DAY),
    ).toEqual({ chats: [], notes: [] });
    expect(
      await createTranscriptReader({
        env: { CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_PROJECT_DIR_NAME: '../x' },
      })('/b', DAY),
    ).toEqual({ chats: [], notes: [] });
  });

  it('finds the folder from the brain path the way Claude Code names it', async () => {
    const config = tmp();
    const brain = tmp();
    const projectDir = join(config, 'projects', projectDirName(brain));
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, `${CHAT}.jsonl`);
    writeFileSync(file, lines(user('x', { timestamp: at('10:00') })));
    touch(file, at('12:00'));
    const out = await createTranscriptReader({ configDir: config, env: {}, realpath: async (p) => p })(
      brain,
      DAY,
    );
    expect(out.chats.map((c) => c.chatId)).toEqual([CHAT]);
    expect(projectDirName('/Users/x/agency brain')).toBe('-Users-x-agency-brain');
  });
});
