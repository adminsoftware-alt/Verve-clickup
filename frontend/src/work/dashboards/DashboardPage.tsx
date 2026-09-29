import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FEATURES } from '../../config/features';
import { FavoriteStar } from '../Favorites';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3, ChevronRight, Copy, Download, Expand, FileSpreadsheet, Filter, GripVertical, ImageDown, LayoutDashboard, Mail, MoreHorizontal, Pencil, PieChart as PieChartIcon, Plus, Printer, RefreshCw,
  RotateCcw, Share2, Trash2, Undo2, Users,
} from 'lucide-react';
import { useWork } from '../WorkContext';
import { TaskPanel } from '../TaskPanel';
import { Menu, NameDialog } from '../ui';
import { Check, ChevronDown } from 'lucide-react';
import { useNow } from '../RunningTimer';
import { dashApi, type Card, type CardData, type Dashboard, type Filters, type Period } from './api';
import { CardBody } from './cards';
import { PeriodBar, PeriodMenu, StatCard, followsPeriod, periodLabel } from './StatRow';
import { ANY_TIME, CardFilterMenu } from './CardFilters';
import { WorkloadPanel } from './WorkloadPanel';
import { CardEditor } from './CardEditor';
import { DrillDialog, Modal, ReportsDialog, RepointDialog, ShareDashboardDialog, useLeadership } from './dialogs';
import { FiltersEditor, useFilterSummary } from './pickers';
import { cardRows, chartIn, exportCardCsv, exportCardPng } from './exportCard';
import { ask } from '../../components/ask';

const ROW_PX = 110;
const GAP_PX = 12;
const AUTO_REFRESH_MS = 30 * 60 * 1000; // as in ClickUp
const UNDO_LIMIT = 5;

type Layout = { id: string; width: number; height: number }[];
const layoutOf = (cards: Card[]): Layout => cards.map((c) => ({ id: c.id, width: c.width, height: c.height }));

/** What "no period" means on this card, which depends on whether finished work counts. */
const anyLabel = (card: Card) => (card.config.include_closed ? 'All work' : 'All open work');

/** "Total 24 tasks across all priorities" -- what the chart adds up to, said in words. */
function chartSubtitle(card: Card, row: CardData | undefined): string {
  const segments = (row?.data as { segments?: { value: number }[] } | undefined)?.segments;
  if (!row || !segments) return 'Loading…';
  const total = segments.reduce((n, sg) => n + sg.value, 0);
  const unit = card.config.measure === 'tasks' ? `task${total === 1 ? '' : 's'}` : 'hours';
  const by = card.config.group_by === 'priority' ? 'priorities'
    : card.config.group_by === 'assignee' ? 'people'
    : card.config.group_by === 'status' || card.config.group_by === 'status_group' ? 'statuses'
    : card.config.group_by === 'list' ? 'Lists'
    : card.config.group_by === 'tag' ? 'tags'
    : 'groups';
  return `Total ${total.toLocaleString()} ${unit} across all ${by}`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

const RELATION_NOTE: Record<string, string> = {
  my_team: 'A Dashboard of someone in your Team — view only.',
  everyone: 'You can see this as an admin — view only.',
  shared: 'Shared with you.',
};

/**
 * A card Dashboard. On its own page by default; `embedded` shows one inside a Space/Folder/List Dashboard view,
 * where deleting it goes back to the standard view summary.
 */
const TIME_CARDS = ['timesheet', 'time_report', 'capacity', 'variance', 'completed', 'worked_on'];
/** A single day is too short to say anything about an on-time habit, so that card starts at a week. */
const periodChoices = (card: Card): [Period['preset'], string][] =>
  (card.type === 'completed' ? CARD_PERIODS.filter(([v]) => v !== 'today' && v !== 'yesterday') : CARD_PERIODS);

/** Cards with a task query behind them, which is what the filters narrow. */
const FILTERABLE = [
  'bar', 'pie', 'line', 'task_list', 'portfolio', 'behind', 'completed', 'worked_on', 'battery', 'plan',
  'time_report', 'timesheet', 'capacity', 'variance',
];
/** Time cards are filtered by whose hours they show, not by how the task is set up. */
const PEOPLE_ONLY_FILTERS = ['time_report', 'timesheet', 'capacity'];
/** Cards that read perfectly well with no window at all, as everything still open. */
const CAN_DROP_PERIOD = ['bar', 'pie', 'line', 'task_list', 'portfolio', 'behind', 'battery', 'plan'];
/** The due-date shapes that are not a window, offered in the same list as the windows are. */
const DUE_SHAPES: { value: string; label: string }[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'this_week', label: 'Due this week' },
  { value: 'next_7_days', label: 'Due in the next 7 days' },
  { value: 'set', label: 'Has a due date' },
  { value: 'none', label: 'No due date' },
];

