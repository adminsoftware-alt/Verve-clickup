// The sound a new notification makes. Each person picks one on Settings -> Notifications (or
// None), the way they pick the bell's look; the choice is kept in this browser and only that
// sound plays. Soft chime is the default. All are made with Web Audio, so there are no files.
//
// Browsers only let a page play sound after it has been clicked or typed in, so the audio is
// unlocked on the first such touch; before that a sound is skipped rather than queued.
import { useEffect, useState } from 'react';

export const ALERT_SOUNDS = [
  { key: 'chime', name: 'Soft chime', note: 'Two warm rising notes' },
  { key: 'ping', name: 'Glass ping', note: 'One bright, clean ping' },
  { key: 'marimba', name: 'Marimba pop', note: 'A wooden two-tap' },
  { key: 'bell', name: 'Gentle bell', note: 'A soft, low bell' },
  { key: 'triad', name: 'Triad rise', note: 'Three climbing notes' },
  { key: 'pluck', name: 'Soft pluck', note: 'Short and quiet' },
  { key: 'off', name: 'None', note: 'No sound' },
] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number]['key'];

const KEY = 'verveflow.alertSound';
const CHANGED = 'verveflow:alert-sound';

let ctx: AudioContext | null = null;
const audio = (): AudioContext | null => {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
};

// Unlock on the first click or key press anywhere in the app.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio()?.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** One soft note: a quick rise and a gentle fade, with an optional faint octave above. */
function note(a: AudioContext, freq: number, at: number, length: number,
  { gain = 0.15, type = 'sine' as OscillatorType, overtone = 0 } = {}) {
  const t = a.currentTime + at;
  const out = a.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  out.gain.exponentialRampToValueAtTime(0.0001, t + length);
  out.connect(a.destination);
  const voices: [number, number][] = overtone ? [[freq, 1], [freq * 2, overtone]] : [[freq, 1]];
  for (const [f, g] of voices) {
    const o = a.createOscillator();
    const og = a.createGain();
    o.type = type;
    o.frequency.value = f;
    og.gain.value = g;
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + length + 0.05);
  }
}

// The six, as heard on the preview page they were chosen from.
const PLAY: Record<Exclude<AlertSound, 'off'>, (a: AudioContext) => void> = {
  chime: (a) => { note(a, 880, 0, 0.35, { overtone: 0.15 }); note(a, 1318.5, 0.12, 0.45, { overtone: 0.12 }); },
  ping: (a) => { note(a, 1567.98, 0, 0.4, { overtone: 0.25, gain: 0.12 }); },
  marimba: (a) => { note(a, 659.25, 0, 0.18, { type: 'triangle', gain: 0.21 }); note(a, 987.77, 0.09, 0.22, { type: 'triangle', gain: 0.18 }); },
  bell: (a) => { note(a, 523.25, 0, 0.9, { overtone: 0.3 }); note(a, 1046.5, 0, 0.6, { gain: 0.04 }); },
  triad: (a) => { note(a, 523.25, 0, 0.3); note(a, 659.25, 0.09, 0.3); note(a, 783.99, 0.18, 0.45, { overtone: 0.1 }); },
  pluck: (a) => { note(a, 392, 0, 0.25, { type: 'triangle', gain: 0.24 }); },
};

/** Plays one sound now, whatever the setting: the picker on Settings uses this to preview. */
export function playAlertSound(sound: AlertSound) {
  if (sound === 'off') return;
  const a = audio();
  if (!a || a.state === 'closed') return;
  if (a.state === 'suspended') a.resume().catch(() => undefined);
  PLAY[sound](a);
}

export const chosenAlertSound = (): AlertSound => {
  try {
    const saved = localStorage.getItem(KEY);
    if (ALERT_SOUNDS.some((s) => s.key === saved)) return saved as AlertSound;
  } catch { /* storage blocked: the default */ }
  return 'chime';
};

export const setAlertSound = (sound: AlertSound) => {
  try { localStorage.setItem(KEY, sound); } catch { /* still changes for this visit */ }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: sound }));
};

export const useAlertSound = (): AlertSound => {
  const [sound, setSound] = useState<AlertSound>(chosenAlertSound);
  useEffect(() => {
    const change = (e: Event) => setSound((e as CustomEvent<AlertSound>).detail);
    window.addEventListener(CHANGED, change);
    return () => window.removeEventListener(CHANGED, change);
  }, []);
  return sound;
};

/** A new notification: this person's chosen sound, unless it is None or the tab is hidden
 *  (a background tab sounding every 30 seconds of catch-up would be noise, not news). */
export function chimeForNewNotification() {
  if (document.visibilityState !== 'visible') return;
  playAlertSound(chosenAlertSound());
}
