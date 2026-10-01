import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CalendarRange, Clock, List as ListIcon, MessageSquare, Settings, Table2 } from 'lucide-react';
import { useWork, useMe } from '../WorkContext';
import { TaskPanel } from '../TaskPanel';
import { ListSkeleton } from '../Skeleton';
import { useRunningTimer } from '../RunningTimer';
import { Avatar } from '../ui';
import { useLeadership } from '../dashboards/dialogs';
import {
  STATUS_CLASS, STATUS_LABEL, isoDay, matchesSheetFilters, sheetApi,
  type Comment, type EntryUpdate, type SheetEntry, type SheetQuery, type SheetRow, type SheetSettings, type TimeTag, type Timesheet,
} from './api';
import { FEATURES } from '../../config/features';
import { Grid, type EntryActions } from './Grid';
import { SheetCalendar } from './SheetCalendar';
import { progressOf } from '../views/grouping';

/** Which of the three states a sheet row's task is in. */
const stateOf = (task: { status: { group: string } | null }) =>
  (task.status ? progressOf({ status: task.status } as never) : 'todo');
import { MyWorkloadView } from '../views/MyWorkloadView';
import { EntriesView, FilterBar } from './views';
import { WeekNav, hours } from './pieces';
import { AllTimesheets } from './AllTimesheets';
import { Approvals } from './Approvals';
import { SettingsDialog } from './SettingsDialog';
import { ask } from '../../components/ask';

type Tab = 'mine' | 'person' | 'all' | 'approvals';