const CARD_PERIODS: [Period['preset'], string][] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'],
  ['last_7_days', 'Last 7 days'], ['this_month', 'This month'], ['last_month', 'Last month'],
  ['last_30_days', 'Last 30 days'], ['this_quarter', 'This quarter'], ['this_year', 'This year'],
];

/** The window dropdown on a card header, over the same choices its filter panel offers. */
const ScopeMenu: React.FC<{
  time: { value: string; options: { value: string; label: string }[]; onPick: (value: string) => void; onCustom: () => void };
  disabled?: boolean;
}> = ({ time, disabled }) => {
  const current = time.options.find((o) => o.value === time.value)?.label ?? 'Custom range';
  if (disabled) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500">
        {current}
      </span>
    );
  }
  const tick = (on: boolean) => (on ? <Check size={14} className="text-teal-600" /> : <span className="w-3.5" />);
  return (
    <Menu
      align="right"
      label="What this card covers"
      items={[
        ...time.options.map((o) => ({ label: o.label, icon: tick(o.value === time.value), onClick: () => time.onPick(o.value) })),
        { label: 'Custom range…', icon: tick(false), onClick: time.onCustom },
      ]}
      trigger={
        <span className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:bg-gray-50">
          {current}
          <ChevronDown size={13} className="text-gray-400" />
        </span>
      }
    />
  );
};

