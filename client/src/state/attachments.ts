import {
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  UPLOAD_TYPES,
  type UploadKind,
} from '../../../shared/contract.ts';

/** One file on the composer: waiting to upload, uploaded, or refused. */
export interface AttachmentChip {
  /** Local id, for React keys and updates. */
  localId: string;
  name: string;
  size: number;
  kind: UploadKind;
  status: 'uploading' | 'ready' | 'error';
  /** Plain reason, when status is 'error'. */
  message?: string;
  /** The server's id, once uploaded. */
  serverId?: string;
}

/** Lower-case extension without the dot, or '' if there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function kindOfName(name: string): UploadKind {
  return UPLOAD_TYPES[extensionOf(name)] ?? 'document';
}

/** Why a file can't be attached, in plain words, or null if it can. `count` is the files already on the message. */
export function checkFile(file: { name: string; size: number }, count: number): string | null {
  if (count >= MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files to a message.`;
  const ext = extensionOf(file.name);
  if (!ext) return "TDS Brain can't pass on this type of file.";
  if (!Object.hasOwn(UPLOAD_TYPES, ext)) {
    return `TDS Brain can't pass on .${ext} files. Attach a document, spreadsheet, slide deck, text file or picture.`;
  }
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) {
    return `This file is over ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

const PASTE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/svg+xml': 'svg',
};

const two = (n: number) => String(n).padStart(2, '0');

/** `Pasted image 2026-11-12 14.03.png`, with ` 2`, ` 3` for repeats among `existing` names. */
export function pastedName(mime: string, when: Date, existing: string[]): string {
  const ext = PASTE_EXT[mime] ?? 'png';
  const stamp = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}.${two(when.getMinutes())}`;
  const base = `Pasted image ${stamp}`;
  let name = `${base}.${ext}`;
  for (let n = 2; existing.includes(name); n++) name = `${base} ${n}.${ext}`;
  return name;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`;
}

export function summarise(chips: Array<Pick<AttachmentChip, 'status'>>) {
  const out = { uploading: 0, errored: 0, ready: 0 };
  for (const c of chips) {
    if (c.status === 'uploading') out.uploading++;
    else if (c.status === 'error') out.errored++;
    else out.ready++;
  }
  return out;
}

/** Which line icon a file gets, by what it is. */
export function iconFor(name: string, kind: UploadKind): 'image' | 'sheet' | 'slides' | 'doc' {
  if (kind === 'image') return 'image';
  const ext = extensionOf(name);
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx'].includes(ext)) return 'slides';
  return 'doc';
}

/** Files on the clipboard are attached only when no text came with them (Excel and Word copy both). */
export function pasteShouldAttach(hasFiles: boolean, text: string): boolean {
  return hasFiles && text.trim() === '';
}
