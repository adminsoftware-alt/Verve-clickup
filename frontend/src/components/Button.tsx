// One button, so the app has one button.
//
// Before this there were about a hundred hand-written class strings on <button> elements, using
// three different greens (#0F766E, #0D9488 and #059669) and a
// dozen padding combinations. None of that was a decision; it was what was to hand at the time.
// Close-but-different is worse than either being the same or being deliberately different,
// because it reads as a mistake.
//
// This is not a design system. It is one component with four variants and three sizes, which is
// enough to stop the drift.
import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The brand colour, for the one action a screen is actually for.
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-700 focus-visible:ring-brand-600/30',
  // Everything else that is still a button: Cancel, Close, secondary actions.
  secondary: 'border border-gray-200 bg-white text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-gray-400/30',
  // Toolbar and row actions, where a border on every one would be noise.
  ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:ring-gray-400/30',
  // Deleting things. Red, and never the default focus of a dialog.
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-600/30',
};

const SIZES: Record<Size, string> = {
  sm: 'gap-1 rounded-md px-2 py-1 text-xs',
  md: 'gap-1.5 rounded-md px-3 py-1.5 text-sm',
  lg: 'gap-2 rounded-lg px-4 py-2 text-sm',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Drawn before the label. */
  icon?: React.ReactNode;
  /** Disables the button and shows this instead of the label while something is in flight. */
  busy?: boolean;
  busyLabel?: string;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary', size = 'md', icon, busy, busyLabel, className = '', disabled, children, type = 'button', ...rest
}) => (
  <button
    type={type}
    disabled={disabled || busy}
    className={[
      'inline-flex items-center justify-center font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2',
      'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
      SIZES[size],
      VARIANTS[variant],
      className,
    ].join(' ')}
    {...rest}
  >
    {!busy && icon}
    {busy && busyLabel ? busyLabel : children}
  </button>
);
