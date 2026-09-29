// Candidate dashboard cards, rendered with duplicate (demo) data so they can be judged on sight
// and picked. Nothing here touches the API: every number is made up in this file, shaped like the
// real ones, so the page is safe to open on any workspace. Picks are kept in the browser.
import React, { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Flame, Hand, Lightbulb, MoonStar, Sparkles, Timer, TrendingUp,
} from 'lucide-react';

type Tag = 'new' | 'improved' | 'drop';

const PICKS_KEY = 'timetriq.cardPicks';

/** 1.5 -> "1h 30m". Demo data is in hours, so this stays local to the page. */
const hrs = (h: number): string => {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  if (!whole) return `${mins}m`;
  return mins ? `${whole}h ${mins}m` : `${whole}h`;
};

// ---------------------------------------------------------------------------------------------
// Duplicate data. Shaped after a real week of one person's work.
// ---------------------------------------------------------------------------------------------

interface DemoTask { id: string; name: string; est: number; due: string; late?: boolean }

const TODAY: DemoTask[] = [
  { id: 't1', name: 'Collect Prism Logistics bank statements', est: 1, due: 'Today' },
  { id: 't2', name: 'Enter Vertex Labs purchase invoices in Tally', est: 2, due: 'Tomorrow' },
  { id: 't3', name: 'Prepare Cognivion TDS working', est: 2, due: 'Overdue', late: true },
  { id: 't4', name: 'Update the HR tracker for this week', est: 0.5, due: 'Fri' },
  { id: 't5', name: 'Chase missing bills from Unimed', est: 0.75, due: 'Fri' },
  { id: 't6', name: 'Scan and file Prism Logistics vouchers', est: 1.5, due: 'Mon' },
];

const WEEK = [
  { day: 'Mon 21', logged: 2.9, cap: 8 },
  { day: 'Tue 22', logged: 5.2, cap: 8 },
  { day: 'Wed 23', logged: 8.8, cap: 8 },
  { day: 'Thu 24', logged: 0, cap: 8 },
  { day: 'Fri 25', logged: 0, cap: 8 },
  { day: 'Sat 26', logged: 0, cap: 0 },
  { day: 'Sun 27', logged: 0, cap: 0 },
];

const ACCURACY = [
  { month: 'May', est: 34, logged: 41 },
  { month: 'Jun', est: 38, logged: 44 },
  { month: 'Jul', est: 36, logged: 39 },
  { month: 'Aug', est: 40, logged: 42 },
  { month: 'Sep', est: 38, logged: 39 },
];

// ---------------------------------------------------------------------------------------------
// Small pieces shared by the demo cards.
// ---------------------------------------------------------------------------------------------

const Bar: React.FC<{ pct: number; tone: string }> = ({ pct, tone }) => (
  <div className="h-2.5 overflow-hidden rounded-full bg-gray-100">
    <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
  </div>
);

const Note: React.FC<{ tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode }> = ({ tone, children }) => {
  const skin = tone === 'bad' ? 'bg-red-50 text-red-700'
    : tone === 'warn' ? 'bg-amber-50 text-amber-800'
    : 'bg-emerald-50 text-emerald-800';
  return <p className={`mt-2.5 rounded-lg px-3 py-2 text-xs ${skin}`}>{children}</p>;
};

const Row: React.FC<{ colour?: string; children: React.ReactNode; right?: React.ReactNode }> = ({ colour = 'bg-gray-300', children, right }) => (
  <li className="flex items-center gap-2 text-sm text-gray-700">
    <span className={`h-2 w-2 shrink-0 rounded-full ${colour}`} />
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {right}
  </li>
);

