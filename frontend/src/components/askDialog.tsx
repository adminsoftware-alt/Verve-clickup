// The drawn part of a confirm or prompt dialog, kept apart from the part that listens.
//
// framer-motion is 40 KB gzipped and this is the only thing in the shell that wanted it, so every
// page load in the app carried an animation library for a dialog most loads never opened. The
// listener has to stay eager -- an ask with nothing listening is a promise that never settles and
// a button that hangs -- so what moved here is only the markup.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

import type { Pending } from './ask';

export const AskDialog: React.FC<{
  pending: Pending | null;
  text: string;
  setText: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  close: (answer: boolean | string | null) => void;
}> = ({ pending, text, setText, inputRef, close }) => {
  const danger = pending?.kind === 'confirm' && pending.options.danger;
  const title = pending?.options.title ?? '';
  const body = pending?.options.body;

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-900/40 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          onMouseDown={() => close(pending.kind === 'confirm' ? false : null)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="w-[26rem] max-w-full overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
          >
            <div className="flex items-start gap-3 px-5 pb-4 pt-5">
              {danger && (
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <AlertTriangle size={18} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-semibold text-gray-900">{title}</h3>
                {body && <p className="mt-1 text-[13px] leading-snug text-gray-600">{body}</p>}
                {pending.kind === 'prompt' && (
                  <label className="mt-3 block text-xs font-medium text-gray-600">
                    {pending.options.label}
                    <input
                      ref={inputRef}
                      autoFocus
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={pending.options.placeholder}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </label>
                )}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => close(pending.kind === 'confirm' ? false : null)}
                className="-mr-1 -mt-1 rounded-lg p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50/70 px-5 py-3">
              <button
                type="button"
                onClick={() => close(pending.kind === 'confirm' ? false : null)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-200/70"
              >
                {(pending.kind === 'confirm' && pending.options.cancelLabel) || 'Cancel'}
              </button>
              <button
                type="button"
                autoFocus={pending.kind === 'confirm'}
                disabled={pending.kind === 'prompt' && !text.trim()}
                onClick={() => close(pending.kind === 'confirm' ? true : text.trim())}
                className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40 ${
                  danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'}`}
              >
                {pending.options.confirmLabel || (danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
