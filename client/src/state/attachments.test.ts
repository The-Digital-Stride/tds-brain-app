import { describe, expect, it } from 'vitest';
import { MAX_ATTACHMENTS, MAX_UPLOAD_BYTES } from '../../../shared/contract.ts';
import {
  checkFile,
  extensionOf,
  formatSize,
  kindOfName,
  pastedName,
  pasteShouldAttach,
  summarise,
} from './attachments.ts';

describe('extensionOf', () => {
  it('takes the last extension in lower case', () => {
    expect(extensionOf('Report.FINAL.PDF')).toBe('pdf');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.hidden')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('kindOfName', () => {
  it('uses the contract list', () => {
    expect(kindOfName('a.png')).toBe('image');
    expect(kindOfName('a.pdf')).toBe('document');
    expect(kindOfName('a.exe')).toBe('document');
  });
});

describe('checkFile', () => {
  it('accepts an allowed type within limits', () => {
    expect(checkFile({ name: 'a.pdf', size: 10 }, 0)).toBeNull();
  });
  it('refuses a type that is not allowed, naming it', () => {
    expect(checkFile({ name: 'run.exe', size: 10 }, 0)).toMatch(/\.exe/);
    expect(checkFile({ name: 'noext', size: 10 }, 0)).toMatch(/type/i);
  });
  it('refuses a file over the size limit', () => {
    expect(checkFile({ name: 'a.pdf', size: MAX_UPLOAD_BYTES + 1 }, 0)).toMatch(/32 MB/);
    expect(checkFile({ name: 'a.pdf', size: MAX_UPLOAD_BYTES }, 0)).toBeNull();
  });
  it('refuses an empty file', () => {
    expect(checkFile({ name: 'a.pdf', size: 0 }, 0)).toMatch(/empty/i);
  });
  it('refuses when the message already has the most files', () => {
    expect(checkFile({ name: 'a.pdf', size: 1 }, MAX_ATTACHMENTS)).toMatch(String(MAX_ATTACHMENTS));
  });
});

describe('pastedName', () => {
  const when = new Date(2026, 10, 12, 14, 3);
  it('names an image by date and time', () => {
    expect(pastedName('image/png', when, [])).toBe('Pasted image 2026-11-12 14.03.png');
  });
  it('adds 2, 3 for repeats', () => {
    const first = 'Pasted image 2026-11-12 14.03.png';
    expect(pastedName('image/png', when, [first])).toBe('Pasted image 2026-11-12 14.03 2.png');
    expect(pastedName('image/png', when, [first, 'Pasted image 2026-11-12 14.03 2.png'])).toBe(
      'Pasted image 2026-11-12 14.03 3.png',
    );
  });
  it('uses the type for the extension', () => {
    expect(pastedName('image/jpeg', when, [])).toMatch(/\.jpg$/);
  });
});

describe('formatSize', () => {
  it('is short and plain', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('summarise', () => {
  it('counts uploading, errored and ready', () => {
    expect(
      summarise([{ status: 'uploading' }, { status: 'error' }, { status: 'ready' }, { status: 'ready' }]),
    ).toEqual({ uploading: 1, errored: 1, ready: 2 });
  });
});

describe('pasteShouldAttach', () => {
  it('attaches files only when there is no text', () => {
    expect(pasteShouldAttach(true, '')).toBe(true);
    expect(pasteShouldAttach(true, '  \n')).toBe(true);
    expect(pasteShouldAttach(true, 'cells')).toBe(false);
    expect(pasteShouldAttach(false, '')).toBe(false);
  });
});
