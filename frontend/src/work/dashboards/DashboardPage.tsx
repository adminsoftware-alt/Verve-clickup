import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FavoriteStar } from '../Favorites';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronRight, Copy, Download, Expand, FileSpreadsheet, Filter, GripVertical, ImageDown, LayoutDashboard, Mail, MoreHorizontal, Pencil, Plus, Printer, RefreshCw,
  RotateCcw, Share2, Trash2, Undo2, Users,
} from 'lucide-react';
import { useWork } from '../WorkContext';
import { TaskPanel } from '../TaskPanel';
import { Menu, NameDialog } from '../ui';
import { useNow } from '../RunningTimer';
import { dashApi, type Card, type CardData, type Dashboard, type Filters } from './api';
import { CardBody } from './cards';
import { CardEditor } from './CardEditor';
import { DrillDialog, Modal, ReportsDialog, RepointDialog, ShareDashboardDialog, useLeadership } from './dialogs';
import { FiltersEditor, useFilterSummary } from './pickers';
import { cardRows, chartIn, exportCardCsv, exportCardPng } from './exportCard';

const ROW_PX = 110;
const GAP_PX = 12;
const AUTO_REFRESH_MS = 30 * 60 * 1000; // as in ClickUp
const UNDO_LIMIT = 5;

type Layout = { id: string; width: number; height: number }[];
const layoutOf = (cards: Card[]): Layout => cards.map((c) => ({ id: c.id, width: c.width, height: c.height }));

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
export const DashboardPage: React.FC<{ dashboardId?: string; embedded?: { onReset: () => void } }> = ({ dashboardId, embedded }) => {
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

  const loadData = useCallback(async () => {
    try {
      const rows = await dashApi.data(id);
      setData(Object.fromEntries(rows.map((r) => [r.card_id, r])));
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
  const removeCard = (card: Card) => window.confirm(`Remove the “${card.title}” card?`) && act(async () => {
    await dashApi.removeCard(id, card.id);
    setUndo([]); // adding or removing a card resets undo, as in ClickUp
    await load();
  });
  const duplicateCard = (card: Card) => act(async () => { await dashApi.duplicateCard(id, card.id); setUndo([]); await load(); });
  const removeDashboard = () => dash && window.confirm(embedded
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

  const summary = useMemo(() => (dash ? filterSummary(dash.filters) : []), [dash, filterSummary]);

  if (!dash) {
    return <div className="p-10 text-center text-sm text-gray-500">{error ?? 'Loading Dashboard…'}</div>;
  }

  const menu = [
    { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate' }) },
    ...(canEdit ? [
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
          ) : (
            <>
              <Link to="/dashboards" className="no-print text-gray-500 no-underline hover:text-gray-800">Dashboards</Link>
              <ChevronRight size={14} className="no-print text-gray-300" />
              <h1 className="truncate text-lg font-semibold text-gray-900">{dash.name}</h1>
              <FavoriteStar kind="dashboard" id={id} size={14} />
            </>
          )}
          {dash.team && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"><Users size={12} /> {dash.team.name}</span>}
          {dash.owner && dash.relation !== 'mine' && <span className="ml-1 text-xs text-gray-400">by {dash.owner.display_name || dash.owner.email}</span>}
          <div className="no-print ml-auto flex items-center gap-1.5">
            <span className="mr-1 text-xs text-gray-400" title={dash.auto_refresh ? 'Refreshes every 30 minutes' : 'Auto refresh is off'}>
              Refreshed {loadedAt ? ago(now - loadedAt) : '…'}
            </span>
            <button type="button" title="Refresh" onClick={loadData} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><RefreshCw size={15} /></button>
            <button type="button" title="Print or save as PDF" onClick={() => { setEditMode(false); setTimeout(() => window.print(), 50); }} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><Printer size={15} /></button>
            {canEdit && (
              <button
                type="button"
                aria-pressed={editMode}
                onClick={() => setEditMode(!editMode)}
                className={`rounded-md border px-2.5 py-1 text-sm ${editMode ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
              >
                {editMode ? 'Done editing' : 'Edit'}
              </button>
            )}
            {!isGuest && <button type="button" onClick={() => setDialog({ type: 'reports' })} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Mail size={14} /> Email reports</button>}
            <button type="button" onClick={() => setDialog({ type: 'share' })} className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50"><Share2 size={14} /> Share</button>
            {!isGuest && <Menu align="right" label="Dashboard actions" items={menu} trigger={<span className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"><MoreHorizontal size={16} /></span>} />}
          </div>
        </nav>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => canEdit && setDialog({ type: 'filters' })}
            disabled={!canEdit}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 ${summary.length ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'} disabled:cursor-default`}
            title={canEdit ? 'Filters for every card' : 'Dashboard filters'}
          >
            <Filter size={12} /> {summary.length ? summary.join(' · ') : 'No Dashboard filters'}
          </button>
          {RELATION_NOTE[dash.relation] && <span className="text-gray-400">{RELATION_NOTE[dash.relation]}</span>}
          {editMode && (
            <>
              <span className="text-gray-400">Drag cards by their handle to move them; drag the corner to resize.</span>
              <button type="button" disabled={!undo.length} onClick={undoLayout} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100 disabled:opacity-40"><Undo2 size={13} /> Undo</button>
              <button type="button" onClick={() => setDialog({ type: 'card', card: null })} className="flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 font-medium text-white hover:bg-indigo-700"><Plus size={13} /> Add card</button>
            </>
          )}
        </div>
      </header>

      {error && <div className="mx-6 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {dash.cards.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md text-center">
            <LayoutDashboard size={32} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-base font-semibold text-gray-800">This Dashboard is empty</h3>
            {canEdit ? (
              <button type="button" onClick={() => { setEditMode(true); setDialog({ type: 'card', card: null }); }} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
                <Plus size={14} /> Add a card
              </button>
            ) : <p className="mt-1 text-sm text-gray-500">Its owner hasn't added any cards yet.</p>}
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-12" style={{ gridAutoRows: ROW_PX, gap: GAP_PX, gridAutoFlow: 'row dense' }}>
            {dash.cards.map((card) => (
              <section
                key={card.id}
                data-card-id={card.id}
                aria-label={card.title}
                onDragOver={(e) => { if (editMode && dragging) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (dragging) moveBefore(dragging, card.id); setDragging(null); }}
                className={`relative flex min-w-0 flex-col rounded-xl border bg-white ${dragging === card.id ? 'opacity-50' : ''} ${editMode ? 'border-dashed border-indigo-200' : 'border-gray-200'}`}
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
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{card.title}</h2>
                  {!!data[card.id]?.hidden_sources && (
                    <span className="text-[10px] text-amber-600" title="Some locations on this card are not shared with you and are left out">partial</span>
                  )}
                  <span className="no-print flex items-center gap-1.5">
                    <button type="button" title="Refresh card" onClick={() => refreshCard(card.id)} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><RefreshCw size={12} /></button>
                    <button type="button" title="Full screen" onClick={() => setDialog({ type: 'expand', cardId: card.id })} className="rounded p-0.5 text-gray-300 hover:text-gray-600"><Expand size={12} /></button>
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
                  />
                </div>
                {editMode && (
                  <span
                    title="Drag to resize"
                    onPointerDown={(e) => startResize(e, card)}
                    className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border-b-2 border-r-2 border-indigo-300"
                  />
                )}
              </section>
            ))}
          </div>
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
        <button type="button" onClick={() => onSave(filters)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Apply</button>
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
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Duplicate</button>
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

