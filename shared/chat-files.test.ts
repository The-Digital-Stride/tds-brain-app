import { describe, expect, it } from 'vitest';
import {
  CHAT_FILE_HREF_PREFIX,
  chatFileFor,
  chatFileGroup,
  findPathMentions,
  findWebLinks,
  indexChatFiles,
  normaliseBrainPath,
} from './chat-files.ts';
import type { ChatFile, ChatFileAction } from './contract.ts';

const ROOT = '/Users/me/brain';
const n = (raw: string, root = ROOT) => normaliseBrainPath(raw, root);

describe('normaliseBrainPath', () => {
  it('makes absolute paths inside the root relative', () => {
    expect(n('/Users/me/brain/clients/acme/brief.md')).toBe('clients/acme/brief.md');
    expect(n('/Users/me/brain/clients/acme/brief.md', '/Users/me/brain/')).toBe('clients/acme/brief.md');
  });
  it('rejects absolute paths outside the root, including look-alike siblings', () => {
    expect(n('/etc/passwd')).toBeNull();
    expect(n('/Users/me/brain-other/x.md')).toBeNull();
    expect(n('/Users/me/brain')).toBeNull();
  });
  it('rejects .. anywhere, ~, schemes and empty input', () => {
    expect(n('../x.md')).toBeNull();
    expect(n('clients/../../x.md')).toBeNull();
    expect(n('clients/%2e%2e/x.md')).toBeNull();
    expect(n('/Users/me/brain/clients/../x.md')).toBeNull();
    expect(n('~/x.md')).toBeNull();
    expect(n('file:///Users/me/brain/x.md')).toBeNull();
    expect(n('https://example.com/x.md')).toBeNull();
    expect(n('')).toBeNull();
    expect(n('   ')).toBeNull();
    expect(n('#frag')).toBeNull();
  });
  it('tidies relative paths', () => {
    expect(n('./clients/x.md')).toBe('clients/x.md');
    expect(n('clients/x.md')).toBe('clients/x.md');
    expect(n('clients//x/')).toBe('clients/x');
    expect(n('clients/a b/c.md')).toBe('clients/a b/c.md');
    expect(n('clients/a%20b/c.md')).toBe('clients/a b/c.md');
    expect(n('clients/100%/c.md')).toBe('clients/100%/c.md');
  });
  it('removes wrapping backticks, quotes and angle brackets', () => {
    expect(n('`clients/x.md`')).toBe('clients/x.md');
    expect(n('<clients/x.md>')).toBe('clients/x.md');
    expect(n('"clients/x.md"')).toBe('clients/x.md');
    expect(n("'clients/x.md'")).toBe('clients/x.md');
  });
  it('drops line references, fragments and queries', () => {
    expect(n('clients/x.md:12')).toBe('clients/x.md');
    expect(n('clients/x.md:12-30')).toBe('clients/x.md');
    expect(n('clients/x.md#section')).toBe('clients/x.md');
    expect(n('clients/x.md?q=1')).toBe('clients/x.md');
    expect(n('clients/x.md#L10:5')).toBe('clients/x.md');
  });
});

describe('findPathMentions', () => {
  it('finds markdown link targets that are not web addresses', () => {
    const t = 'See [brief](clients/acme/brief.md) and [site](https://example.com/a.md) and [top](#top).';
    expect(findPathMentions(t)).toEqual(['clients/acme/brief.md']);
  });
  it('finds inline code spans', () => {
    expect(findPathMentions('I wrote `personal/notes.md` for you')).toEqual(['personal/notes.md']);
  });
  it('finds bare paths and strips trailing punctuation', () => {
    expect(findPathMentions('Saved to clients/acme/brief.md. Also (personal/a/b.txt), done')).toEqual([
      'clients/acme/brief.md',
      'personal/a/b.txt',
    ]);
    expect(findPathMentions('Open /Users/me/brain/clients/acme/x.pdf!')).toEqual([
      '/Users/me/brain/clients/acme/x.pdf',
    ]);
  });
  it('ignores bare words without an extension or a known start', () => {
    expect(findPathMentions('the clients/ folder and notes/x.md and myclients/x.md')).toEqual([]);
  });
  it('skips fenced code blocks', () => {
    const t = 'Before\n```\ncat clients/acme/in-fence.md\n`personal/also.md`\n```\nAfter clients/acme/out.md';
    expect(findPathMentions(t)).toEqual(['clients/acme/out.md']);
  });
  it('dedupes, keeps order of first appearance and caps at 200', () => {
    expect(findPathMentions('clients/a.md `clients/b.md` clients/a.md [x](clients/b.md)')).toEqual([
      'clients/a.md',
      'clients/b.md',
    ]);
    const many = Array.from({ length: 300 }, (_, i) => `clients/f${i}.md`).join(' ');
    expect(findPathMentions(many)).toHaveLength(200);
  });
});

