import type { LibraryItem } from '../../../../shared/contract.ts';
import { pictureWords } from '../shared/library.ts';
import { matchesWords, plural, sizeWords } from '../shared/words.ts';

/** The images that match every word of the search (name, title or card), whatever the case. */
export function filterImages(images: LibraryItem[], query: string): LibraryItem[] {
  return images.filter((i) => matchesWords(`${i.title} ${i.name} ${i.group}`, query));
}

/** "1 image", "24 images". */
export function countWords(n: number): string {
  return plural(n, 'image', 'images');
}

/** "No images", "1 image, 184 KB", "24 images, 18.7 MB". */
export function summaryWords(images: LibraryItem[]): string {
  if (images.length === 0) return 'No images';
  const size = sizeWords(images.reduce((sum, i) => sum + i.bytes, 0));
  return `${countWords(images.length)}, ${size}`;
}

/** A tile's meta line: "1200 × 628" when the size is known, else the file size. */
export function tileWords(image: LibraryItem): string {
  return pictureWords(image) ?? sizeWords(image.bytes);
}

/** A row's meta line: "PNG, 1200 × 628, 184 KB", or "PNG, 184 KB" when the size is not known. */
export function metaWords(image: LibraryItem): string {
  return [image.ext.toUpperCase(), pictureWords(image), sizeWords(image.bytes)].filter(Boolean).join(', ');
}

/** The message a new chat starts with when it is opened from the library. */
export function chatDraft(images: LibraryItem[]): string {
  const [only] = images;
  if (images.length === 1 && only) return `Help me with this image: ${only.path}`;
  return `Help me with these ${images.length} images:\n${images.map((i) => `- ${i.path}`).join('\n')}`;
}
