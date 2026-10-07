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
  // Held in a ref so restarting recognition does not need the callback to be stable.
  const finished = useRef(onFinal);
  finished.current = onFinal;

  const stop = useCallback(() => {
    engine.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!Engine) return;
    setError(null);
    setHeard('');
    const recognition = new Engine();
    recognition.lang = lang;
    recognition.continuous = false;   // one sentence, then hand it over
    recognition.interimResults = true; // show the words arriving, so it does not look frozen
    recognition.onresult = (e) => {
      let text = '';
      let done = false;
      for (let i = 0; i < e.results.length; i += 1) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) done = true;
      }
      setHeard(text);
      if (done) finished.current(text.trim());
    };
    recognition.onerror = (e) => {
      // "aborted" is what stopping it looks like from in here, and is not worth reporting.
      if (e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed'
          ? 'The microphone is blocked. Allow it for this site in your browser settings.'
          : e.error === 'no-speech'
            ? 'Nothing was heard. Try again, a little closer to the microphone.'
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
  useEffect(() => () => engine.current?.abort(), []);

  return { supported: Boolean(Engine), listening, heard, error, start, stop };
}
