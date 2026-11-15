import { useMemo } from 'react';
import { HELP_LINK_ATTR, type HelpTopic } from './contract.ts';
import { helpImageUrl } from './library.ts';
import { renderHelp } from './render.ts';

/** One help page's body. The title is shown by the drawer, not here. Clicking a page link calls `onOpen`. */
export function HelpArticle({ topic, onOpen }: { topic: HelpTopic; onOpen: (id: string) => void }) {
  const html = useMemo(() => renderHelp(topic.body, helpImageUrl), [topic.body]);
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = (e.target as Element).closest?.(`[${HELP_LINK_ATTR}]`);
    const id = a?.getAttribute(HELP_LINK_ATTR);
    if (!id) return;
    e.preventDefault();
    onOpen(id);
  };
  // biome-ignore lint/security/noDangerouslySetInnerHtml: the HTML is sanitised by renderHelp above.
  // biome-ignore lint/a11y/useKeyWithClickEvents: the links inside are real anchors, which handle the keyboard.
  // biome-ignore lint/a11y/noStaticElementInteractions: click delegation for those anchors.
  return <div className="help-article" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
