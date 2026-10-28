// Hints drawn by us rather than by the browser.
//
// Every icon button in the app already says what it does in its `title`. The browser shows that
// late, in a plain grey box, in its own font -- the moment it appears the app looks like a web
// page. This shows the same words, sooner, in a small dark bubble above the control, the way a
// desktop tool does. Nothing changes in the markup: the title is lifted off while the pointer is
// on the control (so the browser does not draw its own as well) and put back when it leaves.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Tip = { text: string; x: number; y: number; below: boolean };

export const Tooltips: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // A finger has no hover; there the browser's own behaviour stays.
    if (!window.matchMedia('(hover: hover)').matches) return;
    let timer = 0;
    let el: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      if (el) {
        // Only put it back if React has not given the control a new title in the meantime.
        if (el.dataset.tip !== undefined && !el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip);
        delete el.dataset.tip;
        el = null;
      }
      setTip(null);
    };
    const over = (e: MouseEvent) => {
      const t = (e.target as Element | null)?.closest?.('[title]') as HTMLElement | null;
      if (!t || t === el) return;
      hide();
      const text = t.getAttribute('title')?.trim();
      if (!text) return;
      el = t;
      t.dataset.tip = text;
      t.removeAttribute('title');
      timer = window.setTimeout(() => {
        // The page may have scrolled or moved on under a still pointer in the meantime.
        if (!t.isConnected || !t.matches(':hover')) { hide(); return; }
        const r = t.getBoundingClientRect();
        const below = r.top < 44;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, 450);
    };
    const out = (e: MouseEvent) => { if (el && !el.contains(e.relatedTarget as Node | null)) hide(); };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('mousedown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Kept inside the window: a hint on a control at the very edge slides in rather than being cut.
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!b || !tip) return;
    const half = b.offsetWidth / 2;
    const x = Math.min(Math.max(tip.x, half + 8), window.innerWidth - half - 8);
    b.style.left = `${x}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className={`ui-tip ${tip.below ? 'is-below' : ''}`}
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>,
    document.body,
  );
};
