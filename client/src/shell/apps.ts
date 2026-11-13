import { lazy } from 'react';
import { documentsSearch } from '../apps/documents/search.ts';
import { imagesSearch } from '../apps/images/search.ts';
import type { AppSlot } from './contract.ts';

/**
 * The library apps (`client/src/apps/images`, `client/src/apps/documents`): the images and
 * documents the server lists from the brain. They share `client/src/apps/shared` and are always on
 * the rail. Each loads its code only when first opened; its search source sits outside that lazy chunk
 * (`search.ts` in each app), so the global search never loads the screens.
 */
function imagesApp(): AppSlot {
  const ui = () => import('../apps/images/ui.ts');
  return {
    id: 'images',
    title: 'Images',
    icon: 'image',
    Sheet: lazy(() => ui().then((m) => ({ default: m.ImagesSheet }))),
    BarActions: lazy(() => ui().then((m) => ({ default: m.ImagesBar }))),
    Panel: lazy(() => ui().then((m) => ({ default: m.ImagesPanel }))),
    panelLabel: 'Image details',
    search: imagesSearch,
  };
}

function documentsApp(): AppSlot {
  const ui = () => import('../apps/documents/ui.ts');
  return {
    id: 'documents',
    title: 'Documents',
    icon: 'doc',
    Sheet: lazy(() => ui().then((m) => ({ default: m.DocumentsSheet }))),
    BarActions: lazy(() => ui().then((m) => ({ default: m.DocumentsBar }))),
    Panel: lazy(() => ui().then((m) => ({ default: m.DocumentsPanel }))),
    panelLabel: 'Document details',
    search: documentsSearch,
  };
}

/**
 * Apps on the rail. The rail shows an "Apps" group only when this has entries, and the view
 * `app:<id>` shows the matching `Sheet`.
 */
export const APPS: AppSlot[] = [imagesApp(), documentsApp()];
