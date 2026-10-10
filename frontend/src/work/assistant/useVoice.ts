// Dictation, using the recogniser the browser already has.
//
// No key, no backend, no per-use cost: Chrome, Edge and Safari all ship speech recognition, and
// for a sentence like "call the auditor tomorrow" it is as good as anything you would pay for.
// Firefox does not, which is why `supported` exists -- the button simply is not drawn there.
//
// One thing worth knowing: Chrome sends the audio to Google to transcribe. For a firm whose task
// names carry client names that is a decision to take deliberately, not to discover later, and it
// is why dictation is something a person starts rather than something that is always listening.

import { useCallback, useEffect, useRef, useState } from 'react';

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Engine: { new (): Recognition } | undefined =
  typeof window === 'undefined'
    ? undefined
    : ((window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as { new (): Recognition } | undefined;

/** How long a silence has to last before the sentence counts as finished. */
const QUIET_MS = 2500;

export interface Voice {
  supported: boolean;
  listening: boolean;
  /** What has been heard so far, including the part the recogniser may still revise. */
  heard: string;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * @param onFinal called once with the finished sentence, when the speaker stops.
 * @param lang    Indian English by default: it is far better on Indian names and numbers than
 *                en-US, which is what the browser would otherwise pick from the system locale.
 */
export function useVoice(onFinal: (text: string) => void, lang = 'en-IN'): Voice {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const engine = useRef<Recognition | null>(null);
  // The last thing heard, and the timer that decides the speaker has stopped.
  const said = useRef('');
  const hush = useRef<number | undefined>(undefined);
  // Held in a ref so restarting recognition does not need the callback to be stable.
  const finished = useRef(onFinal);
  finished.current = onFinal;

  const stop = useCallback(() => {
    window.clearTimeout(hush.current);
    engine.current?.stop();
    setListening(false);
    if (said.current.trim()) finished.current(said.current.trim());
  }, []);

  const start = useCallback(() => {
    if (!Engine) return;
    setError(null);
    setHeard('');
    said.current = '';
    const recognition = new Engine();
    recognition.lang = lang;
    // Keep listening. With `continuous` off the recogniser stops at the first pause, which cuts
    // people off mid-sentence -- and a pause is exactly what somebody does while they think of
    // the next word. It now runs until the speaker presses stop, or until a few seconds of
    // silence say they have finished.
    recognition.continuous = true;
    recognition.interimResults = true; // show the words arriving, so it does not look frozen
    recognition.onresult = (e) => {
      let settled = '';
      let pending = '';
      for (let i = 0; i < e.results.length; i += 1) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) settled += piece;
        else pending += piece;
      }
      const text = (settled + pending).replace(/\s+/g, ' ').trim();
      setHeard(text);
      said.current = text;
      // Quiet for a moment after a finished phrase means the sentence is over. Restarted on
      // every result, so thinking mid-sentence does not count as finishing.
      window.clearTimeout(hush.current);
      if (settled.trim()) {
        hush.current = window.setTimeout(() => {
          recognition.stop();
          finished.current(said.current);
        }, QUIET_MS);
      }
    };
    recognition.onerror = (e) => {
      // "aborted" is what stopping it looks like from in here, and is not worth reporting.
      if (e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it for this site in your browser settings.'
          : e.error === 'no-speech'
            ? 'Nothing was heard yet — keep talking, or press stop.'
            : `The microphone could not be used (${e.error}).`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    engine.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError('Dictation could not start. It may already be running in another tab.');
    }
  }, [lang]);

  // A recogniser left running when the component goes is a microphone left on.
  useEffect(() => () => { window.clearTimeout(hush.current); engine.current?.abort(); }, []);

  return { supported: Boolean(Engine), listening, heard, error, start, stop };
}