const Pill: React.FC<{ tone?: 'late' | 'soon' | 'calm'; children: React.ReactNode }> = ({ tone = 'calm', children }) => {
  const skin = tone === 'late' ? 'bg-red-50 text-red-700' : tone === 'soon' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${skin}`}>{children}</span>;
};

// ---------------------------------------------------------------------------------------------
// The candidate cards themselves.
// ---------------------------------------------------------------------------------------------

/** Tick what you are doing today; it adds up the estimates and warns before you overcommit. */
const PlanMyDay: React.FC = () => {
  const [chosen, setChosen] = useState<Record<string, boolean>>({ t1: true, t3: true });
  const total = TODAY.reduce((n, t) => n + (chosen[t.id] ? t.est : 0), 0);
  const tone = total > 8 ? 'bg-red-500' : total > 6.5 ? 'bg-amber-500' : 'bg-teal-500';
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-3xl font-semibold text-gray-900">{hrs(total)}</span>
        <span className="text-xs text-gray-500">planned of 8h</span>
      </div>
      <Bar pct={(total / 8) * 100} tone={tone} />
      {total > 8 ? <Note tone="bad">{hrs(total - 8)} more than a working day. Move something to tomorrow.</Note>
        : total > 6.5 ? <Note tone="warn">Close to full — {hrs(8 - total)} left for anything that lands today.</Note>
        : <Note tone="ok">{hrs(8 - total)} still free today.</Note>}
      <p className="mb-1.5 mt-3 text-xs font-medium text-gray-500">Tick what you are doing today</p>
      <ul className="flex flex-col gap-1.5">
        {TODAY.map((t) => {
          const on = !!chosen[t.id];
          return (
            <li key={t.id}>
              <button
                type="button" aria-pressed={on}
                onClick={() => setChosen({ ...chosen, [t.id]: !on })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-sm transition-colors ${
                  on ? 'border-teal-400 bg-teal-50 text-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.late && <Pill tone="late">late</Pill>}
                <span className="shrink-0 text-xs text-gray-500">{hrs(t.est)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

/** One recommendation, so the board answers "what do I do now" instead of only describing. */
const WhatsNext: React.FC = () => (
  <div className="flex h-full flex-col justify-center">
    <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Do this next</p>
    <p className="mt-1.5 text-base font-semibold text-gray-900">Prepare Cognivion TDS working</p>
    <p className="mt-1 text-sm text-gray-500">2h estimated · due 6 days ago · the oldest thing on you</p>
    <div className="mt-3 flex gap-2">
      <span className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white">Start timer</span>
      <span className="rounded-md border border-gray-200 px-3 py-1.5 text-xs text-gray-600">Not now</span>
    </div>
  </div>
);

/** Work that will miss its date if nothing changes — hours left in the day vs hours of work left. */
const AtRisk: React.FC = () => (
  <div>
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-3xl font-semibold text-gray-900">3</span>
      <span className="text-xs text-gray-500">will be late if nothing changes</span>
    </div>
    <ul className="flex flex-col gap-2">
      <Row colour="bg-red-500" right={<Pill tone="late">needs 4h, 1h left</Pill>}>Close Unimed books</Row>
      <Row colour="bg-amber-500" right={<Pill tone="soon">needs 2h, 2h left</Pill>}>Vertex Labs GST return</Row>
      <Row colour="bg-amber-500" right={<Pill tone="soon">not started</Pill>}>Acme Retail reconciliation</Row>
    </ul>
    <Note tone="warn">Worked out from your own estimate against the working hours left before the due date.</Note>
  </div>
);

/** What is sitting with somebody else, and for how long. */
const Blocking: React.FC = () => (
  <div>
    <ul className="flex flex-col gap-2">
      <Row colour="bg-red-500" right={<Pill tone="late">6 days</Pill>}>Close Unimed books — waiting on Aditi's bank file</Row>
      <Row colour="bg-amber-500" right={<Pill tone="soon">2 days</Pill>}>Comment assigned to you by Harsh Jain</Row>
      <Row right={<Pill>1 day</Pill>}>Vertex Labs GST — waiting on client confirmation</Row>
    </ul>
    <Note tone="warn">Everything here is someone else's move. Escalate on day two instead of explaining on day ten.</Note>
  </div>
);

/** Days where the clock does not match the working day. */
const Unlogged: React.FC = () => (
  <div>
    <div className="mb-2 flex items-baseline gap-2">
      <span className="text-3xl font-semibold text-gray-900">7h 54m</span>
      <span className="text-xs text-gray-500">missing this week</span>
    </div>
    <ul className="flex flex-col gap-2">
      <Row colour="bg-red-500" right={<Pill tone="late">5h 6m short</Pill>}>Mon 21 — 2h 54m of 8h</Row>
      <Row colour="bg-amber-500" right={<Pill tone="soon">2h 48m short</Pill>}>Tue 22 — 5h 12m of 8h</Row>
      <Row colour="bg-emerald-500" right={<Pill>48m over</Pill>}>Wed 23 — 8h 48m of 8h</Row>
    </ul>
    <Note tone="warn">Fill it in now, while you still remember. Timesheet gaps are always found at month end.</Note>
  </div>
);

/** Have your estimates been honest? Month by month. */
const Accuracy: React.FC = () => {
  const worst = Math.max(...ACCURACY.map((m) => Math.max(m.est, m.logged)));
  const last = ACCURACY[ACCURACY.length - 1];
  const off = Math.round(((last.logged - last.est) / last.est) * 100);
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-gray-900">+{off}%</span>
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><ArrowDownRight size={13} />better than June</span>
      </div>
      <div className="flex items-end gap-3">
        {ACCURACY.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-20 w-full items-end justify-center gap-1">
              <div className="w-2.5 rounded-t bg-gray-200" style={{ height: `${(m.est / worst) * 100}%` }} title={`estimated ${m.est}h`} />
              <div className="w-2.5 rounded-t bg-teal-500" style={{ height: `${(m.logged / worst) * 100}%` }} title={`logged ${m.logged}h`} />
            </div>
            <span className="text-[11px] text-gray-500">{m.month}</span>
          </div>
        ))}
      </div>
      <Note tone="ok">Grey is what you estimated, teal is what it took. The gap is closing — your estimates are getting honest.</Note>
    </div>
  );
};

/** The end-of-day wrap: what got done, what did not, what moves. */
const Shutdown: React.FC = () => (
  <div>
    <p className="text-sm text-gray-700">You logged <strong>5h 12m</strong> of the 6h you planned.</p>
    <ul className="mt-2.5 flex flex-col gap-2">
      <Row colour="bg-emerald-500" right={<Pill>1h 12m</Pill>}>Collect Prism Logistics bank statements</Row>
      <Row colour="bg-emerald-500" right={<Pill>4h</Pill>}>Enter Vertex Labs purchase invoices</Row>
      <Row colour="bg-amber-500" right={<Pill tone="soon">moves to tomorrow</Pill>}>Prepare Cognivion TDS working</Row>
    </ul>
    <Note tone="ok">One tap rolls the unfinished work to tomorrow and closes the day. Tomorrow opens already planned.</Note>
  </div>
);

/** Finished on time, as a habit rather than a count. */
const OnTime: React.FC = () => (
  <div className="flex h-full flex-col justify-center">
    <div className="flex items-baseline gap-2">
      <span className="text-3xl font-semibold text-gray-900">66%</span>
      <span className="flex items-center gap-1 text-xs font-medium text-red-600"><ArrowUpRight size={13} />down from 74%</span>
    </div>
    <p className="mt-1 text-xs text-gray-500">of your finished work was on time this month</p>
    <div className="mt-3 flex gap-1">
      {[1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((ok, i) => (
        <span key={i} className={`h-7 flex-1 rounded ${ok ? 'bg-teal-500' : 'bg-red-300'}`} />
      ))}
    </div>
    <p className="mt-2 text-[11px] text-gray-400">Each block is one finished task, oldest first.</p>
  </div>
);

/** The timesheet you already have, with the days that fall short marked and editable in place. */
const Timesheet: React.FC = () => {
  const [open, setOpen] = useState(false);
  const total = WEEK.reduce((n, d) => n + d.logged, 0);
  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="pb-1.5 text-left font-semibold">Total</th>
            {WEEK.map((d) => <th key={d.day} className="pb-1.5 text-left font-semibold">{d.day}</th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-gray-100">
            <td className="py-2 font-semibold text-gray-900">{hrs(total)}</td>
            {WEEK.map((d) => {
              const pct = d.cap ? Math.min(100, (d.logged / d.cap) * 100) : d.logged ? 100 : 0;
              const over = !!d.cap && d.logged > d.cap;
              const short = !!d.cap && d.logged < d.cap;
              return (
                <td key={d.day} className="py-2 pr-1">
                  <div className="h-3 overflow-hidden rounded bg-gray-100" title={`${d.logged ? hrs(d.logged) : 'nothing'} of ${d.cap}h`}>
                    <div className={`h-full ${over ? 'bg-orange-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
                  </div>
                  {short && <span className="mt-1 block text-[10px] text-amber-600">{hrs(d.cap - d.logged)} short</span>}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      <button type="button" onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} 4 tasks
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-1.5 border-l-2 border-gray-100 pl-3">
          <Row right={<Pill>4h</Pill>}>Enter Vertex Labs purchase invoices</Row>
          <Row right={<Pill>2h 30m</Pill>}>Close Unimed books</Row>
          <Row right={<Pill>1h 12m</Pill>}>Collect Prism Logistics bank statements</Row>
        </ul>
      )}
      <Note tone="ok">Type straight into a day to log time. Days under your working hours say how short they are.</Note>
    </div>
  );
};

