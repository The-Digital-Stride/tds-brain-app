import type { DocFormat } from '../../../../shared/contract.ts';
import type { IconName } from '../../shell/contract.ts';

/** The line icon for each kind of document. */
export const FORMAT_ICONS: Record<DocFormat, IconName> = {
  pdf: 'doc',
  doc: 'doc',
  sheet: 'sheet',
  deck: 'slides',
};
