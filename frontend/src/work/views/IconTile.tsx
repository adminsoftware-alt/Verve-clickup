// The small coloured tile in front of each choice in the Filter, Fields and Show menus. The colour
// belongs to the field, so "Due date" looks the same in every menu it turns up in.
import React from 'react';

const TONES: Record<string, string> = {
  Status: '#2F6FD6',
  Priority: '#D97706',
  Assignee: '#7048D8',
  'Due date': '#DC2626',
  'Start date': '#0891B2',
  'Date done': '#4F46E5',
  'Date created': '#64748B',
  'Time estimate': '#B7791F',
  'Time tracked': '#DB2777',
  Tags: '#C026D3',
  'Task ID': '#475569',
  'Group by': '#475569',
  Fields: '#234788',
  'Main tasks': '#234788',
  Subtasks: '#7048D8',
  'Closed tasks': '#2F6FD6',
  'Show closed': '#2F6FD6',
};

export const toneOf = (label: string) => TONES[label] ?? '#667085';

export const IconTile: React.FC<{ Icon: React.ElementType; label: string }> = ({ Icon, label }) => {
  const tone = toneOf(label);
  return (
    <span
      aria-hidden
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
      style={{ color: tone, backgroundColor: `color-mix(in srgb, ${tone} 12%, #fff)` }}
    >
      <Icon size={12} strokeWidth={2.2} />
    </span>
  );
};
