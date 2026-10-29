// The line that greets you, and the one worth thinking about while you read the rest.
//
// "Good morning, Harish" is pleasant and says nothing. Keeping it but giving it something to sit
// beside turns the top of the Dashboard from a label into a moment -- and a quote that changes
// once a day is read; one that changes on every render is wallpaper.
//
// The same quote for everyone, all day: it is picked from the date, not at random, so two people
// looking at their Dashboards at the same time are reading the same line. That is what makes it
// something to mention to each other rather than a private fortune cookie.
//
// A navy band: the greeting, this week as a row of days (today filled white, a dot under days
// with time logged), and the quote in white.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass, Eye, Feather, Flame, Footprints, Gem, Hammer, Hourglass, Layers, Leaf, Lightbulb, Mountain, Quote, Ruler,
  Scale, ScanSearch, Sparkles, Sprout, Target, Timer, Waves, Wrench,
} from 'lucide-react';

import { useWork } from '../WorkContext';
import { isoDay, sheetApi, type Timesheet } from '../timesheets/api';
import { MonthCalendar } from './MonthCalendar';

interface Thought {
  words: string;
  /** Shown under the quote: a line worth reading is worth attributing. */
  who: string;
  /** A symbol for what it is about, so the band says something before it is read. */
  Icon: React.ElementType;
}


/**
 * Chosen for people who do careful work for clients: about craft, attention, honesty and
 * finishing things. Nothing about hustling, winning or rising and grinding -- an advisory firm
 * runs on judgement, and being told to work harder at eight in the morning helps nobody.
 *
 * Each carries a symbol for what it is about: an hourglass for putting things off, a pair of
 * scales for honesty, a sprout for patience.
 */
