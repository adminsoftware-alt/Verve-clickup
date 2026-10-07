// A dialog that becomes a bottom sheet on a phone.
//
// There are forty centred dialogs in this app, most of them a fixed number of rems wide: 40rem is
// 640px, and a phone is 390. `max-w-[calc(100vw-2rem)]` stops them overflowing but leaves a
// nine-field form squeezed into 358px with its buttons off the bottom. On a phone a sheet is the
// honest shape -- full width, anchored to the bottom where the thumb is, scrolling inside itself,
// and dismissed by dragging down or tapping the dimmed part of the screen.
import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Portal } from './ui';
import { usePhone } from './useBreakpoint';

/** How far down you have to drag before letting go closes it. */
const DISMISS_AT = 90;

export const Sheet: React.FC<{
  onClose: () => void;
  title?: React.ReactNode;
  /** The desktop width, as a Tailwind class. Ignored on a phone, where it is always full width. */
  width?: string;
  /** Pinned under the title, out of the scrolling area: filters, a search box. */
  toolbar?: React.ReactNode;
  /** Pinned to the bottom, where a thumb can reach it, and never scrolled away from. */
  footer?: React.ReactNode;
  label?: string;
  children: React.ReactNode;
}> = ({ onClose, title, width = 'w-[32rem]', toolbar, footer, label, children }) => {
  const phone = usePhone();
  const [drag, setDrag] = useState(0);
  const from = useRef<number | null>(null);

  // Escape closes it, as it does every other overlay here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A sheet that scrolls the page behind it feels broken, so the page is held still.
  useEffect(() => {
    if (!phone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [phone]);

  const touch = phone
    ? {
        onTouchStart: (e: React.TouchEvent) => { from.current = e.touches[0].clientY; },
        onTouchMove: (e: React.TouchEvent) => {
          if (from.current === null) return;
          setDrag(Math.max(0, e.touches[0].clientY - from.current));
        },
        onTouchEnd: () => {
          if (drag > DISMISS_AT) onClose();
          from.current = null;
          setDrag(0);
        },
      }
    : {};

  return (
    <Portal>
      <div
        className={`fixed inset-0 z-[130] flex bg-black/40 ${phone ? 'items-end' : 'items-center justify-center p-4'}`}
        onMouseDown={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label ?? (typeof title === 'string' ? title : 'Dialog')}
          onMouseDown={(e) => e.stopPropagation()}
          style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
          className={
            phone
              ? 'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl transition-transform'
              : `flex max-h-[90vh] ${width} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl`
          }
        >
          {/* The grab handle: the only thing that says "you can pull this down". */}
          {phone && (
            <div {...touch} className="flex shrink-0 cursor-grab justify-center pb-1 pt-2.5 active:cursor-grabbing">
              <span className="h-1 w-10 rounded-full bg-gray-300" />
            </div>
          )}
          {(title || !phone) && (
            <div {...touch} className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2 sm:px-5 sm:pt-4">
              <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">{title}</h3>
              <button type="button" onClick={onClose} aria-label="Close" className="tap rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X size={18} />
              </button>
            </div>
          )}
          {toolbar && <div className="shrink-0 border-b border-gray-100 px-4 pb-2.5 sm:px-5">{toolbar}</div>}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">{children}</div>
          {footer && (
            // On a phone this sits above the home indicator, which otherwise eats the buttons.
            <div className="shrink-0 border-t border-gray-100 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:pb-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
};
