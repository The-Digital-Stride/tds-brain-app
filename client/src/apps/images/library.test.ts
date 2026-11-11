import { describe, expect, it } from 'vitest';
import { dateWords, groupByFolder, selectionWords, sizeWords } from '../shared/words.ts';
import { FOLDERS, type LibraryImage } from './data.ts';
import { chatDraft, countWords, filterImages, metaWords, summaryWords } from './library.ts';

const image = (over: Partial<LibraryImage>): LibraryImage => ({
  id: 'a',
  client: 'acme-heating',
  folder: 'Brand',
  kind: 'logo',
  name: 'acme-logo.png',
  path: 'clients/acme-heating/context/brand/acme-logo.png',
  width: 1200,
  height: 628,
  bytes: 184_000,
  added: '2026-11-03',
  by: 'Sam Example',
  tags: ['logo', 'navy'],
  usedIn: [],
  art: { scene: 'logo', tone: 'light' },
  ...over,
});

const library = [
  image({ id: 'a' }),
  image({ id: 'b', kind: 'photo', folder: 'Photography', name: 'van-front.jpg', tags: ['van', 'livery'] }),
  image({
    id: 'c',
    kind: 'ad',
    folder: 'Ad creative',
    name: 'boiler-service-square.png',
    tags: ['meta', 'boiler'],
  }),
  image({ id: 'd', client: 'northwind', name: 'northwind-logo.svg', tags: ['logo'] }),
];

describe('filterImages', () => {
  it('keeps one client only', () => {
    const ids = filterImages(library, { client: 'northwind', query: '', kind: 'all' }).map((i) => i.id);
    expect(ids).toEqual(['d']);
  });

  it('narrows by type', () => {
    const ids = filterImages(library, { client: 'acme-heating', query: '', kind: 'photo' }).map((i) => i.id);
    expect(ids).toEqual(['b']);
  });

  it('matches every word of the search in the name, tags or folder, whatever the case', () => {
    const find = (query: string) =>
      filterImages(library, { client: 'acme-heating', query, kind: 'all' }).map((i) => i.id);
    expect(find('VAN')).toEqual(['b']);
    expect(find('boiler meta')).toEqual(['c']);
    expect(find('photography')).toEqual(['b']);
    expect(find('boiler van')).toEqual([]);
    expect(find('   ')).toEqual(['a', 'b', 'c']);
  });
});

describe('groupByFolder', () => {
  it('groups in the library order and leaves empty folders out', () => {
    const groups = groupByFolder(
      [library[2], library[0], library[1]].filter((i) => i !== undefined),
      FOLDERS,
    );
    expect(groups.map((g) => g.folder)).toEqual(['Brand', 'Photography', 'Ad creative']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['a']);
  });

  it('puts a folder it does not know last', () => {
    const groups = groupByFolder([image({ id: 'x', folder: 'Misc' }), image({ id: 'a' })], FOLDERS);
    expect(groups.map((g) => g.folder)).toEqual(['Brand', 'Misc']);
  });
});

describe('words', () => {
  it('writes sizes in KB below a megabyte and MB above', () => {
    expect(sizeWords(900)).toBe('1 KB');
    expect(sizeWords(184_000)).toBe('184 KB');
    expect(sizeWords(2_400_000)).toBe('2.4 MB');
    expect(sizeWords(999_400)).toBe('999 KB');
    expect(sizeWords(999_500)).toBe('1.0 MB');
  });

  it('writes a date the UK way', () => {
    expect(dateWords('2026-11-03')).toBe('3 Nov 2026');
  });

  it('summarises a list', () => {
    expect(summaryWords([])).toBe('No images');
    expect(summaryWords([image({})])).toBe('1 image, 184 KB');
    expect(summaryWords([image({}), image({ bytes: 1_016_000 })])).toBe('2 images, 1.2 MB');
  });

  it('counts the selection, and says when the filter is hiding some of it', () => {
    expect(countWords(1)).toBe('1 image');
    expect(selectionWords(countWords(1), 0)).toBe('1 image selected');
    expect(selectionWords(countWords(3), 0)).toBe('3 images selected');
    expect(selectionWords(countWords(3), 2)).toBe('3 images selected, 2 hidden by the filter');
  });

  it('writes a row meta line in lower case, joined by commas', () => {
    expect(metaWords(image({}))).toBe('logo, 1200 × 628, 184 KB');
    expect(metaWords(image({ kind: 'ad' }))).toBe('ad creative, 1200 × 628, 184 KB');
  });

  it('drafts a chat message that names each file by its path', () => {
    expect(chatDraft([image({})])).toBe(
      'Help me with this image: clients/acme-heating/context/brand/acme-logo.png',
    );
    expect(chatDraft([image({}), image({ path: 'clients/acme-heating/created/b.png' })])).toBe(
      'Help me with these 2 images:\n- clients/acme-heating/context/brand/acme-logo.png\n- clients/acme-heating/created/b.png',
    );
  });
});
