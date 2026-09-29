import React, { useEffect, useState } from 'react';
import { AlarmClock, BarChart3, BatteryMedium, CheckCircle2, Clock, FileText, Flag, Gauge, Globe, Hash, LineChart, ListChecks, MessagesSquare, PieChart, Table2, Target, Timer, UserCheck, X } from 'lucide-react';
import { GoalPicker, SprintFolderPicker } from './goalPickers';
import { Portal } from '../ui';
import { useWork } from '../WorkContext';
import { workApi, type CustomField } from '../api';
import { dashApi, type Card, type CardConfig, type CardType, type GroupBy, type Period } from './api';
import { CARD_TYPES } from './cards';
import { FiltersEditor, SourcePicker } from './pickers';

const ICONS: Record<CardType, React.ReactNode> = {
  calculation: <Hash size={18} />, pie: <PieChart size={18} />, bar: <BarChart3 size={18} />, task_list: <ListChecks size={18} />,
  time_report: <Clock size={18} />, timesheet: <Timer size={18} />, portfolio: <Table2 size={18} />, notes: <FileText size={18} />,
  behind: <AlarmClock size={18} />, completed: <CheckCircle2 size={18} />, line: <LineChart size={18} />,
  discussion: <MessagesSquare size={18} />, embed: <Globe size={18} />,
  worked_on: <UserCheck size={18} />, battery: <BatteryMedium size={18} />, goal: <Target size={18} />, sprint: <Flag size={18} />,
  variance: <Gauge size={18} />, plan: <CheckCircle2 size={18} />,
  capacity: <Gauge size={18} />,
};

export const DEFAULT_CONFIG: CardConfig = {
  sources: [], include_subtasks: false, include_closed: false, filters: {}, measure: 'tasks', fn: 'count', unit: null,
  group_by: 'status', interval: 'day', donut: true, period: { preset: 'this_week' }, time_group_by: 'user', then_by: 'task',
  billable: 'all', show_estimates: false, sort: 'due', limit: 50, text: null,
};

const configFor = (type: CardType): CardConfig => ({
  ...DEFAULT_CONFIG,
  // Time is often tracked on subtasks, so time cards include them by default.
  include_subtasks: type === 'time_report' || type === 'timesheet' || type === 'portfolio' || type === 'capacity',
  // A line chart is a trend, so it starts on a date grouping.
  group_by: type === 'line' ? 'created_date' : type === 'battery' ? 'status_group' : type === 'worked_on' ? 'assignee' : DEFAULT_CONFIG.group_by,
  period: type === 'line' ? { preset: 'last_30_days' } : DEFAULT_CONFIG.period,
});

const CATEGORY_GROUPS: [GroupBy, string][] = [
  ['status', 'Status'], ['status_group', 'Status group'], ['assignee', 'Assignee'], ['priority', 'Priority'], ['tag', 'Tag'], ['list', 'List'],
];
const DATE_GROUPS: [GroupBy, string][] = [['done_date', 'Date completed'], ['created_date', 'Date created'], ['due_date', 'Due date']];
const PRESETS: [Period['preset'], string][] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'],
  ['last_7_days', 'Last 7 days'], ['this_month', 'This month'], ['last_month', 'Last month'], ['last_30_days', 'Last 30 days'],
  ['this_year', 'This year'], ['custom', 'Custom range'],
];
const WIDTHS: [number, string][] = [[3, 'Quarter'], [4, 'Third'], [6, 'Half'], [8, 'Two thirds'], [12, 'Full width']];

/** Which field types make sense to slice by, and which to add up. */
const GROUPABLE = ['dropdown', 'labels', 'checkbox', 'people', 'text', 'date'];
const ADDABLE = ['number', 'money', 'rating', 'progress'];

/** The custom fields defined anywhere in this workspace, offered alongside the built-ins.
 *  Defining "Review month" and then not being able to chart it is why nobody fills them in. */