export const DashboardPage: React.FC<{
  dashboardId?: string;
  embedded?: { onReset: () => void };
  /** A title of its own instead of the "Dashboards >" trail; false for no title at all,
   *  which is what the Dashboard the app opens on wants -- you know whose it is. */
  heading?: string | false;
  /** Shown above the cards, on the Dashboard the app opens on. */
  intro?: React.ReactNode;
}> = ({ dashboardId, embedded, heading, intro }) => {
  const params = useParams();
  const id = dashboardId ?? params.id ?? '';
  const navigate = useNavigate();
  const { refresh: refreshTree } = useWork();
  const { isGuest } = useLeadership();
  const filterSummary = useFilterSummary();

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [data, setData] = useState<Record<string, CardData>>({});
  const [loadedAt, setLoadedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [undo, setUndo] = useState<Layout[]>([]);
  const [dialog, setDialog] = useState<
    | { type: 'card'; card: Card | null } | { type: 'share' } | { type: 'reports' } | { type: 'rename' } | { type: 'repoint' }
    | { type: 'filters' } | { type: 'duplicate' } | { type: 'drill'; cardId: string; segment?: string; title: string }
    | { type: 'expand'; cardId: string } | null
  >(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const now = useNow(true, 30_000);

  const canEdit = dash?.your_level === 'edit' || dash?.your_level === 'full';
  const canDelete = dash?.your_level === 'full';

  // A full read replaces every card's data at once, so a card someone re-scoped while the read
  // was in flight would be quietly overwritten with the old period. Each single-card update bumps
  // this, and a batch that started earlier then leaves the newer cards alone.
  const edits = useRef(0);

  const loadData = useCallback(async () => {
    const at = edits.current;
    try {
      const rows = await dashApi.data(id);
      setData((prev) => {
        const fresh = Object.fromEntries(rows.map((r) => [r.card_id, r]));
        if (at === edits.current) return fresh;
        // Something was re-scoped mid-flight: keep what we already hold for those cards.
        return Object.fromEntries(rows.map((r) => [r.card_id, prev[r.card_id] ?? r]));
      });
      setLoadedAt(Date.now());
    } catch (e) { setError((e as Error).message); }
  }, [id]);

  const load = useCallback(async () => {
    try {
      setError(null);
      setDash(await dashApi.get(id));
      await loadData();
    } catch (e) { setError((e as Error).message); }
  }, [id, loadData]);

  useEffect(() => { setDash(null); setData({}); setEditMode(false); setUndo([]); load(); }, [load]);
  useEffect(() => {
    if (!dash?.auto_refresh) return;
    const timer = setInterval(loadData, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [dash?.auto_refresh, loadData]);

  const refreshCard = async (cardId: string) => {
    edits.current += 1;
    try {
      const row = await dashApi.cardData(id, cardId);
      setData((prev) => ({ ...prev, [cardId]: row }));
    } catch (e) { setError((e as Error).message); }
  };

  // --- layout ---------------------------------------------------------------------------

  const saveLayout = async (next: Layout, remember = true) => {
    if (!dash) return;
    if (remember) setUndo((u) => [...u.slice(-(UNDO_LIMIT - 1)), layoutOf(dash.cards)]);
    const byId = new Map(dash.cards.map((c) => [c.id, c]));
    setDash({ ...dash, cards: next.map((l, i) => ({ ...byId.get(l.id)!, ...l, position: i })) });
    try { setDash(await dashApi.layout(id, next)); } catch (e) { setError((e as Error).message); load(); }
  };
  const undoLayout = () => {
    const previous = undo[undo.length - 1];
    if (!previous || !dash) return;
    setUndo((u) => u.slice(0, -1));
    // Cards added or removed since then cannot be undone into the layout.
    const ids = new Set(dash.cards.map((c) => c.id));
    if (previous.length === ids.size && previous.every((l) => ids.has(l.id))) saveLayout(previous, false);
  };
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        undoLayout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const moveBefore = (dragId: string, targetId: string) => {
    if (!dash || dragId === targetId) return;
    const current = layoutOf(dash.cards);
    const moving = current.find((l) => l.id === dragId)!;
    const rest = current.filter((l) => l.id !== dragId);
    const at = rest.findIndex((l) => l.id === targetId);
    rest.splice(at, 0, moving);
    saveLayout(rest);
  };

  const startResize = (e: React.PointerEvent, card: Card) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid || !dash) return;
    const colPx = (grid.clientWidth - GAP_PX * 11) / 12 + GAP_PX;
    const startX = e.clientX, startY = e.clientY;
    const original = { width: card.width, height: card.height };
    let latest = original;
    const onMove = (ev: PointerEvent) => {
      const width = Math.max(1, Math.min(12, original.width + Math.round((ev.clientX - startX) / colPx)));
      const height = Math.max(1, Math.min(6, original.height + Math.round((ev.clientY - startY) / (ROW_PX + GAP_PX))));
      if (width !== latest.width || height !== latest.height) {
        latest = { width, height };
        setDash((d) => d && { ...d, cards: d.cards.map((c) => (c.id === card.id ? { ...c, width, height } : c)) });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (latest.width !== original.width || latest.height !== original.height) {
        setUndo((u) => [...u.slice(-(UNDO_LIMIT - 1)), layoutOf(dash.cards)]);
        dashApi.layout(id, layoutOf(dash.cards).map((l) => (l.id === card.id ? { ...l, ...latest } : l))).then(setDash).catch((err) => setError(err.message));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // --- actions ------------------------------------------------------------------------------

  const act = async (action: () => Promise<unknown>) => {
    try { setError(null); await action(); } catch (e) { setError((e as Error).message); }
  };
  const removeCard = async (card: Card) => await ask.confirm({ danger: true, title: `Remove the “${card.title}” card?` }) && act(async () => {
    await dashApi.removeCard(id, card.id);
    setUndo([]); // adding or removing a card resets undo, as in ClickUp
    await load();
  });
  const duplicateCard = (card: Card) => act(async () => { await dashApi.duplicateCard(id, card.id); setUndo([]); await load(); });
  const removeDashboard = async () => dash && await ask.confirm(embedded
    ? 'Go back to the standard dashboard for this view? The cards, discussions and email reports here will be deleted.'
    : `Delete the “${dash.name}” Dashboard and its email reports? This cannot be undone.`) && act(async () => {
    await dashApi.remove(id);
    if (embedded) embedded.onReset(); else navigate('/dashboards');
  });
  const exportCard = (card: Card, as: 'csv' | 'png') => act(async () => {
    if (as === 'csv') return exportCardCsv(card, cardRows(card, data[card.id]));
    const svg = chartIn(gridRef.current?.querySelector(`[data-card-id="${card.id}"]`) ?? null);
    if (svg) await exportCardPng(card, svg);
  });
  const cardMenu = (card: Card) => {
    const hasRows = cardRows(card, data[card.id]).length > 0;
    const isChart = card.type === 'pie' || card.type === 'bar' || card.type === 'line';
    return [
      ...(canEdit ? [
        { label: 'Edit card', icon: <Pencil size={14} />, onClick: () => setDialog({ type: 'card', card }) },
        { label: 'Duplicate card', icon: <Copy size={14} />, onClick: () => duplicateCard(card) },
      ] : []),
      ...(hasRows ? [{ label: 'Export as CSV', icon: <FileSpreadsheet size={14} />, onClick: () => exportCard(card, 'csv') }] : []),
      ...(isChart && hasRows ? [{ label: 'Download image (PNG)', icon: <ImageDown size={14} />, onClick: () => exportCard(card, 'png') }] : []),
      ...(canEdit ? [{ label: 'Delete card', icon: <Trash2 size={14} />, danger: true, onClick: () => removeCard(card) }] : []),
    ];
  };
  const saveFilters = (filters: Filters) => act(async () => { setDash(await dashApi.update(id, { filters })); setDialog(null); await loadData(); });

  /** Change what a time card covers, from the card itself. "Custom range" opens the editor. */
  // --- the stat row -------------------------------------------------------------------------
  // The single-number cards read as a row of their own above the charts, under one period control.
  // While the layout is being arranged they go back into the grid, so they can be moved like
  // anything else.
  const statCards = editMode ? [] : (dash?.cards ?? []).filter((c) => c.type === 'calculation' && c.height === 1);
  // The hours card reads as a band of its own across the page, not as one tile in the grid.
  const workloadCards = editMode ? [] : (dash?.cards ?? []).filter((c) => c.type === 'capacity');
  // "Completed tasks" is off the Dashboard. It still renders wherever the flag is on, and
  // boards that already carry one are simply not shown it rather than having it deleted.
  const hiddenCards = (dash?.cards ?? []).filter((c) => (
    (!FEATURES.dashboardCompletedCard && c.type === 'completed')
    // By name, not by type: a board's other task lists ("Nobody is on these") are still wanted.
    || (!FEATURES.dashboardToDoCard && c.type === 'task_list' && c.title === 'To do')
  ));
  const outOfGrid = new Set([...statCards, ...workloadCards, ...hiddenCards].map((c) => c.id));
  // Only show a period as chosen once every date-shaped card is actually on it; until then the
  // cards keep the windows they were built with and the control shows nothing selected.
  const rowPeriod: Period | null = (() => {
    const moving = statCards.filter(followsPeriod);
    if (!moving.length) return null;
    const scoped = moving.filter((c) => c.config.filters.due === 'period' || c.config.filters.done === 'period');
    if (scoped.length !== moving.length) return null;
    const first = scoped[0].config.period;
    const same = (p: Period) => p.preset === first.preset && p.start === first.start && p.end === first.end;
    return scoped.every((c) => same(c.config.period)) ? first : null;
  })();

  /** Re-scope every date-shaped stat card, and retitle it so the number and its label agree. */
  const applyRowPeriod = (period: Period) => {
    const label = periodLabel(period);
    const moving = statCards.filter(followsPeriod);
    if (!moving.length) return;
    edits.current += 1;
    act(async () => {
      for (const card of moving) {
        const filters = { ...card.config.filters };
        if (filters.done) filters.done = 'period';
        else if (filters.due) filters.due = 'period';
        // Only retitle the standard wording, so a card someone renamed keeps its name.
        const word = filters.done ? 'Done' : 'Due';
        const title = /^(Due|Done)\b/.test(card.title) ? `${word} ${label}` : card.title;
        const saved = await dashApi.updateCard(id, card.id, { title, config: { ...card.config, period, filters } });
        setDash((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === saved.id ? saved : c)) } : prev));
        const fresh = await dashApi.cardData(id, card.id);
        setData((prev) => ({ ...prev, [card.id]: fresh }));
      }
    });
  };

/**
   * Scope a card by due date: to everything still open (ANY_TIME), to a shape like "overdue",
   * or to a window, which is stored as the card's period with the filter pointing at it.
   */
  const setDueScope = (card: Card, choice: string) => {
    edits.current += 1;
    act(async () => {
      const filters = { ...card.config.filters };
      const window = CARD_PERIODS.some(([v]) => v === choice);
      if (choice === ANY_TIME) delete filters.due;
      else filters.due = (window ? 'period' : choice) as Filters['due'];
      const config = { ...card.config, filters, ...(window ? { period: { preset: choice as Period['preset'] } } : {}) };
      const saved = await dashApi.updateCard(id, card.id, { config });
      setDash((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === saved.id ? saved : c)) } : prev));
      const fresh = await dashApi.cardData(id, card.id);
      setData((prev) => ({ ...prev, [card.id]: fresh }));
    });
  };

  /** Save a period straight onto a card, for controls that pick an exact range. */
  const setCardPeriod = (card: Card, period: Period) => {
    edits.current += 1;
    act(async () => {
      const saved = await dashApi.updateCard(id, card.id, { config: { ...card.config, period } });
      setDash((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === saved.id ? saved : c)) } : prev));
      const fresh = await dashApi.cardData(id, card.id);
      setData((prev) => ({ ...prev, [card.id]: fresh }));
    });
  };

  /** Filter one card from its own header, rather than through the editor. */
  const setCardFilters = (card: Card, filters: Filters) => {
    edits.current += 1;
    act(async () => {
      const saved = await dashApi.updateCard(id, card.id, { config: { ...card.config, filters } });
      setDash((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === saved.id ? saved : c)) } : prev));
      const fresh = await dashApi.cardData(id, card.id);
      setData((prev) => ({ ...prev, [card.id]: fresh }));
    });
  };

  /**
   * The Time entry in a card's filter panel.
   *
   * Two kinds of card hold their window differently. A chart or a task list is scoped by filtering
   * on the due date, so it can be set to no window at all -- everything still open. A timesheet,
   * a capacity band or an estimate-against-actual card *is* a window, so it only moves between
   * them. Both are offered the same way, because from the outside they are the same question.
   */
  const cardTime = (card: Card) => {
    if (!CAN_DROP_PERIOD.includes(card.type)) {
      // A timesheet, a capacity band or an estimate-against-actual card *is* a window, so it
      // only moves between them.
      return {
        value: card.config.period?.preset ?? 'this_week',
        options: periodChoices(card).map(([value, label]) => ({ value, label })),
        onPick: (value: string) => setPeriod(card, value as Period['preset']),
        onCustom: () => setDialog({ type: 'card', card }),
      };
    }
    // Everything else is scoped by its due date, and all of those shapes are one field on the
    // task, so they are offered as one list. Two controls writing the same field would quietly
    // overwrite each other.
    const due = card.config.filters?.due;
    return {
      value: due === 'period' ? card.config.period.preset : due ?? ANY_TIME,
      options: [
        { value: ANY_TIME, label: anyLabel(card) },
        ...DUE_SHAPES,
        ...CARD_PERIODS.map(([value, label]) => ({ value, label: `Due ${label.toLowerCase()}` })),
      ],
      onPick: (value: string) => setDueScope(card, value),
      onCustom: () => setDialog({ type: 'card', card }),
    };
  };

  const setPeriod = (card: Card, preset: Period['preset']) => {
    if (preset === 'custom') { setDialog({ type: 'card', card }); return; }
    edits.current += 1;
    act(async () => {
      const saved = await dashApi.updateCard(id, card.id, { config: { ...card.config, period: { preset } } });
      setDash((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === saved.id ? saved : c)) } : prev));
      const fresh = await dashApi.cardData(id, card.id);
      setData((prev) => ({ ...prev, [card.id]: fresh }));
    });
  };

  const summary = useMemo(() => (dash ? filterSummary(dash.filters) : []), [dash, filterSummary]);

  if (!dash) {
    return error
      ? <div className="p-10 text-center text-sm text-red-700">{error}</div>
      : (
        <div className="grid grid-cols-12 gap-4 p-6" role="status" aria-label="Loading Dashboard">
          {[3, 3, 3, 3, 8, 4, 6, 6].map((span, i) => (
            <div key={i} className="skeleton" style={{ gridColumn: `span ${span} / span ${span}`, height: i < 4 ? 84 : 220 }} />
          ))}
        </div>
      );
  }

  const menu = [
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate' }) },
    ...(canEdit ? [
      // The Edit button is off the header; arranging cards lives here instead.
      ...(FEATURES.dashboardEditButton ? [] : [{ label: 'Arrange cards', icon: <GripVertical size={14} />, onClick: () => setEditMode(true) }]),
      ...(FEATURES.dashboardEmailReports ? [] : [{ label: 'Email reports', icon: <Mail size={14} />, onClick: () => setDialog({ type: 'reports' }) }]),
      { label: 'Rename', icon: <Pencil size={14} />, onClick: () => setDialog({ type: 'rename' }) },
      { label: 'Change locations', icon: <LayoutDashboard size={14} />, onClick: () => setDialog({ type: 'repoint' }) },
      { label: dash.auto_refresh ? 'Turn off auto refresh' : 'Turn on auto refresh (30 min)', icon: <RefreshCw size={14} />, onClick: () => act(async () => setDash(await dashApi.update(id, { auto_refresh: !dash.auto_refresh }))) },
    ] : []),
    ...(canDelete ? [embedded
      ? { label: 'Reset to the standard dashboard', icon: <RotateCcw size={14} />, danger: true, onClick: removeDashboard }
      : { label: 'Delete Dashboard', icon: <Trash2 size={14} />, danger: true, onClick: removeDashboard }] : []),
  ];

  return (
    <div className="dashboard-print flex h-full min-h-0 flex-col bg-gray-50/70">
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <nav className="flex items-center gap-1.5 text-sm text-gray-500">
          {embedded ? (
            <h2 className="truncate text-base font-semibold text-gray-900">{dash.name}</h2>
          ) : heading === false ? null : heading ? (
            <>
              <h1 className="truncate text-lg font-semibold text-gray-900">{heading}</h1>
              {FEATURES.dashboardHomeSubtitle && (
                <>
                  <span className="text-gray-300">·</span>
                  <Link to={`/dashboards/${id}`} className="no-print text-gray-500 no-underline hover:text-gray-800">{dash.name}</Link>
                </>
              )}
            </>
          ) : (
            <>
              <Link to="/dashboards" className="no-print text-gray-500 no-underline hover:text-gray-800">Dashboards</Link>
              <ChevronRight size={14} className="no-print text-gray-300" />
              <h1 className="truncate text-lg font-semibold text-gray-900">{dash.name}</h1>
              <FavoriteStar kind="dashboard" id={id} size={14} />
            </>
          )}
          {dash.team && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700"><Users size={12} /> {dash.team.name}</span>}
          {dash.owner && dash.relation !== 'mine' && <span className="ml-1 text-xs text-gray-400">by {dash.owner.display_name || dash.owner.email}</span>}
          <div className="no-print ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-xs text-gray-400" title={dash.auto_refresh ? 'Refreshes every 30 minutes' : 'Auto refresh is off'}>
              Refreshed {loadedAt ? ago(now - loadedAt) : '…'}
            </span>
            <button type="button" title="Refresh" onClick={loadData} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><RefreshCw size={15} /></button>
            <button type="button" title="Print or save as PDF" onClick={() => { setEditMode(false); setTimeout(() => window.print(), 50); }} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><Printer size={15} /></button>
            {canEdit && (FEATURES.dashboardEditButton || editMode) && (
              <button
                type="button"
                aria-pressed={editMode}
                onClick={() => setEditMode(!editMode)}
                className={`rounded-md border px-2.5 py-1 text-sm ${editMode ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                {editMode ? 'Done editing' : 'Edit'}
              </button>
            )}
            {FEATURES.dashboardEmailReports && !isGuest && <button type="button" onClick={() => setDialog({ type: 'reports' })} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Mail size={14} /> Email reports</button>}
            <button type="button" onClick={() => setDialog({ type: 'share' })} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Share2 size={14} /> Share</button>
            {/* Your own board is not something you rename, re-point or delete, so it carries no
                actions menu. Dashboards opened from the Hub keep theirs -- it is the only way to
                reach Rename, Change locations, Arrange cards and Delete. */}
            {!isGuest && heading === undefined && FEATURES.dashboardActionsMenu && (
              <Menu align="right" label="Dashboard actions" items={menu} trigger={<span className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><MoreHorizontal size={16} /></span>} />
            )}
          </div>
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs empty:mt-0">
          {/* Home is always your own work, so it doesn't carry the filter chip; on a Dashboard you
              built, the chip is how the filter that applies to every card is read and changed. */}
          {heading === undefined && (
            <button
              type="button"
              onClick={() => canEdit && setDialog({ type: 'filters' })}
              disabled={!canEdit}
              className={`flex items-center gap-1 rounded-md border px-2 py-1 ${summary.length ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-600'} disabled:cursor-default`}
              title={canEdit ? 'Filters for every card' : 'Dashboard filters'}
            >
              <Filter size={12} /> {summary.length ? summary.join(' · ') : 'No Dashboard filters'}
            </button>
          )}
          {RELATION_NOTE[dash.relation] && <span className="text-gray-400">{RELATION_NOTE[dash.relation]}</span>}
          {editMode && (
            <>
              <span className="text-gray-400">Drag cards by their handle to move them; drag the corner to resize.</span>
              <button type="button" disabled={!undo.length} onClick={undoLayout} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40"><Undo2 size={13} /> Undo</button>
              <button type="button" onClick={() => setDialog({ type: 'card', card: null })} className="flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white hover:bg-brand-700"><Plus size={13} /> Add card</button>
            </>
          )}
        </div>
      </header>

      {error && <div className="mx-6 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {intro}
        {dash.cards.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <LayoutDashboard size={32} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">This Dashboard is empty</h3>
            {canEdit ? (
              <button type="button" onClick={() => { setEditMode(true); setDialog({ type: 'card', card: null }); }} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
                <Plus size={14} /> Add a card
              </button>
            ) : <p className="mt-1 text-sm text-gray-500">Its owner hasn't added any cards yet.</p>}
          </div>
        ) : (
          <>
          {statCards.length > 0 && (
            <>
              <PeriodBar
                value={rowPeriod}
                canEdit={canEdit && statCards.some(followsPeriod)}
                onPick={applyRowPeriod}
                onCustom={() => { const card = statCards.find(followsPeriod); if (card) setDialog({ type: 'card', card }); }}
              />
              <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {statCards.map((card) => (
                  <StatCard
                    key={card.id}
                    card={card}
                    data={data[card.id]}
                    onDrill={() => setDialog({ type: 'drill', cardId: card.id, title: card.title })}
                    filter={(
                      <CardFilterMenu
                        value={card.config.filters ?? {}}
                        disabled={!canEdit}
                        hideDue
                        onApply={(filters) => setCardFilters(card, filters)}
                      />
                    )}
                  />
                ))}
              </div>
            </>
          )}
          {workloadCards.map((card) => (
            <WorkloadPanel
              key={card.id}
              card={card}
              data={data[card.id]}
              canEdit={canEdit}
              onSetPeriod={(period) => setPeriod(card, period.preset)}
              onCustom={() => setDialog({ type: 'card', card })}
              onDrill={(label) => setDialog({ type: 'drill', cardId: card.id, title: `${card.title}: ${label}` })}
              onSetFilters={(filters) => setCardFilters(card, filters)}
            />
          ))}
          <div ref={gridRef} className="grid grid-cols-12" style={{ gridAutoRows: ROW_PX, gap: GAP_PX, gridAutoFlow: 'row dense' }}>
            {dash.cards.filter((card) => !outOfGrid.has(card.id)).map((card) => (
              <section
                key={card.id}
                data-card-id={card.id}
                aria-label={card.title}
                onDragOver={(e) => { if (editMode && dragging) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging) moveBefore(dragging, card.id); setDragging(null); }}
                className={`relative flex min-w-0 flex-col rounded-xl border bg-white ${dragging === card.id ? 'opacity-50' : ''} ${editMode ? 'border-dashed border-brand-200' : 'border-gray-200'}`}
                style={{ gridColumn: `span ${card.width} / span ${card.width}`, gridRow: `span ${card.height} / span ${card.height}` }}
              >
                <header className="flex items-center gap-1.5 px-3 pt-2.5">
                  {editMode && (
                    <span
                      draggable
                      title="Drag to move"
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', card.id); setDragging(card.id); }}
                      onDragEnd={() => setDragging(null)}
                      className="cursor-grab text-gray-300 hover:text-gray-500"
                    >
                      <GripVertical size={14} />
                    </span>
                  )}
                  {card.type === 'bar' || card.type === 'pie' ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                        {card.type === 'pie' ? <PieChartIcon size={16} /> : <BarChart3 size={16} />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">{card.title}</span>
                        <span className="block truncate text-[11px] text-gray-500">{chartSubtitle(card, data[card.id])}</span>
                      </span>
                    </span>
                  ) : (
                    <h2 className="min-w-0 truncate text-sm font-semibold text-gray-800">{card.title}</h2>
                  )}
                  {/* Time cards carry their own period, so today / this week / this month or a
                      range is one click away rather than an edit. */}
                  <span className="flex-1" />
                  {/* The timesheet carries its own week arrows, and the estimate card its
                      window inside Filter, so a period dropdown as well is one control too many. */}
                  {TIME_CARDS.includes(card.type) && card.type !== 'timesheet' && card.type !== 'variance' && (
                    <PeriodMenu
                      label={CARD_PERIODS.find(([v]) => v === (card.config.period?.preset ?? 'this_week'))?.[1] ?? 'Custom'}
                      preset={card.config.period?.preset ?? 'this_week'}
                      choices={periodChoices(card)}
                      disabled={!canEdit}
                      onPick={(period) => setPeriod(card, period.preset)}
                      onCustom={() => setDialog({ type: 'card', card })}
                    />
                  )}
                  {FILTERABLE.includes(card.type) && (
                    <CardFilterMenu
                      value={card.config.filters ?? {}}
                      disabled={!canEdit}
                      hideDue={CAN_DROP_PERIOD.includes(card.type)}
                      peopleOnly={PEOPLE_ONLY_FILTERS.includes(card.type)}
                      time={cardTime(card)}
                      onApply={(filters) => setCardFilters(card, filters)}
                    />
                  )}
                  {FEATURES.dashboardCardScopeMenu && (card.type === 'bar' || card.type === 'pie') && (
                    <ScopeMenu time={cardTime(card)} disabled={!canEdit} />
                  )}
                  {!!data[card.id]?.hidden_sources && (
                    <span className="text-[10px] text-amber-600" title="Some locations on this card are not shared with you and are left out">partial</span>
                  )}
                  <span className="no-print flex items-center gap-1.5">
                    <button type="button" title="Refresh card" onClick={() => refreshCard(card.id)} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><RefreshCw size={12} /></button>
                    {FEATURES.dashboardCardFullScreen && (
                      <button type="button" title="Full screen" onClick={() => setDialog({ type: 'expand', cardId: card.id })} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><Expand size={12} /></button>
                    )}
                    {cardMenu(card).length > 0 && (
                      <Menu
                        align="right"
                        label={`Actions for ${card.title}`}
                        items={cardMenu(card)}
                        trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-gray-100">{canEdit ? <MoreHorizontal size={14} /> : <Download size={13} />}</span>}
                      />
                    )}
                  </span>
                </header>
                <div className="min-h-0 flex-1 px-3 pb-3 pt-1">
                  <CardBody
                    card={card}
                    data={data[card.id]}
                    dashboardId={id}
                    onDrill={(segment, title) => setDialog({ type: 'drill', cardId: card.id, segment, title: segment ? `${card.title}: ${title}` : card.title })}
                    onOpenTask={setOpenTask}
                    onRefresh={() => refreshCard(card.id)}
                    onShift={(start, end) => setCardPeriod(card, { preset: 'custom', start, end })}
                  />
                </div>
                {editMode && (
                  <span
                    title="Drag to resize"
                    onPointerDown={(e) => startResize(e, card)}
                    className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border-b-2 border-r-2 border-brand-300"
                  />
                )}
              </section>
            ))}
          </div>
          </>
        )}
      </main>

      {dialog?.type === 'card' && (
        <CardEditor
          dashboardId={id}
          card={dialog.card}
          onClose={() => setDialog(null)}
          onSaved={async (saved) => {
            setDialog(null);
            if (!dialog.card) setUndo([]);
            await load();
            refreshCard(saved.id);
          }}
        />
      )}
      {dialog?.type === 'share' && <ShareDashboardDialog dashboardId={id} name={dash.name} onClose={() => setDialog(null)} onChanged={() => dashApi.get(id).then(setDash)} />}
      {dialog?.type === 'reports' && <ReportsDialog dashboardId={id} name={dash.name} canEdit={canEdit} onClose={() => setDialog(null)} />}
      {dialog?.type === 'repoint' && <RepointDialog dashboardId={id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog?.type === 'rename' && (
        <NameDialog title="Rename Dashboard" initial={dash.name} confirmLabel="Save" onClose={() => setDialog(null)}
          onSubmit={async (name) => { setDash(await dashApi.update(id, { name })); }} />
      )}
      {dialog?.type === 'duplicate' && (
        <DuplicateDialog dash={dash} onClose={() => setDialog(null)} onDone={(copyId) => { setDialog(null); navigate(`/dashboards/${copyId}`); }} />
      )}
      {dialog?.type === 'filters' && <FiltersDialog value={dash.filters} teamDashboard={!!dash.team} onClose={() => setDialog(null)} onSave={saveFilters} />}
      {dialog?.type === 'drill' && (
        <DrillDialog dashboardId={id} cardId={dialog.cardId} segment={dialog.segment} title={dialog.title} onClose={() => setDialog(null)}
          onOpenTask={(taskId) => { setDialog(null); setOpenTask(taskId); }} />
      )}
      {dialog?.type === 'expand' && (() => {
        const card = dash.cards.find((c) => c.id === dialog.cardId);
        return card ? (
          <Modal label={`${card.title} full screen`} title={card.title} onClose={() => setDialog(null)} width="w-[min(96vw,80rem)]">
            <div className="h-[70vh]">
              <CardBody card={card} data={data[card.id]} dashboardId={id} onOpenTask={setOpenTask}
                onDrill={(segment, title) => setDialog({ type: 'drill', cardId: card.id, segment, title: segment ? `${card.title}: ${title}` : card.title })} />
            </div>
          </Modal>
        ) : null;
      })()}
      {openTask && <TaskPanel taskId={openTask} onClose={() => setOpenTask(null)} onChanged={() => { loadData(); refreshTree(); }} onOpen={setOpenTask} />}
    </div>
  );
};

const FiltersDialog: React.FC<{ value: Filters; teamDashboard: boolean; onClose: () => void; onSave: (f: Filters) => void }> = ({ value, teamDashboard, onClose, onSave }) => {
  const [filters, setFilters] = useState<Filters>(value);
  return (
    <Modal label="Dashboard filters" title="Dashboard filters" onClose={onClose} width="w-[36rem]"
      footer={<>
        <button type="button" onClick={() => setFilters({})} className="mr-auto rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Clear all</button>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" onClick={() => onSave(filters)} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Apply</button>
      </>}>
      <p className="mb-3 text-xs text-gray-500">
        These apply to every card, including cards added later, on top of each card's own filters. On time cards, the people filter chooses whose time is shown.
        {teamDashboard && ' Team dashboards start filtered to the Team\'s people.'}
      </p>
      <FiltersEditor value={filters} onChange={setFilters} />
    </Modal>
  );
};

const DuplicateDialog: React.FC<{ dash: Dashboard; onClose: () => void; onDone: (id: string) => void }> = ({ dash, onClose, onDone }) => {
  const { creatableTeams } = useLeadership();
  const [name, setName] = useState(`${dash.name} (copy)`);
  const [team, setTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal label="Duplicate Dashboard" title="Duplicate Dashboard" onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
        <button type="button" disabled={!name.trim()} onClick={() => dashApi.duplicate(dash.id, { name: name.trim(), team_id: team || null }).then((c) => onDone(c.id)).catch((e) => setError(e.message))}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Duplicate</button>
      </>}>
      <label className="block text-xs font-medium text-gray-600">Name
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal" />
      </label>
      <label className="mt-3 block text-xs font-medium text-gray-600">Belongs to
        <select value={team} onChange={(e) => setTeam(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal">
          <option value="">Me (personal)</option>
          {creatableTeams.map((t) => <option key={t.id} value={t.id}>Team: {t.name}</option>)}
        </select>
      </label>
      <p className="mt-3 text-xs text-gray-500">The copy is yours: cards and filters are copied, sharing and email reports are not. Use “Change locations” afterwards to point it at another team's work.</p>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Modal>
  );
};

