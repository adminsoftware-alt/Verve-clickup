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
// Beside the greeting, this week as a row of days, Monday to Sunday, with today filled in navy.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Compass, Eye, Feather, Flame, Footprints, Gem, Hammer, Hourglass, Layers, Leaf, Lightbulb, Mountain, Quote, Ruler,
  Scale, ScanSearch, Sparkles, Sprout, Target, Timer, Waves, Wrench,
} from 'lucide-react';

import { useWork } from '../WorkContext';
import { isoDay, sheetApi, type Timesheet } from '../timesheets/api';

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

/** "Good evening," quietly, then the name in bold navy: the name is the warm part. */
const Hello: React.FC<{ greeting: string }> = ({ greeting }) => {
  const cut = greeting.indexOf(', ');
  if (cut < 0) return <p className="text-xl font-bold text-[#234788]">{greeting}</p>;
  return (
    <p className="text-[15px] text-gray-500">
      {greeting.slice(0, cut)}, <span className="text-xl font-bold text-[#234788]">{greeting.slice(cut + 2)}</span>
    </p>
  );
};

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
  const days = week
    ? week.days.map((d, i) => ({ d, works: (week.capacity_per_day[i] ?? 0) > 0 })).sort((a, b) => mondayFirst(a.d) - mondayFirst(b.d))
    : [];

  return (
    <section
      aria-label="Thought of the day"
      className="relative mb-4 overflow-hidden rounded-2xl bg-gradient-to-r from-white via-white to-[#EEF2F8] px-6 py-5 pl-7 ring-1 ring-[#DCE3EE]"
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-[#234788]" aria-hidden />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Hello greeting={greeting} />
        <div className="flex gap-1.5" aria-label="This week">
          {days.map(({ d, works }) => (
            <span
              key={d}
              aria-label={`${d}${d === todayIso ? ', today' : ''}`}
              aria-current={d === todayIso ? 'date' : undefined}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                d === todayIso ? 'bg-[#234788] text-white'
                  : works ? 'bg-[#EEF2F8] text-[#6B7FA8]' : 'text-gray-300'}`}
            >
              {new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
          ))}
        </div>
      </div>
      <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#EEF2F8] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#234788]">
        Thought of the day
      </span>
      <figure className="relative mt-3 max-w-4xl pr-16">
        <blockquote className="text-xl font-semibold leading-snug tracking-tight text-[#142B57] sm:text-[26px]">
          “{thought.words}”
        </blockquote>
        <figcaption className="mt-2 flex items-center gap-2 text-sm font-medium text-gray-500">
          <span className="h-px w-6 bg-gray-300" aria-hidden /> {thought.who}
        </figcaption>
      </figure>
      <Quote size={64} strokeWidth={1.25} className="pointer-events-none absolute bottom-3 right-5 text-[#234788]/10" aria-hidden />
    </section>
  );
};
