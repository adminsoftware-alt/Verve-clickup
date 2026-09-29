// A dropdown drawn by us rather than by the operating system.
//
// A native <select> hands its open list to the OS. That means the platform's blue highlight, the
// platform's font, the platform's row height -- and none of the status colours or priority flags
// that are the whole reason those fields can be read at a glance. It looks like a different
// application every time one is opened. This draws the same list in our own type, in the same
// place, and keeps the colours where they are useful: while you are choosing between them.
import { Check, ChevronDown } from 'lucide-react';
import React from 'react';

import { Menu } from './ui';

export interface Choice {
  value: string;
  label: string;
  /** A dot, a flag, a swatch -- whatever makes the value readable without reading it. */
  icon?: React.ReactNode;
  /** Used in the closed control where the value carries its own styling, e.g. a coloured status. */
  display?: React.ReactNode;
}

/** A boxed field in a form; a bare one in a panel, where borders show only under the pointer. */
const TRIGGER = {
  boxed: 'flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-800 transition-colors hover:border-gray-400',
  bare: 'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md border border-transparent px-2 text-sm text-gray-800 transition-colors hover:border-gray-200 hover:bg-white',
};

export const Select: React.FC<{
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  disabled?: boolean;
  variant?: keyof typeof TRIGGER;
  placeholder?: string;
}> = ({ label, value, choices, onChange, disabled, variant = 'boxed', placeholder = 'Choose…' }) => {
  const picked = choices.find((c) => c.value === value);
  const face = picked
    ? picked.display ?? <>{picked.icon}<span className="truncate">{picked.label}</span></>
    : <span className="truncate text-gray-400">{placeholder}</span>;
  const trigger = TRIGGER[variant];

  // Read-only still shows the value; it just stops pretending to be a control.
  if (disabled) {
    return (
      <span aria-label={label} className={`${trigger} pointer-events-none border-transparent bg-transparent text-gray-500`}>
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{face}</span>
      </span>
    );
  }

  return (
    <Menu
      align="left"
      label={label}
      width="trigger"
      triggerClassName="flex w-full min-w-0"
      items={choices.map((c) => ({
        label: c.label,
        icon: (
          <span className="flex items-center gap-1.5">
            {c.value === value ? <Check size={12} className="text-brand-600" /> : <span className="w-3" />}
            {c.icon}
          </span>
        ),
        onClick: () => onChange(c.value),
      }))}
      trigger={
        <span className={trigger}>
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{face}</span>
          <ChevronDown size={14} className="shrink-0 text-gray-400" />
        </span>
      }
    />
  );
};
