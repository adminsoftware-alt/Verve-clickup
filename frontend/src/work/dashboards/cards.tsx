import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, ExternalLink, Lock, PartyPopper, Send, Trash2 } from 'lucide-react';
import { useMe } from '../WorkContext';
import type { Task, UserRef } from '../api';
import { Avatar, AvatarStack, StatusDot, formatDue, formatDuration } from '../ui';
import { dashApi, type BehindRow, type Card, type CardData, type CardType, type CompletedRow, type DiscussionMessage, type PortfolioRow, type Segment, type TimeRow } from './api';

export const CARD_TYPES: { type: CardType; label: string; hint: string; width: number; height: number }[] = [
  { type: 'calculation', label: 'Calculation', hint: 'One number: a count of tasks, or a sum or average of time', width: 3, height: 1 },
  { type: 'pie', label: 'Pie chart', hint: 'How tasks or time split by status, person, priority, tag or List', width: 6, height: 3 },
  { type: 'bar', label: 'Bar chart', hint: 'Compare categories, or show tasks done or created over time', width: 6, height: 3 },
  { type: 'line', label: 'Line chart', hint: 'A trend over time: tasks created, done or due per day, week or month', width: 6, height: 3 },
  { type: 'task_list', label: 'Task list', hint: 'A filtered list of tasks you can open and work on', width: 6, height: 3 },
  { type: 'time_report', label: 'Time reporting', hint: 'Tracked time by person, List or task for a period', width: 6, height: 3 },
  { type: 'timesheet', label: 'Timesheet', hint: 'Tracked time per person per day, against an 8h working day', width: 12, height: 3 },
  { type: 'portfolio', label: 'Portfolio', hint: 'One row per List: progress, overdue, estimated vs tracked time', width: 12, height: 3 },
  { type: 'behind', label: "Who's behind", hint: 'People with overdue tasks, and how late they are', width: 6, height: 3 },
  { type: 'completed', label: 'Completed tasks', hint: 'Tasks finished in a period, by person, on time or late', width: 6, height: 3 },
  { type: 'notes', label: 'Notes', hint: 'Text for context, instructions or links', width: 4, height: 2 },
  { type: 'discussion', label: 'Discussion', hint: 'A chat thread about this Dashboard for everyone who can open it', width: 4, height: 3 },
  { type: 'embed', label: 'Embed', hint: 'A web page, Google Sheet, doc or video shown inside the card', width: 6, height: 3 },
];

const fmt = (value: number | null | undefined, format: string) =>
  value == null ? '–' : format === 'duration' ? formatDuration(value) || '0m' : value.toLocaleString();

export interface CardHandlers {
  /** Show the tasks behind the card, or behind one segment of it. */
  onDrill: (segment: string | undefined, label: string) => void;
  onOpenTask: (id: string) => void;
}

export const CardBody: React.FC<{ card: Card; data: CardData | undefined; dashboardId: string } & CardHandlers> = ({ card, data, dashboardId, onDrill, onOpenTask }) => {
  if (!data) return <div className="flex h-full items-center justify-center text-xs text-gray-400">Loading…</div>;
  if (data.no_access) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-gray-400">
        <Lock size={18} />
        You don't have access to the locations this card uses.
      </div>
    );
  }
  if (data.error) return <div className="flex h-full items-center justify-center px-4 text-center text-xs text-red-600">{data.error}</div>;
  const d = data.data;
  switch (card.type) {
    case 'calculation':
      return (
        <button type="button" onClick={() => onDrill(undefined, card.title)} className="flex h-full w-full flex-col items-center justify-center rounded-lg hover:bg-gray-50" title="Show these tasks">
          <span className="text-4xl font-semibold tracking-tight text-gray-900">
            {fmt(d.value, d.format)}
            {d.unit && <span className="ml-1 text-lg font-normal text-gray-500">{d.unit}</span>}
          </span>
          {d.format === 'duration' && <span className="mt-1 text-xs text-gray-400">across {d.count} task{d.count === 1 ? '' : 's'}</span>}
        </button>
      );
    case 'pie':
      return <PieCard segments={d.segments} format={d.format} total={d.total} donut={card.config.donut} onDrill={onDrill} />;
    case 'bar':
      return <BarCard segments={d.segments} format={d.format} onDrill={onDrill} />;
    case 'line':
      return <LineCard segments={d.segments} format={d.format} onDrill={onDrill} />;
    case 'task_list':
      return <TaskListCard tasks={d.tasks} total={d.total} onOpenTask={onOpenTask} onMore={() => onDrill(undefined, card.title)} />;
    case 'time_report':
      return <TimeReportCard rows={d.rows} total={d.total_seconds} showEstimates={card.config.show_estimates} seesEveryone={d.sees_everyone} />;
    case 'timesheet':
      return <TimesheetCard days={d.days} capacity={d.capacity_per_day} rows={d.rows} seesEveryone={d.sees_everyone} />;
    case 'portfolio':
      return <PortfolioCard rows={d.rows} onDrill={onDrill} />;
    case 'behind':
      return <BehindCard rows={d.rows} total={d.total} onDrill={onDrill} onOpenTask={onOpenTask} />;
    case 'completed':
      return <CompletedCard rows={d.rows} total={d.total} late={d.late} perDay={d.per_day} onDrill={onDrill} />;
    case 'notes':
      return <div className="h-full overflow-auto whitespace-pre-wrap px-1 text-sm leading-relaxed text-gray-700">{d.text || <span className="text-gray-400">Empty note. Edit the card to write something.</span>}</div>;
    case 'embed':
      return <EmbedCard url={d.url} title={card.title} />;
    case 'discussion':
      return <DiscussionCard dashboardId={dashboardId} cardId={card.id} />;
  }
};