function useCustomFields() {
  const { hierarchy } = useWork();
  const spaces = hierarchy?.spaces;
  const [fields, setFields] = useState<CustomField[]>([]);
  useEffect(() => {
    let live = true;
    Promise.all((spaces ?? []).map((sp) => workApi.fields('space', sp.id, true).catch(() => [] as CustomField[])))
      .then((lists) => {
        if (!live) return;
        const seen = new Map<string, CustomField>();
        for (const found of lists) for (const f of found) if (!seen.has(f.id)) seen.set(f.id, f);
        setFields([...seen.values()]);
      });
    return () => { live = false; };
  }, [spaces]);
  return fields;
}

const FieldOptions: React.FC<{ fields: CustomField[]; kinds: string[]; label: string }> = ({ fields, kinds, label }) => {
  const usable = fields.filter((f) => kinds.includes(f.type));
  if (!usable.length) return null;
  return <optgroup label={label}>{usable.map((f) => <option key={f.id} value={`custom:${f.id}`}>{f.name}</option>)}</optgroup>;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block text-xs font-medium text-gray-600">
    {label}
    <div className="mt-1 font-normal">{children}</div>
  </label>
);
const selectClass = 'block w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-800';

const PeriodEditor: React.FC<{ value: Period; onChange: (p: Period) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-3 gap-2">
    <Field label="Period">
      <select value={value.preset} onChange={(e) => onChange({ preset: e.target.value as Period['preset'] })} className={selectClass}>
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
    {value.preset === 'custom' && (
      <>
        <Field label="From"><input type="date" value={value.start ?? ''} onChange={(e) => onChange({ ...value, start: e.target.value })} className={selectClass} /></Field>
        <Field label="To"><input type="date" value={value.end ?? ''} onChange={(e) => onChange({ ...value, end: e.target.value })} className={selectClass} /></Field>
      </>
    )}
  </div>
);

