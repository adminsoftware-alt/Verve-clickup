// The strip of views across the top of My Tasks: List, Table, Workload, Calendar, Planner.
//
// The same work, asked about five different ways. Each carries its own colour and its own name
// rather than being one of five grey icons, because "which view am I in" should be answerable
// from the corner of your eye -- and because a person who has never opened Workload will not
// find it behind an unlabelled icon.
//
// Every icon keeps its colour whether or not you are in that view: the colour says which view it
// is, so greying it out when unselected would make the strip mean nothing until it was read. The
// view you are in is said by the underline and the weight of its name instead.
import React from 'react';
import { CalendarDays, CalendarRange, LayoutList, SquareKanban, Table2, Timer } from 'lucide-react';

export type ViewKey = 'list' | 'board' | 'table' | 'workload' | 'calendar' | 'planner';

export const VIEWS: {
  key: ViewKey; label: string; Icon: React.ElementType; hint: string;
}[] = [
  {
    key: 'list', label: 'List', Icon: LayoutList, hint: 'Your tasks, grouped',
  },
  {
    key: 'board', label: 'Board', Icon: SquareKanban, hint: 'Columns you can drag cards between',
  },
  {
    key: 'table', label: 'Table', Icon: Table2, hint: 'A spreadsheet of the same tasks',
  },
  {
    key: 'workload', label: 'Workload', Icon: CalendarRange, hint: 'Your week, day by day, against your capacity',
  },
  {
    key: 'calendar', label: 'Calendar', Icon: CalendarDays, hint: 'The month, by due date',
  },
  {
    key: 'planner', label: 'Planner', Icon: Timer, hint: 'Block out the hours of your day',
  },
];

export const ViewTabs: React.FC<{
  value: ViewKey;
  onChange: (key: ViewKey) => void;
  /** Which views this page offers; all of them when not given. */
  only?: ViewKey[];
  /** Shown on the right of the strip, e.g. how many tasks are in view. */
  aside?: React.ReactNode;
}> = ({ value, onChange, aside, only }) => (
  // The tabs are wider than a phone -- five of them is 489px -- so the strip scrolls sideways
  // rather than hiding whichever ones did not fit.
  <div role="tablist" aria-label="Views" className="scroll-x flex items-center gap-1 border-b border-gray-200 px-4 sm:px-6">
    {VIEWS.filter((v) => !only || only.includes(v.key)).map((v) => {
      const on = v.key === value;
      return (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={on}
          aria-label={v.hint}
          onClick={() => onChange(v.key)}
          // One colour for every tab: blue for the one you are in, grey for the rest.
          className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors ${
            on ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded ${on ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
            <v.Icon size={13} />
          </span>
          {v.label}
        </button>
      );
    })}
    {aside && <span className="ml-auto flex items-center gap-2 py-1.5">{aside}</span>}
  </div>
);
