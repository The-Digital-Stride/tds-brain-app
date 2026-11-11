import { lazy } from 'react';
import type { AppSlot } from './contract.ts';

/**
 * The example apps (`client/src/apps/images`, `client/src/apps/documents`): sample data only, there
 * to show how an app sits in the shell. They share `client/src/apps/shared`. They are left out of a
 * normal build, and their code with them; a build with `VITE_EXAMPLE_APPS=1` adds them to the rail.
 */
function imagesExample(): AppSlot {
  const ui = () => import('../apps/images/ui.ts');
  return {
    id: 'images',
    title: 'Images',
    icon: 'image',
    Sheet: lazy(() => ui().then((m) => ({ default: m.ImagesSheet }))),
    BarActions: lazy(() => ui().then((m) => ({ default: m.ImagesBar }))),
    Panel: lazy(() => ui().then((m) => ({ default: m.ImagesPanel }))),
    panelLabel: 'Image details',
  };
}

function documentsExample(): AppSlot {
  const ui = () => import('../apps/documents/ui.ts');
  return {
    id: 'documents',
    title: 'Documents',
    icon: 'doc',
    Sheet: lazy(() => ui().then((m) => ({ default: m.DocumentsSheet }))),
    BarActions: lazy(() => ui().then((m) => ({ default: m.DocumentsBar }))),
    Panel: lazy(() => ui().then((m) => ({ default: m.DocumentsPanel }))),
    panelLabel: 'Document details',
  };
}

/**
 * Apps on the rail. Empty until a real app exists: the rail shows an "Apps" group only when this
 * has entries, and the view `app:<id>` shows the matching `Sheet`.
 */
export const APPS: AppSlot[] =
  import.meta.env.VITE_EXAMPLE_APPS === '1' ? [imagesExample(), documentsExample()] : [];