/** To do, grouped the way a day is actually lived. */
const ToDo: React.FC = () => (
  <div className="flex flex-col gap-3">
    {[
      ['Today', 'text-red-600', [['Sit in on the Acme Retail call', '14 Sept', 'late'], ['Chase missing bills', '16 Sept', 'late']]],
      ['This week', 'text-amber-600', [['Prepare Cognivion TDS working', '17 Sept', 'soon'], ['Update the HR tracker', '25 Sept', 'calm']]],
      ['Later', 'text-gray-500', [['Scan and file vouchers', '2 Oct', 'calm']]],
    ].map(([title, tone, rows]) => (
      <div key={title as string}>
        <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${tone as string}`}>{title as string}</p>
        <ul className="flex flex-col gap-1.5">
          {(rows as string[][]).map(([name, when, kind]) => (
            <Row key={name} right={<Pill tone={kind as 'late' | 'soon' | 'calm'}>{when}</Pill>}>{name}</Row>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

/** One of the cards worth removing from a personal board. */
const Battery: React.FC = () => (
  <div className="flex h-full flex-col justify-center gap-2">
    <div className="relative h-11 overflow-hidden rounded-lg border-2 border-gray-300 bg-gray-50">
      <div className="h-full bg-teal-400" style={{ width: '20%' }} />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-lg font-semibold text-gray-900">20%</span>
    </div>
    <p className="text-center text-xs text-gray-500">6 of 30 tasks done</p>
  </div>
);

// ---------------------------------------------------------------------------------------------

/** How close we are to being able to build it for real, given what the database actually holds. */
type Ready = 'ready' | 'seed' | 'schema';

const READY: Record<Ready, { label: string; skin: string }> = {
  ready: { label: 'data ready', skin: 'bg-emerald-50 text-emerald-700' },
  seed: { label: 'needs data', skin: 'bg-amber-50 text-amber-800' },
  schema: { label: 'needs backend work', skin: 'bg-violet-50 text-violet-700' },
};

interface Candidate {
  id: string;
  title: string;
  sub: string;
  tag: Tag;
  ready: Ready;
  wide?: boolean;
  icon: React.ElementType;
  body: React.ReactNode;
  problem: string;
  why: string;
  /** What is true in the database today. */
  data: string;
  from: string;
}

const CANDIDATES: Candidate[] = [
  {
    id: 'plan', title: 'Plan my day', sub: 'Tick today\'s work; it warns before you overcommit',
    tag: 'new', ready: 'ready', wide: true, icon: Sparkles, body: <PlanMyDay />,
    problem: 'People commit to a day they cannot physically finish, then the overdue pile grows and nobody can say why.',
    why: 'Estimates and due dates are already on the task. The only new thing is a per-day picked list.',
    data: '465 of 467 tasks carry an estimate and 466 a due date — the arithmetic works today. Daily capacity falls back to a hardcoded 8h because nobody has a member_capacity row yet.',
    from: 'Sunsama warns once planned time passes your workload threshold; Motion schedules from deadline plus estimate.',
  },
  {
    id: 'next', title: 'What\'s next', sub: 'One recommendation, right now',
    tag: 'new', ready: 'ready', icon: Lightbulb, body: <WhatsNext />,
    problem: 'A board of twelve charts still leaves you deciding what to open. Deciding is the tiring part.',
    why: 'A sort over due date, age and priority. No new query shape, no new storage.',
    data: 'Works now, but priority is empty on 156 of 467 tasks, so the ranking is running on two thirds of the signal. Making priority mandatory fixes that.',
    from: 'Linear opens on a single triage queue rather than a chart wall.',
  },
  {
    id: 'risk', title: 'At risk', sub: 'Will be late unless something changes',
    tag: 'new', ready: 'ready', icon: AlertTriangle, body: <AtRisk />,
    problem: 'Overdue tells you about a failure that already happened. Nothing warns you the day before.',
    why: 'Remaining estimate against the working hours left before the due date. Both fields exist and are filled.',
    data: '79 tasks are open and already past due. The whole point of this card is to catch the next 79 before they get there.',
    from: 'Jira sprint health flags at-risk scope; Asana flags off-track work on the goal itself.',
  },
  {
    id: 'blocked', title: 'What\'s blocking me', sub: 'Waiting on other people',
    tag: 'new', ready: 'seed', icon: Hand, body: <Blocking />,
    problem: 'Stuckness is invisible until it turns into an overdue task a week later, and the blame lands on the wrong person.',
    why: 'Dependencies already have a model, a service and an API. No dashboard card has ever read them.',
    data: 'task_links has 0 rows and task_comments has 0 rows, so this card renders empty until people actually link and comment. The plumbing is done; the habit is not.',
    from: 'Jira blocked-by views and Linear triage, in one list.',
  },
  {
    id: 'unlogged', title: 'Time not logged', sub: 'Days that do not add up',
    tag: 'new', ready: 'ready', icon: Timer, body: <Unlogged />,
    problem: 'Timesheet gaps surface at month end, when nobody remembers what they did on the 8th.',
    why: 'Logged seconds per day against daily capacity — the timesheet card already computes both.',
    data: '765 time entries, 677 hours, 73 people. Real enough to find the holes. Set proper capacity per person and the "short by" number becomes exact rather than assumed.',
    from: 'Harvest and Toggl both nudge on missing days rather than reporting them later.',
  },
  {
    id: 'accuracy', title: 'How honest are my estimates', sub: 'Estimated against actual, month by month',
    tag: 'new', ready: 'seed', icon: TrendingUp, body: <Accuracy />,
    problem: 'Estimates never improve because nobody is ever shown how wrong the last ones were.',
    why: 'Replaces the per-person expected-vs-logged table, which is not a comparison when it only ever has one row.',
    data: 'Time entries only cover 7–23 September, so this would draw a single bar today. It gets useful after a second and third month of tracking.',
    from: 'Harvest reports budget burn for the same reason; Jira\'s control chart does it for cycle time.',
  },
  {
    id: 'shutdown', title: 'Close my day', sub: 'What got done, what moves to tomorrow',
    tag: 'new', ready: 'ready', icon: MoonStar, body: <Shutdown />,
    problem: 'Work rolls over silently. Tomorrow starts by rebuilding yesterday\'s context from memory.',
    why: 'A read of today\'s time entries plus a bulk date change. No new data at all.',
    data: 'Everything it needs is already recorded.',
    from: 'Sunsama\'s daily shutdown is the feature its users name most often.',
  },
  {
    id: 'ontime', title: 'Finished on time', sub: 'Your own habit, not a count',
    tag: 'new', ready: 'ready', icon: Flame, body: <OnTime />,
    problem: 'Counting completed tasks rewards volume. Being reliable is what a manager actually notices.',
    why: 'Completion date against due date — the completed card already splits on-time from late.',
    data: '82 tasks are finished, so the percentage is real but thin. It firms up as the month closes.',
    from: 'Closest to a personal control chart; nobody in this category shows it to the employee.',
  },
  {
    id: 'timesheet', title: 'My week', sub: 'Editable in place, short days marked',
    tag: 'improved', ready: 'ready', wide: true, icon: Clock, body: <Timesheet />,
    problem: 'The timesheet reports; it does not let you fix what it reports.',
    why: 'Inline entry and a short-by marker on the card that already exists.',
    data: 'The card is live and populated. This is presentation work, not data work.',
    from: 'ClickUp\'s timesheet card, with Harvest\'s editing.',
  },
  {
    id: 'todo', title: 'To do', sub: 'Grouped Today / This week / Later',
    tag: 'improved', ready: 'ready', icon: CheckCircle2, body: <ToDo />,
    problem: 'A flat due-date list makes you scan for the line where this week ends.',
    why: 'Same query, grouped, with rows editable without leaving the board.',
    data: 'Due dates are on 466 of 467 tasks, so the grouping is reliable.',
    from: 'ClickUp Task List card; Asana My Tasks sections.',
  },
  {
    id: 'battery', title: 'How much of my work is done', sub: 'The battery, on a personal board',
    tag: 'drop', ready: 'ready', icon: CheckCircle2, body: <Battery />,
    problem: 'A percentage of an ever-growing backlog only ever looks bad, and it never suggests an action.',
    why: 'Genuinely useful on a team or project board. On your own board it is a mood, not information.',
    data: 'Worth knowing: no battery card has ever actually been created in this workspace. Of 81 cards in use, none is a battery, portfolio, line, goal or sprint card.',
    from: 'Kept for managers; dropped from the personal one.',
  },
];

const TAGS: Record<Tag, { label: string; skin: string }> = {
  new: { label: 'new', skin: 'bg-teal-50 text-teal-700' },
  improved: { label: 'improved', skin: 'bg-gray-100 text-gray-600' },
  drop: { label: 'drop', skin: 'bg-red-50 text-red-700' },
};

export const PreviewPage: React.FC = () => {
  const [picks, setPicks] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(PICKS_KEY) ?? '{}'); } catch { return {}; }
  });
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    const next = { ...picks, [id]: !picks[id] };
    setPicks(next);
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(next)); } catch { /* private window */ }
  };

  const chosen = useMemo(() => CANDIDATES.filter((c) => picks[c.id]), [picks]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Card previews</h1>
        <p className="mt-1 text-sm text-gray-500">
          Candidate cards for the personal dashboard, filled with made-up data so you can judge them on sight.
          Nothing here is live and nothing is saved to the workspace — tick the ones you want and I'll build those.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {CANDIDATES.map((c) => {
          const on = !!picks[c.id];
          const Icon = c.icon;
          const open = openId === c.id;
          return (
            <section
              key={c.id}
              className={`flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-colors ${
                on ? 'border-teal-400 ring-1 ring-teal-200' : 'border-gray-200'} ${c.wide ? 'xl:col-span-2' : ''} ${c.tag === 'drop' ? 'opacity-75' : ''}`}
            >
              <div className="mb-0.5 flex items-start gap-2">
                <Icon size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <div className="min-w-0 flex-1">
                  <h2 className={`text-sm font-semibold text-gray-900 ${c.tag === 'drop' ? 'line-through' : ''}`}>{c.title}</h2>
                  <p className="text-xs text-gray-500">{c.sub}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TAGS[c.tag].skin}`}>{TAGS[c.tag].label}</span>
              </div>
              <p className="mt-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${READY[c.ready].skin}`}>{READY[c.ready].label}</span>
              </p>

              <div className="mt-3 flex-1">{c.body}</div>

              <footer className="mt-3 border-t border-gray-100 pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setOpenId(open ? null : c.id)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Why this card
                  </button>
                  <button
                    type="button" aria-pressed={on} onClick={() => toggle(c.id)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      on ? 'bg-teal-600 text-white hover:bg-teal-700' : 'border border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >
                    {on && <Check size={12} strokeWidth={3} />}
                    {on ? 'Picked' : c.tag === 'drop' ? 'Agree, drop it' : 'Build this'}
                  </button>
                </div>
                {open && (
                  <dl className="mt-2.5 flex flex-col gap-2 text-xs">
                    <div><dt className="font-semibold text-gray-700">The problem</dt><dd className="text-gray-600">{c.problem}</dd></div>
                    <div><dt className="font-semibold text-gray-700">What it costs us to build</dt><dd className="text-gray-600">{c.why}</dd></div>
                    <div><dt className="font-semibold text-gray-700">What your data says today</dt><dd className="text-gray-600">{c.data}</dd></div>
                    <div><dt className="font-semibold text-gray-700">Where the idea comes from</dt><dd className="text-gray-500">{c.from}</dd></div>
                  </dl>
                )}
              </footer>
            </section>
          );
        })}
      </div>

      {chosen.length > 0 && (
        <div className="sticky bottom-4 mt-5 flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 shadow-sm">
          <span className="text-sm font-medium text-teal-900">{chosen.length} picked:</span>
          {chosen.map((c) => (
            <span key={c.id} className="rounded-full bg-white px-2.5 py-1 text-xs text-teal-800">{c.title}</span>
          ))}
        </div>
      )}
    </div>
  );
};