export const CardEditor: React.FC<{
  dashboardId: string;
  card: Card | null; // null: add a new card
  onClose: () => void;
  onSaved: (card: Card) => void;
}> = ({ dashboardId, card, onClose, onSaved }) => {
  const customFields = useCustomFields();
  const [type, setType] = useState<CardType | null>(card?.type ?? null);
  const [title, setTitle] = useState(card?.title ?? '');
  const [config, setConfig] = useState<CardConfig>(card ? { ...DEFAULT_CONFIG, ...card.config } : DEFAULT_CONFIG);
  const [width, setWidth] = useState(card?.width ?? 6);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (t: CardType) => {
    const meta = CARD_TYPES.find((c) => c.type === t)!;
    setType(t);
    setTitle(meta.label);
    setConfig(configFor(t));
    setWidth(meta.width);
  };
  const set = <K extends keyof CardConfig>(key: K, v: CardConfig[K]) => setConfig((c) => ({ ...c, [key]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type || busy) return;
    setBusy(true);
    setError(null);
    try {
      const height = card?.height ?? CARD_TYPES.find((c) => c.type === type)!.height;
      const saved = card
        ? await dashApi.updateCard(dashboardId, card.id, { title: title.trim() || card.title, config, width })
        : await dashApi.addCard(dashboardId, { type, title: title.trim() || undefined, config, width, height });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isTime = type === 'time_report' || type === 'timesheet' || type === 'capacity';
  const usesData = type !== null && !['notes', 'discussion', 'embed', 'goal', 'sprint'].includes(type);

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <form
          role="dialog"
          aria-label={card ? 'Edit card' : 'Add card'}
          onMouseDown={(e) => e.stopPropagation()}
          onSubmit={save}
          className="flex max-h-[90vh] w-[40rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">{card ? `Edit “${card.title}”` : type ? `Add ${CARD_TYPES.find((c) => c.type === type)!.label}` : 'Add a card'}</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>

          {!type ? (
            <div className="grid grid-cols-1 gap-2 overflow-y-auto p-5 sm:grid-cols-2">
              {CARD_TYPES.map((c) => (
                <button key={c.type} type="button" onClick={() => pick(c.type)} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50/40">
                  <span className="mt-0.5 text-brand-600">{ICONS[c.type]}</span>
                  <span>
                    <span className="block text-sm font-medium text-gray-900">{c.label}</span>
                    <span className="block text-xs text-gray-500">{c.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={selectClass} /></Field></div>
                <Field label="Width">
                  <select value={width} onChange={(e) => setWidth(Number(e.target.value))} className={selectClass}>
                    {WIDTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>

              {type === 'calculation' && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Measure">
                    <select value={config.measure} onChange={(e) => { const m = e.target.value as CardConfig['measure']; setConfig((c) => ({ ...c, measure: m, fn: m === 'tasks' ? 'count' : c.fn === 'count' ? 'sum' : c.fn })); }} className={selectClass}>
                      <option value="tasks">Number of tasks</option><option value="time_estimate">Time estimate</option><option value="time_tracked">Time tracked</option>
                      <FieldOptions fields={customFields} kinds={ADDABLE} label="Custom fields" />
                    </select>
                  </Field>
                  <Field label="Calculation">
                    <select value={config.fn} disabled={config.measure === 'tasks'} onChange={(e) => set('fn', e.target.value as CardConfig['fn'])} className={selectClass}>
                      {config.measure === 'tasks' ? <option value="count">Count</option> : (
                        <><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></>
                      )}
                    </select>
                  </Field>
                  <Field label="Unit label"><input value={config.unit ?? ''} maxLength={12} placeholder="e.g. tasks" onChange={(e) => set('unit', e.target.value || null)} className={selectClass} /></Field>
                </div>
              )}

              {(type === 'pie' || type === 'bar') && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label={type === 'pie' ? 'Slice by' : 'X-axis'}>
                    <select value={config.group_by} onChange={(e) => set('group_by', e.target.value as GroupBy)} className={selectClass}>
                      {CATEGORY_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      <FieldOptions fields={customFields} kinds={GROUPABLE} label="Custom fields" />
                      {type === 'bar' && <optgroup label="Over time">{DATE_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>}
                    </select>
                  </Field>
                  <Field label={type === 'pie' ? 'Measure' : 'Y-axis'}>
                    <select value={config.measure} onChange={(e) => set('measure', e.target.value as CardConfig['measure'])} className={selectClass}>
                      <option value="tasks">Number of tasks</option><option value="time_estimate">Time estimate</option><option value="time_tracked">Time tracked</option>
                      <FieldOptions fields={customFields} kinds={ADDABLE} label="Custom fields" />
                    </select>
                  </Field>
                  {type === 'pie' && (
                    <label className="mt-5 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={config.donut} onChange={(e) => set('donut', e.target.checked)} /> Donut</label>
                  )}
                  {type === 'bar' && DATE_GROUPS.some(([v]) => v === config.group_by) && (
                    <Field label="Group by">
                      <select value={config.interval} onChange={(e) => set('interval', e.target.value as CardConfig['interval'])} className={selectClass}>
                        <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
                      </select>
                    </Field>
                  )}
                </div>
              )}
              {type === 'bar' && DATE_GROUPS.some(([v]) => v === config.group_by) && <PeriodEditor value={config.period} onChange={(p) => set('period', p)} />}

              {type === 'line' && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Trend of">
                      <select value={config.group_by} onChange={(e) => set('group_by', e.target.value as GroupBy)} className={selectClass}>
                        {DATE_GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </Field>
                    <Field label="Y-axis">
                      <select value={config.measure} onChange={(e) => set('measure', e.target.value as CardConfig['measure'])} className={selectClass}>
                        <option value="tasks">Number of tasks</option><option value="time_estimate">Time estimate</option><option value="time_tracked">Time tracked</option>
                      </select>
                    </Field>
                    <Field label="Per">
                      <select value={config.interval} onChange={(e) => set('interval', e.target.value as CardConfig['interval'])} className={selectClass}>
                        <option value="day">Day</option><option value="week">Week</option><option value="month">Month</option>
                      </select>
                    </Field>
                  </div>
                  <PeriodEditor value={config.period} onChange={(p) => set('period', p)} />
                </>
              )}

              {type === 'task_list' && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Sort by">
                    <select value={config.sort} onChange={(e) => set('sort', e.target.value as CardConfig['sort'])} className={selectClass}>
                      <option value="due">Due date</option><option value="priority">Priority</option><option value="updated">Recently updated</option><option value="name">Name</option>
                    </select>
                  </Field>
                  <Field label="Show up to"><input type="number" min={1} max={500} value={config.limit} onChange={(e) => set('limit', Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className={selectClass} /></Field>
                </div>
              )}

              {(isTime || type === 'completed' || type === 'worked_on') && <PeriodEditor value={config.period} onChange={(p) => set('period', p)} />}
              {type === 'goal' && <Field label="Goals to show"><GoalPicker value={config.goal_ids ?? []} onChange={(v) => set('goal_ids', v)} /></Field>}
              {type === 'sprint' && <Field label="Sprint Folder"><SprintFolderPicker value={config.folder_id ?? null} onChange={(v) => set('folder_id', v)} /></Field>}
              {type === 'time_report' && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Group by">
                    <select value={config.time_group_by} onChange={(e) => set('time_group_by', e.target.value as CardConfig['time_group_by'])} className={selectClass}>
                      <option value="user">Person</option><option value="list">List</option><option value="task">Task</option>
                    </select>
                  </Field>
                  <Field label="Then by">
                    <select value={config.then_by} onChange={(e) => set('then_by', e.target.value as CardConfig['then_by'])} className={selectClass}>
                      <option value="task">Task</option><option value="list">List</option><option value="none">Nothing</option>
                    </select>
                  </Field>
                  <Field label="Billable">
                    <select value={config.billable} onChange={(e) => set('billable', e.target.value as CardConfig['billable'])} className={selectClass}>
                      <option value="all">All time</option><option value="billable">Billable only</option><option value="non_billable">Non-billable only</option>
                    </select>
                  </Field>
                  <label className="col-span-3 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={config.show_estimates} onChange={(e) => set('show_estimates', e.target.checked)} /> Show time estimates next to tracked time</label>
                </div>
              )}

              {type === 'embed' && (
                <Field label="Link to show (https)">
                  <input type="url" value={config.url ?? ''} placeholder="https://docs.google.com/spreadsheets/…" onChange={(e) => set('url', e.target.value || null)} className={selectClass} />
                  <span className="mt-1 block text-xs text-gray-400">Google Sheets, Docs, Slides, YouTube and most https pages. Some sites refuse to be shown inside other apps.</span>
                </Field>
              )}
              {type === 'discussion' && <p className="text-sm text-gray-500">Everyone who can open this Dashboard can read and post messages here.</p>}

              {type === 'notes' && (
                <Field label="Text"><textarea rows={8} value={config.text ?? ''} onChange={(e) => set('text', e.target.value || null)} className={selectClass} /></Field>
              )}

              {usesData && (
                <>
                  <section>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Data from</h4>
                    <SourcePicker value={config.sources} onChange={(v) => set('sources', v)} />
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-700">
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={config.include_subtasks} onChange={(e) => set('include_subtasks', e.target.checked)} /> Include subtasks</label>
                      {!isTime && !['portfolio', 'behind', 'completed', 'battery', 'worked_on'].includes(type) && (
                        <label className="flex items-center gap-1.5"><input type="checkbox" checked={config.include_closed} onChange={(e) => set('include_closed', e.target.checked)} /> Include closed tasks</label>
                      )}
                    </div>
                  </section>
                  <section>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Filters</h4>
                    <FiltersEditor value={config.filters} onChange={(f) => set('filters', f)} peopleOnly={isTime} />
                  </section>
                  <p className="text-xs text-gray-400">
                    Everyone who opens this Dashboard sees this card with their own access: tasks they can't open are never counted for them.
                    {isTime && ' Tracked time shows only the viewer\'s own, their Team\'s if they lead one, or everyone\'s for admins.'}
                  </p>
                </>
              )}
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            </div>
          )}

          <footer className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            {!card && type ? <button type="button" onClick={() => setType(null)} className="text-sm text-gray-500 hover:underline">← Card types</button> : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="submit" disabled={!type || busy} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {card ? 'Save card' : 'Add card'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Portal>
  );
};
