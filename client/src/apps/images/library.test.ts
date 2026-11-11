import { describe, expect, it } from 'vitest';
import { item } from '../shared/testing.ts';
import { chatDraft, countWords, filterImages, metaWords, summaryWords, tileWords } from './library.ts';

const library = [
  item({ id: 'a' }),
  item({ id: 'b', name: 'van-front.jpg', title: 'van front', ext: 'jpg', group: 'Photography' }),
  item({ id: 'c', name: 'boiler-service-square.png', title: 'boiler service square', group: 'Ad builds' }),
];

describe('filterImages', () => {
  it('matches every word of the search in the name, title or card, whatever the case', () => {
    const find = (query: string) => filterImages(library, query).map((i) => i.id);
    expect(find('VAN')).toEqual(['b']);
    expect(find('boiler ad')).toEqual(['c']);
    expect(find('photography')).toEqual(['b']);
    expect(find('boiler van')).toEqual([]);
    expect(find('   ')).toEqual(['a', 'b', 'c']);
  });
});

describe('words', () => {
  it('summarises a list with its total size', () => {
    expect(summaryWords([])).toBe('No images');
    expect(summaryWords([item()])).toBe('1 image, 184 KB');
    expect(summaryWords([item(), item({ bytes: 18_500_000 })])).toBe('2 images, 18.7 MB');
    expect(countWords(24)).toBe('24 images');
  });

  it('a tile shows the dimensions when known, else the file size', () => {
    expect(tileWords(item())).toBe('1200 × 628');
    expect(tileWords(item({ width: null, height: null }))).toBe('184 KB');
  });

  it('a row shows the type, the dimensions when known, and the size', () => {
    expect(metaWords(item())).toBe('PNG, 1200 × 628, 184 KB');
    expect(metaWords(item({ ext: 'svg', width: null, height: null }))).toBe('SVG, 184 KB');
  });

  it('drafts a chat message that names each file by its path', () => {
    expect(chatDraft([item()])).toBe('Help me with this image: clients/acme/context/brand/acme-logo.png');
    expect(chatDraft([item(), item({ path: 'clients/acme/created/b.png' })])).toBe(
      'Help me with these 2 images:\n- clients/acme/context/brand/acme-logo.png\n- clients/acme/created/b.png',
    );
  });
});
