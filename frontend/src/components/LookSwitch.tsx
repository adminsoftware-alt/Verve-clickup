import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * TEMPORARY: lets the user flip between design options in the live app and pick one.
 * Delete this file (and every useLook/LookSwitch use) once the choice is made.
 */
const EVENT = 'look-change';

const read = (name: string, fallback: string) => {
  try { return localStorage.getItem(`look:${name}`) ?? fallback; } catch { return fallback; }
};

export function useLook<T extends string>(name: string, looks: readonly T[]): T {
  const [look, setLook] = useState(() => read(name, looks[0]));
  useEffect(() => {
    const sync = () => setLook(read(name, looks[0]));
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [name, looks]);
  return (looks.includes(look as T) ? look : looks[0]) as T;
}

export const LookSwitch: React.FC<{ name: string; label: string; looks: { key: string; label: string }[] }> = ({ name, label, looks }) => {
  const [current, setCurrent] = useState(() => read(name, looks[0].key));
  const pick = (key: string) => {
    try { localStorage.setItem(`look:${name}`, key); } catch { /* the pick just won't persist */ }
    setCurrent(key);
    window.dispatchEvent(new Event(EVENT));
  };
  return createPortal(
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-gray-200 bg-white p-1 pl-3 text-xs shadow-lg">
      <span className="mr-1 font-semibold text-gray-500">{label}</span>
      {looks.map((l) => (
        <button
          key={l.key}
          type="button"
          onClick={() => pick(l.key)}
          className={`rounded-full px-3 py-1.5 font-medium ${current === l.key ? 'bg-[#234788] text-white' : 'text-gray-700 hover:bg-gray-100'}`}
        >
          {l.key} · {l.label}
        </button>
      ))}
    </div>,
    document.body,
  );
};
