// Which look the top bar's bell has. Picked on Settings -> Notifications and kept in this browser;
// the bell and the picker both listen, so a change shows at once without a reload.
import { useEffect, useState } from 'react';

export const BELL_STYLES = [
  { key: 'hairline', name: 'Hairline', note: 'White, thin grey ring' },
  { key: 'tint', name: 'Navy tint', note: 'Soft navy circle' },
  { key: 'solid', name: 'Solid navy', note: 'Navy circle, white bell' },
  { key: 'outline', name: 'Navy outline', note: 'Navy ring, filled bell' },
  { key: 'raised', name: 'Raised', note: 'White, soft shadow' },
] as const;
export type BellStyle = (typeof BELL_STYLES)[number]['key'];

const KEY = 'verveflow.bellStyle';
const CHANGED = 'verveflow:bell-style';

const read = (): BellStyle => {
  try {
    const saved = localStorage.getItem(KEY);
    if (BELL_STYLES.some((s) => s.key === saved)) return saved as BellStyle;
  } catch { /* storage blocked: the default look */ }
  return 'hairline';
};

export const setBellStyle = (style: BellStyle) => {
  try { localStorage.setItem(KEY, style); } catch { /* still changes for this visit */ }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: style }));
};

export const useBellStyle = (): BellStyle => {
  const [style, setStyle] = useState<BellStyle>(read);
  useEffect(() => {
    const on = (e: Event) => setStyle((e as CustomEvent<BellStyle>).detail);
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  return style;
};