/** The Timesheets hub: My timesheet, All timesheets, Approvals. */
export const TimesheetsPage: React.FC<{ tab: Tab }> = ({ tab }) => {
  const { workspace } = useWork();
  const { isAdmin, led } = useLeadership();
  const [settings, setSettings] = useState<SheetSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const loadSettings = useCallback(() => { if (workspace) sheetApi.settings(workspace.id).then(setSettings).catch(() => undefined); }, [workspace]);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const tabs = [
    // An admin is not filling in a timesheet of their own; the question they come here with is
    // whose hours are missing. The page still answers at /timesheets if they want theirs.
    { key: 'mine', label: 'My timesheet', to: '/timesheets', show: !isAdmin },
    { key: 'all', label: 'All timesheets', to: '/timesheets/all', show: isAdmin || led.length > 0 },
    { key: 'approvals', label: 'Approvals', to: '/timesheets/approvals', show: isAdmin || !!settings?.approvals_enabled },
  ];
  const shown = tabs.filter((t) => t.show);
  const active = tab === 'person' ? 'all' : tab;

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50/70">
      <header className="flex items-center gap-6 border-b border-gray-200 bg-white px-6">
        <span className="flex items-center gap-2 py-3 text-[15px] text-gray-800"><Clock size={17} /> Timesheets</span>
        {/* One tab is not a choice, and next to the heading it reads as the same word twice. */}
        {shown.length > 1 && (
          <>
            <span className="h-6 w-px bg-gray-200" />
            <nav className="flex items-center gap-5" aria-label="Timesheet pages">
              {shown.map((t) => (
                <Link key={t.key} to={t.to} className={`-mb-px border-b-2 py-3 text-[15px] no-underline ${active === t.key ? 'border-gray-900 font-medium text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {t.label}
                </Link>
              ))}
            </nav>
          </>
        )}
        {/* Hours, the week's shape and approvals are company policy, not a personal
            preference, so the whole dialog belongs to owners and admins -- Team leads included. */}
        {isAdmin && (
          <button type="button" onClick={() => setShowSettings(true)} className="ml-auto flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            <Settings size={14} /> Settings
          </button>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-6">
        {tab === 'all' ? <AllTimesheets /> : tab === 'approvals' ? <Approvals settings={settings} /> : isAdmin ? <AllTimesheets /> : <SheetPage />}
      </main>
      {showSettings && settings && isAdmin && <SettingsDialog settings={settings} onClose={() => setShowSettings(false)} onSaved={loadSettings} />}
    </div>
  );
};

// --- one person's week ----------------------------------------------------------------------------

type SheetView = 'timesheet' | 'calendar' | 'workload' | 'entries';

/** The ways of looking at one week, each with its own colour, as in My Tasks. */
const SHEET_VIEWS: {
  key: SheetView; label: string; Icon: React.ElementType; hint: string;
  tint: string; badge: string; mineOnly?: boolean;
}[] = [
  {
    key: 'timesheet', label: 'Timesheet', Icon: Table2, hint: 'The week as a grid, task by day',
    tint: 'text-teal-700 border-teal-500', badge: 'bg-teal-100 text-teal-700',
  },
  {
    key: 'calendar', label: 'Calendar', Icon: CalendarDays, hint: 'When the hours actually happened',
    tint: 'text-sky-700 border-sky-500', badge: 'bg-sky-100 text-sky-700',
  },
  {
    key: 'workload', label: 'Workload', Icon: CalendarRange, hint: 'What these days were meant to hold',
    tint: 'text-purple-700 border-purple-500', badge: 'bg-purple-100 text-purple-700', mineOnly: true,
  },
];

const SheetPage: React.FC = () => {
  const { workspace, listName, refresh: refreshTree } = useWork();
  const meId = useMe();
  const { userId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { version, start: startTimer } = useRunningTimer();
  const day = params.get('week') || isoDay(new Date());
  const asked = params.get('view');
  // A view that is no longer offered falls back to the grid, so an old bookmark to ?view=calendar
  // lands somewhere real rather than on a page with no way back.
  const view: SheetView = SHEET_VIEWS.some((v) => (
    v.key === asked && (v.key === 'timesheet' || FEATURES.timesheetExtraViews)
  )) ? (asked as SheetView) : 'timesheet';
  const whose = userId && userId !== meId ? userId : undefined;

  const [sheet, setSheet] = useState<Timesheet | null>(null);
  const [query, setQuery] = useState<SheetQuery>({ billable: 'all', sort: 'name' });
  const [tags, setTags] = useState<TimeTag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [review, setReview] = useState<'approve' | 'request-changes' | 'reopen' | 'submit' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!workspace) return;
    const mine = ++seq.current;
    try {
      const data = await sheetApi.get(workspace.id, day, { ...query, userId: whose });
      if (mine === seq.current) { setSheet(data); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    }
  }, [workspace, day, query, whose]);
  useEffect(() => { load(); }, [load, version]);
  useEffect(() => { if (workspace) sheetApi.tags(workspace.id).then(setTags).catch(() => undefined); }, [workspace]);

  const go = (d: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('week', d); return n; });
  const setView = (v: SheetView) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'timesheet') n.delete('view'); else n.set('view', v); return n; });

  const run = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); await load(); } catch (e) { setError((e as Error).message); }
  };
  const actions: EntryActions = {
    tags,
    onUpdate: (entry: SheetEntry, body: EntryUpdate) => run(() => sheetApi.updateEntry(entry.id, body)),
    onDelete: (entry: SheetEntry) => run(async () => { if (await ask.confirm({ danger: true, title: 'Delete this time entry?' })) await sheetApi.deleteEntry(entry.id); }),
    onCreateTag: async (name: string) => {
      const tag = await sheetApi.createTag(workspace!.id, name);
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      return tag;
    },
  };

  if (!sheet) {
    return error
      ? <div className="py-10 text-center text-sm text-red-700">{error}</div>
      : <div className="mt-6"><ListSkeleton rows={6} label="Loading timesheet" /></div>;
  }
  // The task filters are applied in the browser: the sheet is already one person's week, so
  // asking the server again would be a round trip for rows it has just sent.
  const kept = sheet.rows.filter((r) => matchesSheetFilters(r.task, query, stateOf));
  const shownSheet = kept.length === sheet.rows.length ? sheet : { ...sheet, rows: kept };
  const editable = sheet.can_edit;
  const sub = sheet.submission;
  const own = !whose;
  const shownViews = SHEET_VIEWS.filter((v) => (
    (own || !v.mineOnly) && (v.key === 'timesheet' || FEATURES.timesheetExtraViews)
  ));
  const deleteRow = async (row: SheetRow) => {
    if (row.total_seconds && !await ask.confirm({ danger: true, title: `Delete all ${hours(row.total_seconds)} tracked on “${row.task.name}” this week?` })) return;
    run(() => sheetApi.deleteRow(workspace!.id, { user_id: whose, task_id: row.task.id, start: sheet.period_start }));
  };

  return (
    <div className="mx-auto max-w-[1500px]">
      {whose && (
        <button type="button" onClick={() => navigate(`/timesheets/all?week=${sheet.period_start}`)} className="mb-3 flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft size={14} /> All timesheets
        </button>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {whose && <span className="flex items-center gap-2 text-lg font-medium text-gray-900"><Avatar user={sheet.user} size={28} /> {sheet.user.display_name || sheet.user.email}</span>}
        <WeekNav start={sheet.period_start} end={sheet.period_end} onGo={go} />
        {FEATURES.timesheetFillFromPlanner && editable && !sheet.locked && (
          <button type="button" title="Log the week's finished Planner blocks as time" onClick={() => run(async () => {
            const out = await sheetApi.prefill(workspace!.id, sheet.period_start, whose);
            setNote(out.entries ? `Added ${out.entries} ${out.entries === 1 ? 'entry' : 'entries'} (${hours(out.seconds)}) from the Planner.` : 'Nothing new to add from the Planner this week.');
          })} className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><CalendarDays size={14} /> Fill from Planner</button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {sub && sub.status !== 'withdrawn' && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[sub.status]}`}>{STATUS_LABEL[sub.status]}</span>
          )}
          {own && sheet.approvals_enabled && (!sub || sub.status === 'withdrawn' || sub.status === 'changes_needed') && (
            <button type="button" onClick={() => setReview('submit')} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              {sub?.status === 'changes_needed' ? 'Resubmit for approval' : 'Submit for approval'}
            </button>
          )}
          {own && sub?.status === 'pending' && (
            <button type="button" onClick={() => run(() => sheetApi.decide(sub.id, 'withdraw'))} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Withdraw</button>
          )}
          {sub?.can_review && sub.status === 'pending' && (
            <>
              <button type="button" onClick={() => setReview('request-changes')} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Request changes</button>
              <button type="button" onClick={() => setReview('approve')} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Approve</button>
            </>
          )}
          {sub?.can_review && sub.status === 'approved' && (
            <button type="button" onClick={() => setReview('reopen')} className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Reopen</button>
          )}
        </div>
      </div>

      {sheet.locked && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This timesheet is {sub?.status === 'approved' ? 'approved' : 'waiting for approval'}, so its time is locked.
          {own && sub?.status === 'pending' && ' Withdraw it to make changes.'}
          {!editable ? '' : ' As an admin you can still change it.'}
        </p>
      )}
      {sub?.status === 'changes_needed' && own && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Changes were requested on this timesheet. Update it and resubmit.</p>}

      {/* One view means nothing to switch between, so the strip only appears when there is
          more than one. Workload is yours alone -- it is built from your dates and your
          capacity -- so it is not offered on someone else's sheet either way. */}
      {shownViews.length > 1 && (
      <div className="mt-5 flex items-center gap-1 border-b border-gray-200">
        {shownViews.map((v) => {
          const on = v.key === view;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={on}
              title={v.hint}
              onClick={() => setView(v.key)}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-sm transition-colors ${
                on ? `${v.tint} font-semibold` : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded ${v.badge} ${on ? '' : 'opacity-80'}`}>
                <v.Icon size={13} />
              </span>
              {v.label}
            </button>
          );
        })}
      </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {view === 'timesheet' && <FilterBar query={query} onChange={setQuery} tags={tags} rows={sheet.rows} />}
        {FEATURES.timesheetEntriesView && (
          <div className="flex rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Display">
            <button type="button" role="tab" aria-selected={view === 'timesheet'} onClick={() => setView('timesheet')} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${view === 'timesheet' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}><Table2 size={14} /> Timesheet</button>
            <button type="button" role="tab" aria-selected={view === 'entries'} onClick={() => setView('entries')} className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm ${view === 'entries' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}><ListIcon size={14} /> Time entries</button>
          </div>
        )}
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {note && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{note}</p>}

      <div className="mt-4">
        {view === 'calendar' ? (
          <SheetCalendar sheet={shownSheet} onOpenTask={setOpenTask} />
        ) : view === 'workload' ? (
          <div className="-mx-6">
            <MyWorkloadView onOpenTask={setOpenTask} listName={(id) => listName(id)} />
          </div>
        ) : view === 'timesheet' || !FEATURES.timesheetEntriesView ? (
          <Grid
            sheet={shownSheet}
            editable={editable}
            onCell={(taskId, i, seconds) => run(() => sheetApi.setCell(workspace!.id, { user_id: whose, task_id: taskId, day: sheet.days[i], seconds }))}
            forUserId={whose}
            onLogged={load}
            onDeleteRow={deleteRow}
            onOpenTask={setOpenTask}
            onStartTimer={own ? (taskId) => run(() => startTimer(taskId)) : undefined}
            onAddTask={(taskId) => run(() => sheetApi.addRow(workspace!.id, { user_id: whose, task_id: taskId, start: sheet.period_start }))}
            actions={actions}
          />
        ) : (
          <EntriesView sheet={sheet} editable={editable} actions={actions} onOpenTask={setOpenTask} />
        )}
      </div>

      {sub && sub.status !== 'withdrawn' && <SubmissionThread submissionId={sub.id} key={`${sub.id}:${sub.status}`} />}

      {review && (
        <DecisionDialog
          kind={review}
          onClose={() => setReview(null)}
          onConfirm={async (comment) => {
            await run(async () => {
              if (review === 'submit') await sheetApi.submit(workspace!.id, sheet.period_start, comment);
              else await sheetApi.decide(sub!.id, review, comment);
            });
            setReview(null);
          }}
          summary={`${hours(sheet.total_seconds)} tracked · ${hours(sheet.billable_per_day.reduce((a, b) => a + b, 0))} billable · capacity ${hours(sheet.capacity_per_day.reduce((a, b) => a + b, 0))}`}
        />
      )}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => { load(); refreshTree(); }} onOpen={setOpenTask} />}
    </div>
  );
};

const DIALOG_TEXT = {
  submit: { title: 'Submit timesheet for approval', button: 'Submit', hint: 'Your time for this week will be locked while it is reviewed.', required: false },
  approve: { title: 'Approve timesheet', button: 'Approve', hint: 'The week stays locked once approved.', required: false },
  'request-changes': { title: 'Request changes', button: 'Request changes', hint: 'The timesheet unlocks so it can be corrected and resubmitted.', required: false },
  reopen: { title: 'Reopen approved timesheet', button: 'Reopen', hint: 'Say why: the timesheet unlocks and goes back to "Changes needed".', required: true },
} as const;

const DecisionDialog: React.FC<{ kind: keyof typeof DIALOG_TEXT; summary: string; onClose: () => void; onConfirm: (comment: string) => Promise<void> }> = ({ kind, summary, onClose, onConfirm }) => {
  const text = DIALOG_TEXT[kind];
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
      <div role="dialog" aria-label={text.title} onMouseDown={(e) => e.stopPropagation()} className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-5 shadow-xl">
        <h3 className="font-semibold text-gray-900">{text.title}</h3>
        <p className="mt-1 text-sm text-gray-600">{summary}</p>
        <p className="mt-1 text-xs text-gray-500">{text.hint}</p>
        <textarea autoFocus value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder={text.required ? 'Reason (required)' : 'Comment (optional)'} className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" disabled={busy || (text.required && !comment.trim())} onClick={async () => { setBusy(true); try { await onConfirm(comment.trim()); } finally { setBusy(false); } }} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{text.button}</button>
        </div>
      </div>
    </div>
  );
};

const EVENT_TEXT: Record<string, string> = {
  submitted: 'submitted this timesheet', approved: 'approved it', changes_requested: 'requested changes',
  reopened: 'reopened it', withdrawn: 'withdrew it',
};

const SubmissionThread: React.FC<{ submissionId: string }> = ({ submissionId }) => {
  const [items, setItems] = useState<Comment[]>([]);
  const [body, setBody] = useState('');
  useEffect(() => { sheetApi.comments(submissionId).then(setItems).catch(() => undefined); }, [submissionId]);
  return (
    <section className="mt-6 max-w-2xl rounded-xl border border-gray-200 bg-white p-4" aria-label="Approval activity">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800"><MessageSquare size={15} /> Approval activity</h3>
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.id} className="text-sm">
            <span className="font-medium text-gray-800">{c.user?.display_name || c.user?.email || 'Someone'}</span>{' '}
            <span className="text-gray-500">{c.event ? EVENT_TEXT[c.event] ?? c.event : 'commented'} · {new Date(c.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            {c.body && <p className="mt-0.5 whitespace-pre-wrap rounded bg-gray-50 px-2 py-1 text-gray-700">{c.body}</p>}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) sheetApi.comment(submissionId, body.trim()).then((x) => { setItems(x); setBody(''); }); }}>
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
        <button type="submit" disabled={!body.trim()} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Comment</button>
      </form>
    </section>
  );
};
