import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Download, FileSpreadsheet, LogOut, MinusCircle, X } from 'lucide-react';
import { Portal, useEscapeToClose } from '../ui';
import { peopleApi, personName, type ImportResult, type ImportRow, type JoinerStep, type OffboardPreview, type Person } from './peopleApi';

const Dialog: React.FC<{ title: string; onClose: () => void; width?: string; children: React.ReactNode }> = ({ title, onClose, width = 'w-[36rem]', children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEscapeToClose(ref, onClose);
  return (
    <Portal>
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div ref={ref} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
          className={`flex max-h-[90vh] ${width} max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl`}>
          <header className="flex items-center border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">{title}</h3>
            <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        </div>
      </div>
    </Portal>
  );
};

const primary = 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50';
const secondary = 'rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100';

// --- joiner checklist ------------------------------------------------------------------------------------

const OUTCOME: Record<JoinerStep['outcome'], { label: string; cls: string }> = {
  created: { label: 'Created', cls: 'bg-emerald-50 text-emerald-700' },
  exists: { label: 'Already there', cls: 'bg-gray-100 text-gray-600' },
  would_create: { label: 'Will create', cls: 'bg-brand-50 text-brand-700' },
  skipped: { label: 'Not needed', cls: 'bg-gray-50 text-gray-400' },
  problem: { label: 'Problem', cls: 'bg-red-50 text-red-700' },
};

export const JoinerSteps: React.FC<{ steps: JoinerStep[] }> = ({ steps }) => (
  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200" aria-label="Joiner tasks">
    {steps.map((st) => (
      <li key={st.key} className="flex items-start gap-3 px-3 py-2 text-sm">
        <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${OUTCOME[st.outcome].cls}`}>{OUTCOME[st.outcome].label}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-800">{st.name}</div>
          <div className="text-xs text-gray-500">
            {st.list_name && <>in {st.list_name}</>}
            {st.due_date && <> · due {new Date(st.due_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</>}
            {st.reason && <>{st.list_name || st.due_date ? ' · ' : ''}{st.reason}</>}
          </div>
        </div>
      </li>
    ))}
  </ul>
);

/** Preview and run the joiner checklist for one person. */
export const JoinerDialog: React.FC<{ ws: string; person: Person; onClose: () => void; onDone: () => void }> = ({ ws, person, onClose, onDone }) => {
  const [steps, setSteps] = useState<JoinerStep[] | null>(null);
  const [ran, setRan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { peopleApi.joinerPreview(ws, person.user.id).then(setSteps).catch((e) => setError(e.message)); }, [ws, person.user.id]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try { setSteps(await peopleApi.runJoiner(ws, person.user.id)); setRan(true); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const toCreate = steps?.filter((s) => s.outcome === 'would_create').length ?? 0;
  return (
    <Dialog title={`Joiner checklist · ${personName(person)}`} onClose={onClose} width="w-[40rem]">
      <p className="mb-3 text-xs text-gray-500">
        The standard tasks from the “Common Operational Tasks” SOP: induction, special events, learning and monthly review in their team's List,
        interviews and ClickUp reviews where they apply, and the HR reminders for their birthday and anniversaries. Admins can change the plan under Teams → Admin.
      </p>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {steps === null ? <p className="text-sm text-gray-400">Working out what's needed…</p> : <JoinerSteps steps={steps} />}
      {ran && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">Done. {steps?.filter((s) => s.outcome === 'created').length} tasks created.</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondary}>{ran ? 'Close' : 'Cancel'}</button>
        {!ran && <button type="button" disabled={busy || !toCreate} onClick={run} className={`flex items-center gap-1.5 ${primary}`}><ClipboardCheck size={14} /> Create {toCreate} tasks</button>}
      </div>
    </Dialog>
  );
};

// --- offboarding --------------------------------------------------------------------------------------------

/** The leaver steps from the SOP: hand over work, keep the birthday task as "Ex – …", delete the rest, turn off access. */
export const OffboardDialog: React.FC<{ ws: string; person: Person; people: Person[]; onClose: () => void; onDone: () => void }> = ({ ws, person, people, onClose, onDone }) => {
  const [preview, setPreview] = useState<OffboardPreview | null>(null);
  const [handTo, setHandTo] = useState('');
  const [keepTasks, setKeepTasks] = useState(false);
  const [leaverRules, setLeaverRules] = useState(true);
  const [block, setBlock] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    peopleApi.offboardPreview(ws, person.user.id).then((p) => { setPreview(p); setHandTo(p.hand_over_to?.id ?? ''); }).catch((e) => setError(e.message));
  }, [ws, person.user.id]);
  const candidates = people.filter((p) => p.user.id !== person.user.id && !p.deactivated_at && p.role !== 'guest');
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await peopleApi.offboard(ws, person.user.id, {
        hand_over_to: keepTasks ? null : handTo || null, keep_tasks: keepTasks, apply_leaver_rules: leaverRules,
        block_email: block, block_reason: reason.trim() || null,
      });
      const barred = out.email_blocked
        ? ` ${person.user.email} is blocked, so nobody can add them back${out.sign_in_revoked ? ', and their sign-in is disabled' : ''}.`
        : '';
      setDone(`${personName(person)} is offboarded: ${out.tasks_handed_over} tasks handed over, ${out.joiner_tasks_kept} kept, ${out.joiner_tasks_deleted} deleted, ${out.direct_reports_moved} direct reports moved.${barred}`);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={`Offboard ${personName(person)}`} onClose={onClose}>
      {done ? (
        <>
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{done}</p>
          <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className={primary}>Close</button></div>
        </>
      ) : preview === null ? <p className="text-sm text-gray-400">{error ?? 'Loading…'}</p> : (
        <>
          <ul className="mb-4 space-y-1.5 text-sm text-gray-700">
            <li className="flex gap-2"><span className="w-40 shrink-0 text-gray-500">Open tasks</span>{preview.open_tasks}</li>
            <li className="flex gap-2"><span className="w-40 shrink-0 text-gray-500">Direct reports</span>{preview.direct_reports ? `${preview.direct_reports} (they move to ${person.manager_id ? 'this person’s manager' : 'no manager'})` : 'None'}</li>
            <li className="flex gap-2"><span className="w-40 shrink-0 text-gray-500">Teams</span>{preview.teams ? `Leaves ${preview.teams}` : 'None'}</li>
          </ul>
          <fieldset className="mb-4">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Their open tasks</legend>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="radio" name="handover" checked={!keepTasks} onChange={() => setKeepTasks(false)} /> Hand over to
              <select aria-label="Hand over to" disabled={keepTasks} value={handTo} onChange={(e) => setHandTo(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1 text-sm">
                <option value="">Choose someone</option>
                {candidates.map((p) => <option key={p.user.id} value={p.user.id}>{personName(p)}{p.user.id === preview.hand_over_to?.id ? ' (their manager)' : ''}</option>)}
              </select>
            </label>
            <label className="mt-1 flex items-center gap-2 text-sm text-gray-700"><input type="radio" name="handover" checked={keepTasks} onChange={() => setKeepTasks(true)} /> Leave them assigned for now</label>
          </fieldset>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={leaverRules} onChange={(e) => setLeaverRules(e.target.checked)} />
            <span>Apply the leaver steps from the SOP
              <span className="block text-xs text-gray-500">
                {preview.joiner_tasks_kept.length > 0 && <>Keep {preview.joiner_tasks_kept.join(', ')} (renamed “Ex – {personName(person)}”, poster item only). </>}
                {preview.joiner_tasks_deleted.length > 0 ? <>Delete {preview.joiner_tasks_deleted.length}: {preview.joiner_tasks_deleted.join(', ')}.</> : 'No other joiner tasks to delete.'}
              </span>
            </span>
          </label>
          {/* Turning access off stops them today; it does not stop the next admin adding them
              back, or an old spreadsheet import doing it silently. This does. */}
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
            <input type="checkbox" className="mt-1" checked={block} onChange={(e) => setBlock(e.target.checked)} />
            <span>Block {person.user.email} from this workspace
              <span className="block text-xs text-gray-500">
                The address is refused wherever someone can be added — by hand, by invitation and by spreadsheet import —
                and their sign-in is disabled. An admin can lift it later under Admin → Blocked addresses.
              </span>
            </span>
          </label>
          {block && (
            <input
              aria-label="Why they are blocked" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
              placeholder="Why (optional) — shown to whoever tries to add them"
              className="mt-1.5 ml-6 w-[calc(100%-1.5rem)] rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none"
            />
          )}
          <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Their access is turned off. Comments, time entries and history stay. You can turn access back on later{block ? ', though the block has to be lifted first' : ''}.</p>
          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={secondary}>Cancel</button>
            <button type="button" disabled={busy || (!keepTasks && !handTo)} onClick={go} className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"><LogOut size={14} /> Offboard</button>
          </div>
        </>
      )}
    </Dialog>
  );
};

// --- import from Excel ----------------------------------------------------------------------------------------

const COLUMNS: [keyof ImportRow, string[]][] = [
  ['email', ['email', 'work email', 'official email', 'e-mail', 'email address']],
  ['name', ['name', 'full name', 'employee name']],
  ['designation', ['designation', 'title', 'job title']],
  ['department', ['department', 'dept']],
  ['manager_email', ['manager email', 'reporting manager email', 'reporting manager', 'manager']],
  ['teams', ['team', 'teams']],
  ['role', ['role', 'access']],
  ['employee_code', ['employee code', 'emp code', 'employee id', 'code']],
  ['date_of_joining', ['date of joining', 'doj', 'joining date']],
  ['date_of_birth', ['date of birth', 'dob', 'birthday']],
  ['marriage_anniversary', ['marriage anniversary', 'anniversary']],
  ['phone', ['phone', 'mobile', 'contact']],
  ['location', ['location', 'city', 'office']],
];
const DATE_FIELDS = new Set<keyof ImportRow>(['date_of_joining', 'date_of_birth', 'marriage_anniversary']);
const pad = (n: number) => String(n).padStart(2, '0');

/** Spreadsheet dates: real dates, "DD/MM/YYYY" (as written in India) or "YYYY-MM-DD". */
function toIsoDate(v: unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const text = String(v ?? '').trim();
  if (!text) return undefined;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${year}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return text; // let the server say what's wrong with it
}

export function rowsFromSheet(records: Record<string, unknown>[]): { rows: ImportRow[]; missing: string[] } {
  if (!records.length) return { rows: [], missing: ['email'] };
  const headers = Object.keys(records[0]);
  const find = (aliases: string[]) => headers.find((h) => aliases.includes(h.trim().toLowerCase()));
  const map = COLUMNS.map(([field, aliases]) => [field, find(aliases)] as const).filter(([, h]) => h);
  const missing = map.some(([f]) => f === 'email') ? [] : ['email'];
  const rows = records.map((rec) => {
    const row: ImportRow = { email: '' };
    for (const [field, header] of map) {
      const raw = rec[header as string];
      const value = DATE_FIELDS.has(field) ? toIsoDate(raw) : (raw == null ? '' : String(raw).trim());
      if (value) (row as unknown as Record<string, string>)[field] = value;
    }
    return row;
  }).filter((r) => r.email);
  return { rows, missing };
}

function downloadTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Name', 'Email', 'Designation', 'Department', 'Reporting manager email', 'Teams', 'Role', 'Employee code', 'Date of joining', 'Date of birth', 'Marriage anniversary', 'Phone', 'Location'],
    ['Priya Nair', 'priya.nair@verveadvisory.com', 'Executive', 'Accounts', 'ravi.kumar@verveadvisory.com', 'Accounts', 'Member', 'VAPL-104', '2026-09-01', '1998-04-12', '', '+91 98xxxxxx', 'Bengaluru'],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'People');
  XLSX.writeFile(book, 'timetriq-people-template.xlsx');
}

const ROW_ICON = { added: <CheckCircle2 size={14} className="text-emerald-600" />, updated: <CheckCircle2 size={14} className="text-sky-600" />, unchanged: <MinusCircle size={14} className="text-gray-400" />, error: <AlertTriangle size={14} className="text-red-600" /> };

/** Load many people from an Excel or CSV file: pick, check (dry run), then import. */
export const ImportPeopleDialog: React.FC<{ ws: string; onClose: () => void; onDone: () => void }> = ({ ws, onClose, onDone }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [options, setOptions] = useState({ send_invites: false, start_joiner_checklist: false, update_existing: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setError(null);
    setCheck(null);
    setResult(null);
    setFileName(file.name);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '', raw: true });
      const { rows: parsed, missing } = rowsFromSheet(records);
      if (missing.length) { setError('The first sheet needs an "Email" column. Download the template to see the columns.'); setRows([]); return; }
      if (!parsed.length) { setError('No rows with an email address were found.'); setRows([]); return; }
      setRows(parsed);
      setBusy(true);
      setCheck(await peopleApi.importPeople(ws, { rows: parsed, dry_run: true, ...options }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const recheck = async (next: typeof options) => {
    setOptions(next);
    if (rows.length) setCheck(await peopleApi.importPeople(ws, { rows, dry_run: true, ...next }).catch(() => check));
  };
  const go = async () => {
    setBusy(true);
    setError(null);
    try { setResult(await peopleApi.importPeople(ws, { rows, dry_run: false, ...options })); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const shown = result ?? check;
  return (
    <Dialog title="Import people from Excel" onClose={onClose} width="w-[48rem]">
      {!result && (
        <>
          <p className="mb-3 text-sm text-gray-600">Use one row per person. Managers can be anyone already here or anyone in the same file. Existing people are matched by email.</p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><FileSpreadsheet size={14} /> {fileName ? 'Choose another file' : 'Choose a file'}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" aria-label="Spreadsheet file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
            <button type="button" onClick={downloadTemplate} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-brand-700 hover:bg-brand-50"><Download size={14} /> Download template</button>
            {fileName && <span className="text-xs text-gray-500">{fileName} · {rows.length} rows</span>}
          </div>
          <div className="mb-3 flex flex-wrap gap-4 text-sm text-gray-700">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.update_existing} onChange={(e) => recheck({ ...options, update_existing: e.target.checked })} /> Update people already here</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.start_joiner_checklist} onChange={(e) => recheck({ ...options, start_joiner_checklist: e.target.checked })} /> Start the joiner checklist for new people</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.send_invites} onChange={(e) => recheck({ ...options, send_invites: e.target.checked })} /> Email new people an invitation</label>
          </div>
        </>
      )}
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
      {shown && (
        <>
          <p className="mb-2 text-sm text-gray-700" role="status">
            {result ? 'Imported: ' : 'Ready to import: '}<b>{shown.added}</b> new, <b>{shown.updated}</b> updated{shown.errors ? <>, <b className="text-red-700">{shown.errors}</b> with problems (skipped)</> : ''}.
          </p>
          {result?.email_problem && <p className="mb-2 text-xs text-amber-700">{result.email_problem}</p>}
          <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm" aria-label="Import rows">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-500"><tr><th className="px-3 py-1.5">Row</th><th className="px-3 py-1.5">Email</th><th className="px-3 py-1.5">Result</th><th className="px-3 py-1.5">Notes</th></tr></thead>
              <tbody>
                {shown.rows.map((r) => (
                  <tr key={r.row} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 text-gray-400">{r.row + 1}</td>
                    <td className="px-3 py-1.5 text-gray-800">{r.email}</td>
                    <td className="px-3 py-1.5"><span className="flex items-center gap-1 capitalize">{ROW_ICON[r.outcome]} {r.outcome === 'error' ? 'Problem' : r.outcome}</span></td>
                    <td className="px-3 py-1.5 text-xs text-gray-600">{r.problems.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondary}>{result ? 'Close' : 'Cancel'}</button>
        {!result && <button type="button" disabled={busy || !check || check.added + check.updated === 0} onClick={go} className={primary}>{busy ? 'Working…' : `Import ${check ? check.added + check.updated : ''} people`}</button>}
      </div>
    </Dialog>
  );
};