const THOUGHTS: Thought[] = [
  { words: 'It is not enough to be busy. The question is: what are we busy about?', who: 'Henry David Thoreau', Icon: Target },
  { words: 'Quality is not an act, it is a habit.', who: 'Aristotle', Icon: Gem },
  { words: 'The secret of getting ahead is getting started.', who: 'Mark Twain', Icon: Footprints },
  { words: 'Simplicity is the ultimate sophistication.', who: 'Leonardo da Vinci', Icon: Feather },
  { words: 'Care and diligence bring luck.', who: 'Thomas Fuller', Icon: Sparkles },
  { words: 'What gets measured gets managed.', who: 'Peter Drucker', Icon: Ruler },
  { words: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', who: 'Goethe', Icon: Hammer },
  { words: 'The way to get started is to quit talking and begin doing.', who: 'Walt Disney', Icon: Flame },
  { words: 'An ounce of practice is worth more than tons of preaching.', who: 'Mahatma Gandhi', Icon: Wrench },
  { words: 'Excellence is never an accident. It is the result of high intention and intelligent effort.', who: 'Aristotle', Icon: Target },
  { words: 'Do not put off till tomorrow what can be put off till day-after-tomorrow just as well.', who: 'Mark Twain', Icon: Hourglass },
  { words: 'The best way out is always through.', who: 'Robert Frost', Icon: Compass },
  { words: 'Order and simplification are the first steps toward mastery of a subject.', who: 'Thomas Mann', Icon: Layers },
  { words: 'He who is not courageous enough to take risks will accomplish nothing in life.', who: 'Muhammad Ali', Icon: Mountain },
  { words: 'Accuracy is the twin brother of honesty; inaccuracy, of dishonesty.', who: 'Nathaniel Hawthorne', Icon: Scale },
  { words: 'You can do anything, but not everything.', who: 'David Allen', Icon: Waves },
  { words: 'A goal without a plan is just a wish.', who: 'Antoine de Saint-Exupéry', Icon: Compass },
  { words: 'Well done is better than well said.', who: 'Benjamin Franklin', Icon: Hammer },
  { words: 'Small deeds done are better than great deeds planned.', who: 'Peter Marshall', Icon: Sprout },
  { words: 'Patience and perseverance have a magical effect before which difficulties disappear.', who: 'John Quincy Adams', Icon: Sprout },
  { words: 'The details are not the details. They make the design.', who: 'Charles Eames', Icon: ScanSearch },
  { words: 'If you are working on something exciting, it will keep you motivated.', who: 'Steve Jobs', Icon: Flame },
  { words: 'Trust, but verify.', who: 'Russian proverb', Icon: Eye },
  { words: 'Never mistake motion for action.', who: 'Ernest Hemingway', Icon: Waves },
  { words: 'Good judgement comes from experience, and experience comes from bad judgement.', who: 'Rita Mae Brown', Icon: Scale },
  { words: 'The person who moves a mountain begins by carrying away small stones.', who: 'Confucius', Icon: Mountain },
  { words: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', who: 'Antoine de Saint-Exupéry', Icon: Leaf },
  { words: 'Amateurs sit and wait for inspiration; the rest of us just get up and go to work.', who: 'Stephen King', Icon: Timer },
  { words: 'In the middle of difficulty lies opportunity.', who: 'Albert Einstein', Icon: Lightbulb },
  { words: 'Honesty is a very expensive gift. Do not expect it from cheap people.', who: 'Warren Buffett', Icon: Scale },
  { words: 'It always seems impossible until it is done.', who: 'Nelson Mandela', Icon: Mountain },
];

/** Days since the epoch, in local time: the number that makes today today. */
const dayNumber = (d: Date) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

/** Today, set as type alone: the weekday in spaced capitals, the day very large, a hairline, then
 *  the month and year. A click opens your own month in a calendar right here. */
const DateBlock: React.FC<{ today: Date }> = ({ today }) => (
  <span className="flex flex-col items-center text-center">
    <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#A9C1E8]">{today.toLocaleDateString(undefined, { weekday: 'long' })}</span>
    <span className="mt-1 font-display text-[56px] font-bold leading-none tracking-[-0.04em] text-white tabular-nums">{today.getDate()}</span>
    <span className="my-2 block h-px w-10 bg-white/30" aria-hidden />
    <span className="text-[12px] font-medium tracking-wide text-white/70">{today.toLocaleDateString(undefined, { month: 'long' })} {today.getFullYear()}</span>
  </span>
);

/** "Good afternoon, Harsh" split into its two halves; a greeting without a name is all greeting. */
const split = (greeting: string) => {
  const cut = greeting.indexOf(', ');
  return cut < 0 ? { hello: greeting, name: '' } : { hello: greeting.slice(0, cut), name: greeting.slice(cut + 2) };
};
type Day = { d: string; works: boolean; logged: number };

/** The week as seven small circles: today filled navy, working days pale, a dot under days with time logged. */
const WeekDots: React.FC<{ days: Day[]; todayIso: string; dark?: boolean }> = ({ days, todayIso, dark }) => (
  <div className="flex gap-1.5" aria-label="This week">
    {days.map(({ d, works, logged }) => {
      const today = d === todayIso;
      return (
        <span key={d} className="flex flex-col items-center gap-1">
          <span aria-label={`${d}${today ? ', today' : ''}${logged ? ', time logged' : ''}`} aria-current={today ? 'date' : undefined}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${today
              ? (dark ? 'bg-white text-[#142B57]' : 'bg-[#234788] text-white')
              : works ? (dark ? 'bg-white/10 text-white/80' : 'bg-[#EEF2F8] text-[#6B7FA8]') : (dark ? 'text-white/30' : 'text-gray-300')}`}>
            {new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}
          </span>
          <span className={`h-1 w-1 rounded-full ${logged ? (dark ? 'bg-sky-300' : 'bg-[#234788]') : 'bg-transparent'}`} aria-hidden />
        </span>
      );
    })}
  </div>
);

export const DailyThought: React.FC<{
  /** "Good morning, Harish" — kept, because being greeted by name is the warm part. */
  greeting: string;
}> = ({ greeting }) => {
  const today = new Date();
  const key = today.toDateString();

  // The quote is counted off the day, so everyone sees the same line and it changes at midnight.
  const thought = useMemo(() => {
    const n = dayNumber(new Date(key));
    return THOUGHTS[((n % THOUGHTS.length) + THOUGHTS.length) % THOUGHTS.length];
  }, [key]);

  // This week's timesheet, for the row of days.
  const { workspace } = useWork();
  const [week, setWeek] = useState<Timesheet | null>(null);
  useEffect(() => {
    if (!workspace) return;
    sheetApi.get(workspace.id, isoDay(new Date())).then(setWeek).catch(() => undefined);
  }, [workspace]);

  const todayIso = isoDay(today);
  // Monday to Sunday, whatever day the timesheet week starts on.
  const mondayFirst = (d: string) => (new Date(d + 'T00:00').getDay() + 6) % 7;
  const days: Day[] = week
    ? week.days.map((d, i) => ({ d, works: (week.capacity_per_day[i] ?? 0) > 0, logged: week.tracked_per_day?.[i] ?? 0 }))
      .sort((a, b) => mondayFirst(a.d) - mondayFirst(b.d))
    : [];
  const { hello, name } = split(greeting);
  const [calendarAt, setCalendarAt] = useState<DOMRect | null>(null);
  const date = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const Icon = thought.Icon;

  // The greeting as a quiet label over the name, set large in the display face. No pictures: the
  // name is the warm part, and it is enough. The date has a page of its own, beside it.
  const greet = (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#A9C1E8]">{hello}</p>
      <p className="mt-1 font-display text-[30px] font-bold leading-none tracking-[-0.02em] text-white">{name || hello}</p>
      {/* A phone has no room for the date column, so the date sits here instead and opens the same calendar. */}
      <button type="button" data-calendar-trigger aria-haspopup="dialog" aria-expanded={!!calendarAt}
        onClick={(e) => setCalendarAt(calendarAt ? null : e.currentTarget.getBoundingClientRect())}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-[12px] font-medium text-white/80 sm:hidden">
        {date}
      </button>
    </div>
  );

  // Today, in a column of its own on the left of the band, a shade lighter than the navy. The whole
  // column opens your month, in place, under the date.
  const calendar = (
    <button type="button" data-calendar-trigger aria-label={`Today, ${date}. Show my calendar`} aria-haspopup="dialog" aria-expanded={!!calendarAt}
      onClick={(e) => setCalendarAt(calendarAt ? null : e.currentTarget.getBoundingClientRect())}
      className={`flex w-40 shrink-0 cursor-pointer items-center justify-center border-r border-white/10 px-4 py-5 transition-colors max-sm:hidden ${calendarAt ? 'bg-white/[0.12]' : 'bg-white/[0.05] hover:bg-white/[0.1]'}`}>
      <DateBlock today={today} />
    </button>
  );

  return (
    <>
      <section aria-label="Thought of the day" className="relative mb-4 flex overflow-hidden rounded-2xl bg-[#1E3D78] text-white">
        {calendar}
        {calendarAt && <MonthCalendar anchor={calendarAt} onClose={() => setCalendarAt(null)} />}
        <div className="relative min-w-0 flex-1 px-7 py-6">
          <Quote size={150} strokeWidth={1} className="pointer-events-none absolute -right-4 -top-6 text-white/[0.06]" aria-hidden />
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            {greet}
            <WeekDots days={days} todayIso={todayIso} dark />
          </div>
          <figure className="relative mt-5 max-w-4xl">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-200/80">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-white"><Icon size={13} /></span> Thought of the day
            </p>
            <blockquote className="mt-3 text-xl font-semibold leading-snug tracking-tight sm:text-[27px]">“{thought.words}”</blockquote>
            <figcaption className="mt-2.5 flex items-center gap-2 text-sm font-medium text-white/60"><span className="h-px w-8 bg-white/30" aria-hidden /> {thought.who}</figcaption>
          </figure>
        </div>
      </section>
    </>
  );
};
