// Asking someone to confirm something, or to type something, without an operating-system dialog.
//
// `window.confirm` and `window.prompt` draw a grey box with the domain name in its title bar,
// freeze the whole page while it is open, and cannot be styled at all. There were 53 of them.
//
// These are promise-based so the call sites barely change: `if (window.confirm(msg))` becomes
// `if (await ask.confirm(msg))`. One host component listens at the app root and draws the
// dialog; anything, anywhere, can ask without being passed a prop to do it.
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';

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

export type Pending =
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

const AskDialog = lazy(() => import('./askDialog').then((m) => ({ default: m.AskDialog })));

export const AskHost: React.FC = () => {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  // Sticky: once a dialog has been opened the drawn part stays mounted, so closing animates out.
  const [asked, setAsked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<Pending>).detail;
      setText(detail.kind === 'prompt' ? detail.options.initial ?? '' : '');
      setPending(detail);
      setAsked(true);
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

  return (
    // Drawn only once something has actually been asked, and mounted from then on so the exit
    // animation has somewhere to play from.
    <Suspense fallback={null}>
      {(pending || asked) && (
        <AskDialog pending={pending} text={text} setText={setText} inputRef={inputRef} close={close} />
      )}
    </Suspense>
  );
};
