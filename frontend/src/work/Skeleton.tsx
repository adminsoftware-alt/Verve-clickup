// What a screen looks like while its data is on the way: the shape of the thing, with a light
// sweeping across it, instead of the word "Loading".
import React from 'react';

/** One soft block. Width and height are Tailwind classes, so it can take any shape. */
export const Bar: React.FC<{ className?: string }> = ({ className = 'h-3 w-40' }) => (
  <span className={`skeleton block ${className}`} />
);

/** Rows of tasks, as they appear in a List. */
export const TaskRowsSkeleton: React.FC<{ rows?: number; label?: string }> = ({ rows = 6, label = 'Loading tasks' }) => (
  <div className="px-6 py-4" role="status" aria-live="polite" aria-label={label}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 border-b border-gray-100 py-3">
        <Bar className="h-4 w-4 rounded-full" />
        <Bar className={`h-3 ${['w-64', 'w-80', 'w-56', 'w-72', 'w-60', 'w-96'][i % 6]}`} />
        <span className="ml-auto flex items-center gap-6">
          <Bar className="h-5 w-5 rounded-full" />
          <Bar className="h-3 w-16" />
          <Bar className="h-3 w-16" />
          <Bar className="h-3 w-12" />
        </span>
      </div>
    ))}
  </div>
);

/** A dashboard card's contents. */
export const CardSkeleton: React.FC = () => (
  <div className="flex h-full flex-col justify-center gap-2 px-1" role="status" aria-label="Loading card">
    <Bar className="h-3 w-24" />
    <Bar className="h-8 w-full" />
    <Bar className="h-3 w-2/3" />
  </div>
);

/** A page that is mostly rows: the Hub, People, Timesheets. */
export const ListSkeleton: React.FC<{ rows?: number; label?: string }> = ({ rows = 5, label = 'Loading' }) => (
  <div className="space-y-2" role="status" aria-live="polite" aria-label={label}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-3">
        <Bar className="h-7 w-7 rounded-full" />
        <Bar className={`h-3 ${['w-48', 'w-64', 'w-40', 'w-56', 'w-52'][i % 5]}`} />
        <Bar className="ml-auto h-3 w-20" />
      </div>
    ))}
  </div>
);