describe('findPathMentions on hostile text', () => {
  it('stays fast on crafted input', () => {
    const t0 = performance.now();
    findPathMentions('/('.repeat(50000));
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe('findWebLinks', () => {
  it('finds markdown targets and bare addresses, http(s) only', () => {
    const t = 'Go [here](https://a.com/x) or http://b.com/y or ftp://c.com or mailto:a@b.com';
    expect(findWebLinks(t)).toEqual(['https://a.com/x', 'http://b.com/y']);
  });
  it('trims trailing punctuation but keeps balanced parentheses', () => {
    expect(findWebLinks('See https://a.com/x, and https://a.com/y.')).toEqual([
      'https://a.com/x',
      'https://a.com/y',
    ]);
    expect(findWebLinks('(https://a.com/z)')).toEqual(['https://a.com/z']);
    expect(findWebLinks('https://en.wikipedia.org/wiki/Foo_(bar).')).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
    expect(findWebLinks('<https://a.com/q>?')).toEqual(['https://a.com/q']);
  });
  it('dedupes, skips fenced code and caps at 100', () => {
    expect(findWebLinks('https://a.com https://a.com\n```\nhttps://in.fence\n```')).toEqual([
      'https://a.com',
    ]);
    const many = Array.from({ length: 150 }, (_, i) => `https://a.com/${i}`).join(' ');
    expect(findWebLinks(many)).toHaveLength(100);
  });
});

const file = (key: string, path: string, actions: ChatFileAction[], toolUseIds: string[] = []): ChatFile => ({
  key,
  path,
  item: null,
  scope: { id: 'personal', name: 'Personal', kind: 'personal' },
  actions,
  toolUseIds,
  edits: 0,
  order: 1,
});

describe('chatFileGroup', () => {
  it('picks made, then attached, then mentioned, then looked-at', () => {
    expect(chatFileGroup(file('a', 'a', ['read', 'created']))).toBe('made');
    expect(chatFileGroup(file('a', 'a', ['changed', 'filed']))).toBe('made');
    expect(chatFileGroup(file('a', 'a', ['read', 'filed']))).toBe('attached');
    expect(chatFileGroup(file('a', 'a', ['read', 'mentioned']))).toBe('mentioned');
    expect(chatFileGroup(file('a', 'a', ['read']))).toBe('looked-at');
    expect(chatFileGroup(file('a', 'a', []))).toBe('looked-at');
  });
});

describe('indexChatFiles', () => {
  it('maps normalised paths and tool use ids to keys', () => {
    const idx = indexChatFiles([
      file('k1', 'clients/a.md', ['read'], ['t1', 't2']),
      file('k2', 'personal/b.md', ['created'], ['t3']),
    ]);
    expect(idx.byPath.get('clients/a.md')).toBe('k1');
    expect(idx.byPath.get('personal/b.md')).toBe('k2');
    expect(idx.byToolUse.get('t2')).toBe('k1');
    expect(idx.byToolUse.get('t3')).toBe('k2');
  });
});

describe('chatFileFor', () => {
  const idx = indexChatFiles([
    file('k1', 'clients/weightmans/context/business.md', ['changed'], []),
    file('k2', 'clients/weightmans/profile.md', ['read'], []),
    file('k3', 'clients/acme/profile.md', ['read'], []),
    file('k4', 'personal/notes/plan.md', ['created'], []),
  ]);
  const f = (raw: string) => chatFileFor(idx, raw, ROOT);

  it('matches a full path exactly, as before', () => {
    expect(f('clients/weightmans/profile.md')).toBe('k2');
    expect(f('/Users/me/brain/personal/notes/plan.md')).toBe('k4');
  });

  it('links a path written without clients/ when it ends exactly one of the chat files', () => {
    expect(f('weightmans/context/business.md')).toBe('k1');
    expect(f('`context/business.md`')).toBe('k1');
    expect(f('notes/plan.md')).toBe('k4');
  });

  it('links nothing when the short path fits more than one file, or none', () => {
    expect(f('profile.md')).toBeNull();
    expect(f('acme/profile.md')).toBe('k3');
    expect(f('weightmans/brief.md')).toBeNull();
  });

  it('matches whole folder names only, never part of one', () => {
    expect(f('mans/profile.md')).toBeNull();
    expect(f('ess.md')).toBeNull();
  });

  it('never guesses for a path that already names a scope', () => {
    expect(f('clients/other/context/business.md')).toBeNull();
    expect(f('personal/plan.md')).toBeNull();
  });
});

describe('CHAT_FILE_HREF_PREFIX', () => {
  it('is the fragment prefix', () => {
    expect(CHAT_FILE_HREF_PREFIX).toBe('#chat-file=');
  });
});
