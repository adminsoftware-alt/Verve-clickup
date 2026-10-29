// The assistant's mark: a speech bubble with three dots, drawn in white on its navy circle. The
// launcher and the panel both use it, so the panel reads as what the button opened.
import React from 'react';

export const ChatBubble: React.FC<{ className?: string }> = ({ className = 'h-7 w-7' }) => (
  <svg aria-hidden viewBox="0 0 48 48" className={`relative text-white ${className}`} fill="none">
    <path d="M14 8h20a9 9 0 0 1 9 9v10a9 9 0 0 1-9 9H19l-8 6v-6.4A9 9 0 0 1 5 27V17a9 9 0 0 1 9-9z"
      stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round" />
    {['15.5', '24', '32.5'].map((cx) => <circle key={cx} cx={cx} cy="22" r="2.6" fill="currentColor" />)}
  </svg>
);
