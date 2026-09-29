// The line that greets you, and the one worth thinking about while you read the rest.
//
// "Good morning, Harish" is pleasant and says nothing. Keeping it but giving it something to sit
// beside turns the top of the Dashboard from a label into a moment -- and a quote that changes
// once a day is read; one that changes on every render is wallpaper.
//
// The same quote for everyone, all day: it is picked from the date, not at random, so two people
// looking at their Dashboards at the same time are reading the same line. That is what makes it
// something to mention to each other rather than a private fortune cookie.
import React, { useMemo } from 'react';
import {
  Compass, Eye, Feather, Flame, Footprints, Gem, Hammer, Hourglass, Layers, Leaf, Lightbulb, Mountain, Ruler,
  Scale, ScanSearch, Sparkles, Sprout, Target, Timer, Waves, Wrench,
} from 'lucide-react';

interface Thought {
  words: string;
  /** Kept although it is not shown: a line worth reading is worth being able to attribute. */
  who: string;
  /** A symbol for what it is about, so the band says something before it is read. */
  Icon: React.ElementType;
}

/**
 * Seven colours, kept light. The quote carries the colour because it is the thing being read --
 * but softly: something opened every morning should not shout at anyone.
 */
const TONES = [
  { band: 'from-rose-50/80 to-white', ring: 'ring-rose-100', chip: 'bg-rose-100/70 text-rose-500', words: 'text-rose-600' },
  { band: 'from-orange-50/80 to-white', ring: 'ring-orange-100', chip: 'bg-orange-100/70 text-orange-500', words: 'text-orange-600' },
  { band: 'from-amber-50/80 to-white', ring: 'ring-amber-100', chip: 'bg-amber-100/70 text-amber-600', words: 'text-amber-700' },
  { band: 'from-fuchsia-50/80 to-white', ring: 'ring-fuchsia-100', chip: 'bg-fuchsia-100/70 text-fuchsia-500', words: 'text-fuchsia-600' },
  { band: 'from-purple-50/80 to-white', ring: 'ring-purple-100', chip: 'bg-purple-100/70 text-purple-500', words: 'text-purple-600' },
  { band: 'from-sky-50/80 to-white', ring: 'ring-sky-100', chip: 'bg-sky-100/70 text-sky-500', words: 'text-sky-600' },
  { band: 'from-red-50/70 to-white', ring: 'ring-red-100', chip: 'bg-red-100/60 text-red-400', words: 'text-red-500' },
] as const;

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

export const DailyThought: React.FC<{
  /** "Good morning, Harish" — kept, because being greeted by name is the warm part. */
  greeting: string;
}> = ({ greeting }) => {
  const today = new Date();
  const key = today.toDateString();

  // The quote and the colour are counted off the day separately. There are 31 quotes and 7
  // colours, and 7 does not divide 31, so the pairing shifts every cycle: the same line comes
  // back in a different colour, and no two days running are ever the same shade.
  const { thought, skin } = useMemo(() => {
    const n = dayNumber(new Date(key));
    const wrap = (value: number, size: number) => ((value % size) + size) % size;
    return { thought: THOUGHTS[wrap(n, THOUGHTS.length)], skin: TONES[wrap(n, TONES.length)] };
  }, [key]);

  const date = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <section
      aria-label="Thought of the day"
      className={`mb-4 overflow-hidden rounded-2xl bg-gradient-to-r ${skin.band} px-5 py-4 ring-1 ${skin.ring}`}
    >
      <div className="flex items-start gap-4">
        {/* A symbol for what this line is about, rather than a quote mark that says only
            "this is a quote" -- which the quotation marks already say. */}
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${skin.chip}`} aria-hidden>
          <thought.Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-gray-900">
            {greeting}
            <span className="text-xs font-normal text-gray-500">{date}</span>
          </p>
          <blockquote className={`mt-1.5 text-[17px] font-medium leading-snug ${skin.words}`}>
            “{thought.words}”
          </blockquote>
        </div>
      </div>
    </section>
  );
};