const personName = (u: UserRef | null) => (u ? u.display_name || u.email : 'Unassigned');

/** ClickUp's "Who's behind": each person with overdue work, worst first. */
const BehindCard: React.FC<{ rows: BehindRow[]; total: number } & CardHandlers> = ({ rows, total, onDrill, onOpenTask }) => {
  if (!rows.length) {
    return <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-emerald-700"><PartyPopper size={20} /> Nobody is behind.</div>;
  }
  return (
    <div className="h-full overflow-auto">
      <p className="mb-2 text-xs text-gray-500">{total} overdue task{total === 1 ? '' : 's'}</p>
      <ul className="space-y-2" aria-label="People behind">
        {rows.map((r) => (
          <li key={r.key} className="rounded-lg border border-gray-100 p-2">
            <button type="button" onClick={() => onDrill(r.key, personName(r.user))} className="flex w-full items-center gap-2 text-left">
              {r.user ? <Avatar user={r.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">{personName(r.user)}</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{r.overdue} overdue</span>
              <span className="w-24 text-right text-xs text-gray-500">up to {r.oldest_days} day{r.oldest_days === 1 ? '' : 's'}</span>
            </button>
            <ul className="mt-1 pl-8">
              {r.tasks.slice(0, 3).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t.id)} className="flex w-full items-center gap-2 truncate text-left text-xs text-gray-600 hover:text-indigo-700">
                    <span className="min-w-0 flex-1 truncate">{t.name}</span><span className="shrink-0 text-red-600">{t.days}d late</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Tasks finished in the period, per person, with a small daily chart. */
const CompletedCard: React.FC<{ rows: CompletedRow[]; total: number; late: number; perDay: { day: string; count: number }[] } & Pick<CardHandlers, 'onDrill'>> = ({ rows, total, late, perDay, onDrill }) => {
  const max = Math.max(1, ...perDay.map((p) => p.count));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-end gap-3">
        <button type="button" onClick={() => onDrill(undefined, 'Completed tasks')} className="text-3xl font-semibold text-gray-900 hover:text-indigo-700">{total}</button>
        <span className="pb-1 text-xs text-gray-500">completed · <span className={late ? 'text-amber-700' : ''}>{late} late</span></span>
        <div className="ml-auto flex h-10 items-end gap-0.5" aria-label="Completed per day">
          {perDay.map((p) => (
            <span key={p.day} title={`${p.day}: ${p.count}`} className="w-2 rounded-t bg-emerald-400" style={{ height: `${Math.max(6, (100 * p.count) / max)}%`, opacity: p.count ? 1 : 0.25 }} />
          ))}
        </div>
      </div>
      {rows.length === 0 ? <Empty text="Nothing completed in this period" /> : (
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto" aria-label="Completed by person">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => onDrill(r.key, personName(r.user))} className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-gray-50">
                {r.user ? <Avatar user={r.user} size={20} /> : <span className="h-5 w-5 rounded-full bg-gray-200" />}
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{personName(r.user)}</span>
                <span className="text-sm font-semibold text-gray-900">{r.done}</span>
                {r.late > 0 && <span className="text-xs text-amber-700">{r.late} late</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const Empty: React.FC<{ text?: string }> = ({ text = 'No matching tasks' }) => (
  <div className="flex h-full items-center justify-center text-xs text-gray-400">{text}</div>
);

const PieCard: React.FC<{ segments: Segment[]; format: string; total: number; donut: boolean } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, total, donut, onDrill }) => {
  if (!segments.length || !total) return <Empty />;
  return (
    <div className="flex h-full min-h-0 items-center gap-3">
      <div className="relative h-full min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              innerRadius={donut ? '55%' : 0}
              outerRadius="90%"
              paddingAngle={segments.length > 1 ? 1 : 0}
              onClick={(entry: { key?: string; label?: string }) => entry.key && onDrill(entry.key, entry.label ?? '')}
              isAnimationActive={false}
            >
              {segments.map((sg) => <Cell key={sg.key} fill={sg.color} stroke={segments.length > 1 ? '#fff' : 'none'} className="cursor-pointer outline-none" />)}
            </Pie>
            <Tooltip formatter={(v: number) => fmt(v, format)} />
          </PieChart>
        </ResponsiveContainer>
        {donut && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold text-gray-900">{fmt(total, format)}</span>
            <span className="text-[10px] uppercase text-gray-400">total</span>
          </div>
        )}
      </div>
      <ul className="max-h-full w-40 shrink-0 space-y-1 overflow-y-auto text-xs">
        {segments.map((sg) => (
          <li key={sg.key}>
            <button type="button" onClick={() => onDrill(sg.key, sg.label)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-gray-50">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: sg.color }} />
              <span className="min-w-0 flex-1 truncate text-gray-700">{sg.label}</span>
              <span className="text-gray-500">{fmt(sg.value, format)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const BarCard: React.FC<{ segments: Segment[]; format: string } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, onDrill }) => {
  if (!segments.length || segments.every((sg) => !sg.value)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={segments} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid vertical={false} stroke="#f0f1f3" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: '#6b7280' }}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => (format === 'duration' ? `${Math.round(v / 3600)}h` : String(v))}
        />
        <Tooltip formatter={(v: number) => fmt(v, format)} cursor={{ fill: '#f5f5ff' }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={(entry: { key?: string; label?: string }) => entry.key && onDrill(entry.key, entry.label ?? '')}>
          {segments.map((sg) => <Cell key={sg.key} fill={sg.color} className="cursor-pointer" />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

const LineCard: React.FC<{ segments: Segment[]; format: string } & Pick<CardHandlers, 'onDrill'>> = ({ segments, format, onDrill }) => {
  if (!segments.length || segments.every((sg) => !sg.value)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={segments} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
        onClick={(e: { activePayload?: { payload: Segment }[] } | null) => { const sg = e?.activePayload?.[0]?.payload; if (sg) onDrill(sg.key, sg.label); }}>
        <CartesianGrid vertical={false} stroke="#f0f1f3" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} tickLine={false} axisLine={false}
          tickFormatter={(v: number) => (format === 'duration' ? `${Math.round(v / 3600)}h` : String(v))} />
        <Tooltip formatter={(v: number) => fmt(v, format)} />
        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5, className: 'cursor-pointer' }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

/** ClickUp's Embed card. Sandboxed, and only https pages (the server checks too). */
const EmbedCard: React.FC<{ url: string; title: string }> = ({ url, title }) => {
  if (!url) return <Empty text="No page yet. Edit the card and paste a link." />;
  return (
    <div className="relative h-full">
      <iframe src={url} title={title} className="h-full w-full rounded-md border border-gray-100" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" referrerPolicy="no-referrer" loading="lazy" allowFullScreen />
      <a href={url} target="_blank" rel="noreferrer" title="Open in a new tab" className="no-print absolute right-1 top-1 rounded bg-white/90 p-1 text-gray-500 shadow-sm hover:text-gray-800"><ExternalLink size={12} /></a>
    </div>
  );
};

/** ClickUp's Discussion card: a thread about the Dashboard for everyone who can open it. */
const DiscussionCard: React.FC<{ dashboardId: string; cardId: string }> = ({ dashboardId, cardId }) => {
  const me = useMe();
  const [messages, setMessages] = useState<DiscussionMessage[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const load = useCallback(() => dashApi.messages(dashboardId, cardId).then(setMessages).catch((e) => setError(e.message)), [dashboardId, cardId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    try { setMessages(await dashApi.postMessage(dashboardId, cardId, body)); setError(null); } catch (err) { setText(body); setError((err as Error).message); }
  };
  const remove = async (m: DiscussionMessage) => {
    setMessages((cur) => cur?.filter((x) => x.id !== m.id) ?? null);
    try { await dashApi.deleteMessage(m.id); } catch (err) { setError((err as Error).message); load(); }
  };
  return (
    <div className="flex h-full flex-col">
      <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-label="Messages">
        {messages === null ? <li className="text-xs text-gray-400">Loading…</li> : messages.length === 0 ? <li className="py-4 text-center text-xs text-gray-400">No messages yet. Start the conversation.</li> : messages.map((m) => (
          <li key={m.id} className="group flex items-start gap-2">
            {m.user ? <Avatar user={m.user} size={22} /> : <span className="h-[22px] w-[22px] rounded-full bg-gray-200" />}
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-500"><b className="font-medium text-gray-800">{m.user ? m.user.display_name || m.user.email : 'Someone'}</b> · {new Date(m.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</p>
              <p className="whitespace-pre-wrap text-sm text-gray-800">{m.body}</p>
            </div>
            {m.user?.id === me && <button type="button" title="Delete message" onClick={() => remove(m)} className="no-print rounded p-0.5 text-gray-300 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><Trash2 size={12} /></button>}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <form onSubmit={send} className="no-print mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} placeholder="Write a message…" aria-label="Message" className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none" />
        <button type="submit" title="Send" disabled={!text.trim()} className="rounded-md bg-indigo-600 p-1.5 text-white hover:bg-indigo-700 disabled:opacity-40"><Send size={13} /></button>
      </form>
    </div>
  );
};

const TaskListCard: React.FC<{ tasks: Task[]; total: number; onOpenTask: (id: string) => void; onMore: () => void }> = ({ tasks, total, onOpenTask, onMore }) => {
  if (!tasks.length) return <Empty />;
  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-[11px] font-medium text-gray-400">
          <tr><th className="py-1 pl-1 font-medium">Name</th><th className="w-28 font-medium">Assignee</th><th className="w-24 font-medium">Due</th></tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} onClick={() => onOpenTask(t.id)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
              <td className="py-1.5 pl-1">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={t.status} size={11} />
                  <span className={`truncate ${t.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.name}</span>
                </span>
              </td>
              <td><AvatarStack users={t.assignees} max={3} /></td>
              <td className={`text-xs ${t.is_overdue ? 'text-red-600' : 'text-gray-500'}`}>{formatDue(t.due_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > tasks.length && (
        <button type="button" onClick={onMore} className="mt-1 w-full py-1 text-center text-xs text-indigo-600 hover:underline">
          Show all {total}
        </button>
      )}
    </div>
  );
};

const OnlyYours: React.FC<{ seesEveryone: boolean }> = ({ seesEveryone }) =>
  seesEveryone ? null : <p className="mt-1 text-[11px] text-gray-400">Showing your time, and your Team's if you lead one.</p>;

const TimeReportCard: React.FC<{ rows: TimeRow[]; total: number; showEstimates: boolean; seesEveryone: boolean }> = ({ rows, total, showEstimates, seesEveryone }) => {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (!rows.length) return <div className="flex h-full flex-col"><Empty text="No time tracked in this period" /><OnlyYours seesEveryone={seesEveryone} /></div>;
  const top = Math.max(...rows.map((r) => r.seconds));
  return (
    <div className="h-full overflow-y-auto text-sm">
      {rows.map((r) => (
        <div key={r.key}>
          <button
            type="button"
            onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-gray-50"
          >
            {r.children.length > 0 ? (open.has(r.key) ? <ChevronDown size={13} className="text-gray-400" /> : <ChevronRight size={13} className="text-gray-400" />) : <span className="w-[13px]" />}
            <span className="w-36 shrink-0 truncate text-gray-800">{r.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-gray-100"><span className="block h-full rounded bg-indigo-500" style={{ width: `${(100 * r.seconds) / top}%` }} /></span>
            <span className="w-16 shrink-0 text-right font-medium text-gray-700">{formatDuration(r.seconds)}</span>
            {showEstimates && <span className="w-16 shrink-0 text-right text-xs text-gray-400">{formatDuration(r.estimate_seconds) || '–'} est.</span>}
          </button>
          {open.has(r.key) && r.children.map((c) => (
            <div key={c.key} className="flex items-center gap-2 py-0.5 pl-7 pr-1 text-xs text-gray-600">
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span>{formatDuration(c.seconds)}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-gray-100 px-1 pt-1.5 text-xs font-medium text-gray-700">
        <span>Total</span><span>{formatDuration(total)}</span>
      </div>
      <OnlyYours seesEveryone={seesEveryone} />
    </div>
  );
};

const TimesheetCard: React.FC<{ days: string[]; capacity: number[]; rows: { user: UserRef; seconds_per_day: number[]; total: number }[]; seesEveryone: boolean }> = ({ days, capacity, rows, seesEveryone }) => {
  if (!rows.length) return <div className="flex h-full flex-col"><Empty text="No time tracked in this period" /><OnlyYours seesEveryone={seesEveryone} /></div>;
  const tone = (value: number, cap: number) =>
    !value ? 'text-gray-300' : cap === 0 || value > cap ? 'bg-red-50 text-red-700' : value >= cap * 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800';
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white text-gray-400">
          <tr>
            <th className="py-1 pl-1 text-left font-medium">Person</th>
            {days.map((day) => {
              const d = new Date(`${day}T00:00:00`);
              return <th key={day} className={`px-1 text-center font-medium ${[0, 6].includes(d.getDay()) ? 'bg-gray-50' : ''}`}>{d.toLocaleDateString(undefined, { weekday: 'short' })} {d.getDate()}</th>;
            })}
            <th className="pr-1 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user.id} className="border-t border-gray-100">
              <td className="max-w-40 truncate py-1.5 pl-1 text-sm text-gray-800">{r.user.display_name || r.user.email}</td>
              {r.seconds_per_day.map((v, i) => (
                <td key={i} className="px-0.5 text-center"><span className={`inline-block min-w-11 rounded px-1 py-0.5 ${tone(v, capacity[i])}`}>{v ? formatDuration(v) : '–'}</span></td>
              ))}
              <td className="pr-1 text-right font-medium text-gray-700">{formatDuration(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <OnlyYours seesEveryone={seesEveryone} />
    </div>
  );
};

const PortfolioCard: React.FC<{ rows: PortfolioRow[] } & Pick<CardHandlers, 'onDrill'>> = ({ rows, onDrill }) => {
  if (!rows.length) return <Empty text="No Lists here" />;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-[11px] text-gray-400">
          <tr>
            <th className="py-1 pl-1 font-medium">List</th><th className="w-40 font-medium">Progress</th>
            <th className="w-14 text-right font-medium">Open</th><th className="w-16 text-right font-medium">Overdue</th>
            <th className="w-20 text-right font-medium">Estimated</th><th className="w-20 pr-1 text-right font-medium">Tracked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const over = r.estimate_seconds > 0 && r.tracked_seconds > r.estimate_seconds;
            return (
              <tr key={r.list_id} onClick={() => onDrill(r.list_id, r.path)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                <td className="max-w-0 truncate py-1.5 pl-1 text-gray-800" title={r.path}>{r.path}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-24 overflow-hidden rounded bg-gray-100"><span className="block h-full bg-emerald-500" style={{ width: `${r.progress}%` }} /></span>
                    <span className="text-xs text-gray-500">{r.progress}%</span>
                  </span>
                </td>
                <td className="text-right text-gray-600">{r.open}</td>
                <td className={`text-right ${r.overdue ? 'text-red-600' : 'text-gray-400'}`}>{r.overdue}</td>
                <td className="text-right text-gray-600">{formatDuration(r.estimate_seconds) || '–'}</td>
                <td className={`pr-1 text-right ${over ? 'font-medium text-red-600' : 'text-gray-600'}`}>{formatDuration(r.tracked_seconds) || '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
