import type { LibraryItem, LibraryListing, LibraryScope } from '../../../../shared/contract.ts';

/** Test helper: a library item with sensible defaults. */
export function item(over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 'client:acme.a1',
    kind: 'image',
    format: null,
    ext: 'png',
    group: 'Brand',
    name: 'acme-logo.png',
    title: 'Acme logo',
    path: 'clients/acme/context/brand/acme-logo.png',
    bytes: 184_000,
    modified: '2026-11-05T10:00:00.000Z',
    width: 1200,
    height: 628,
    thumb: true,
    view: 'image',
    ...over,
  };
}

export function doc(over: Partial<LibraryItem> = {}): LibraryItem {
  return item({
    id: 'client:acme.d1',
    kind: 'document',
    format: 'pdf',
    ext: 'pdf',
    group: 'Reports',
    name: '2026-11-03-october-report.pdf',
    title: 'October report',
    path: 'clients/acme/reports/2026-11-03-october-report.pdf',
    bytes: 840_000,
    width: null,
    height: null,
    thumb: false,
    view: null,
    ...over,
  });
}

export const SCOPES: LibraryScope[] = [
  { id: 'personal', name: 'My personal files', kind: 'personal' },
  { id: 'client:acme', name: 'Acme Heating Ltd', kind: 'client' },
  { id: 'client:northwind', name: 'Northwind', kind: 'client' },
];

export function listing(
  scope: string,
  items: LibraryItem[],
  groups?: string[],
  truncated = false,
): LibraryListing {
  return { scope, groups: groups ?? [...new Set(items.map((i) => i.group))], items, truncated };
}
