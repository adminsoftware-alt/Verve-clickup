// The assistant's mark: a speech bubble with three dots, in its orange-to-violet gradient. The
// launcher and the panel both use it, so the panel reads as what the button opened.
import React, { useId } from 'react';

export const ChatBubble: React.FC<{ className?: string; blink?: boolean }> = ({ className = 'h-7 w-7', blink = true }) => {
  const id = useId();
  return (
    <svg aria-hidden viewBox="0 0 48 48" className={`relative ${className}`} fill="none">
      <defs>
        <linearGradient id={id} x1="4" y1="40" x2="44" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff9f1c" />
          <stop offset="0.5" stopColor="#ff3d7f" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path d="M14 8h20a9 9 0 0 1 9 9v10a9 9 0 0 1-9 9H19l-8 6v-6.4A9 9 0 0 1 5 27V17a9 9 0 0 1 9-9z"
        stroke={`url(#${id})`} strokeWidth="3.5" strokeLinejoin="round" />
      {[['15.5', '#ff8a3d', 0], ['24', '#ff3d7f', 200], ['32.5', '#d946ef', 400]].map(([cx, fill, delay]) => (
        <circle key={cx as string} className={blink ? 'assistant-blink' : undefined} cx={cx as string} cy="22" r="2.6" fill={fill as string}
          style={{ animationDelay: `${delay}ms` }} />
      ))}
    </svg>
  );
};
