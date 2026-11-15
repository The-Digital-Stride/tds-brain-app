import type { ComponentPropsWithoutRef } from 'react';
import { ResizeHandle } from './ResizeHandle.tsx';
import { useLayerWidth } from './useLayerWidth.ts';

/**
 * The file viewer's drawer: the glass panel over the desk, at the width the person chose (or its
 * default), with a handle on its left edge to change it. Both kinds of viewer (library file, chat
 * page) sit in it, so the width is one setting.
 */
export function ViewerDrawer({ children, style, ...rest }: ComponentPropsWithoutRef<'div'>) {
  const layer = useLayerWidth();
  return (
    <div className="viewer-drawer glass" style={{ ...style, ...layer.style }} {...rest}>
      {layer.resizable ? <ResizeHandle layer={layer} /> : null}
      {children}
    </div>
  );
}
