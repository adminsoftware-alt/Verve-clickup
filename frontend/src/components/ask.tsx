// Asking someone to confirm something, or to type something, without an operating-system dialog.
//
// `window.confirm` and `window.prompt` draw a grey box with the domain name in its title bar,
// freeze the whole page while it is open, and cannot be styled at all. There were 53 of them.
//
// These are promise-based so the call sites barely change: `if (window.confirm(msg))` becomes
// `if (await ask.confirm(msg))`. One host component listens at the app root and draws the
// dialog; anything, anywhere, can ask without being passed a prop to do it.
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmOptions {
  /** The question. Kept short: the title is what people actually read. */
  title: string;
  /** What will happen, and anything that cannot be undone. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red, for anything that destroys something. */
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  body?: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
}

type Pending =
  | { kind: 'confirm'; options: ConfirmOptions; settle: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; settle: (value: string | null) => void };

const EVENT = 'verve:ask';

/**
 * Ask, from anywhere.
 *
 * A plain string is accepted so the sweep from `window.confirm('Delete this?')` was mechanical;
 * pass an object where the question deserves a body or a red button.
 */
export const ask = {
  confirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts = typeof options === 'string' ? { title: options } : options;
    return new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent<Pending>(EVENT, {
        detail: { kind: 'confirm', options: opts, settle: resolve },
      }));
    });
  },
  prompt(options: PromptOptions | string, initial = ''): Promise<string | null> {
    const opts = typeof options === 'string' ? { title: options, initial } : options;
    return new Promise((resolve) => {
      window.dispatchEvent(new CustomEvent<Pending>(EVENT, {
        detail: { kind: 'prompt', options: opts, settle: resolve },
      }));
    });
  },
};

export const AskHost: React.FC = () => {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<Pending>).detail;
      setText(detail.kind === 'prompt' ? detail.options.initial ?? '' : '');
      setPending(detail);
    };
    window.addEventListener(EVENT, onAsk);
    return () => window.removeEventListener(EVENT, onAsk);
  }, []);

  useEffect(() => {
    if (pending?.kind === 'prompt') inputRef.current?.select();
  }, [pending]);

  // Escape is the same as Cancel, and closing without answering is a "no" rather than a promise
  // that never settles -- an unsettled promise would leave the caller waiting forever.
  const close = (answer: boolean | string | null) => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.settle(answer === true);
    else pending.settle(typeof answer === 'string' ? answer : null);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(pending.kind === 'confirm' ? false : null);
      if (e.key === 'Enter' && pending.kind === 'prompt' && text.trim()) close(text.trim());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, text]);

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
