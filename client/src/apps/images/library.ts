import { matchesWords, plural, sizeWords } from '../shared/words.ts';
import { KIND_WORDS, type Kind, type LibraryImage } from './data.ts';

export interface ImageFilter {
  client: string;
  query: string;
  kind: Kind | 'all';
}

/** One client's images, narrowed by type and by every word of the search (name, tags, folder). */
export function filterImages(images: LibraryImage[], { client, query, kind }: ImageFilter): LibraryImage[] {
  return images.filter((image) => {
    if (image.client !== client) return false;
    if (kind !== 'all' && image.kind !== kind) return false;
    return matchesWords(`${image.name} ${image.tags.join(' ')} ${image.folder}`, query);
  });
}

/** "1 image", "24 images". */
export function countWords(n: number): string {
  return plural(n, 'image', 'images');
}

/** "No images", "1 image, 184 KB", "24 images, 6.1 MB". */
export function summaryWords(images: LibraryImage[]): string {
  if (images.length === 0) return 'No images';
  const size = sizeWords(images.reduce((sum, i) => sum + i.bytes, 0));
  return `${countWords(images.length)}, ${size}`;
}

/** A row's meta line, lower case: "logo, 1200 × 628, 184 KB". */
export function metaWords(image: LibraryImage): string {
  return `${KIND_WORDS[image.kind]}, ${image.width} × ${image.height}, ${sizeWords(image.bytes)}`;
}

/** The message a new chat starts with when it is opened from the library. */
export function chatDraft(images: LibraryImage[]): string {
  const [only] = images;
  if (images.length === 1 && only) return `Help me with this image: ${only.path}`;
  return `Help me with these ${images.length} images:\n${images.map((i) => `- ${i.path}`).join('\n')}`;
}
