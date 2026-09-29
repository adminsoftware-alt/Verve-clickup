import React, { useMemo, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import { workApi, type CustomField, type ImportResult, type ImportRow } from '../api';
import { Portal } from '../ui';

/** Parse CSV text: quoted cells, doubled quotes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Trailing blank lines go; blank rows in between stay, so line numbers match the sheet.
  while (rows.length && rows[rows.length - 1].every((x) => x.trim() === '')) rows.pop();
  return rows;
}

type Target = '' | 'name' | 'description' | 'status' | 'priority' | 'assignees' | 'start_date' | 'due_date' | 'tags' | 'time_estimate' | `field:${string}`;
const TARGETS: { value: Target; label: string; words: string[] }[] = [
  { value: 'name', label: 'Task name', words: ['task name', 'name', 'task', 'title', 'subject'] },
  { value: 'description', label: 'Description', words: ['description', 'details', 'notes', 'content'] },
  { value: 'status', label: 'Status', words: ['status', 'stage', 'state'] },
  { value: 'priority', label: 'Priority', words: ['priority'] },
  { value: 'assignees', label: 'Assignees (email or name)', words: ['assignee', 'assignees', 'owner', 'assigned to', 'email'] },
  { value: 'start_date', label: 'Start date', words: ['start date', 'start'] },
  { value: 'due_date', label: 'Due date', words: ['due date', 'due', 'deadline'] },
  { value: 'tags', label: 'Tags', words: ['tags', 'tag', 'labels'] },
  { value: 'time_estimate', label: 'Time estimate', words: ['time estimate', 'estimate', 'hours'] },
];

function guess(header: string, fields: CustomField[], taken: Set<string>): Target {
  const h = header.trim().toLowerCase();
  const field = fields.find((f) => f.name.toLowerCase() === h);
  if (field && !taken.has(`field:${field.id}`)) return `field:${field.id}`;
  for (const t of TARGETS) if (!taken.has(t.value) && t.words.includes(h)) return t.value;
  return '';
}

/** ClickUp's CSV import into a List: pick a file, match its columns, import. */
export const ImportDialog: React.FC<{ listId: string; listName: string; fields: CustomField[]; onClose: () => void; onDone: () => void }> = ({ listId, listName, fields, onClose, onDone }) => {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const header = rows?.[0] ?? [];
  // Data rows with their line in the spreadsheet (the header is line 1); empty rows are skipped.
  const lines = useMemo(
    () => (rows?.slice(1) ?? []).map((cells, i) => ({ cells, line: i + 2 })).filter((r) => r.cells.some((x) => x.trim() !== '')),
    [rows],
  );
  const body = useMemo(() => lines.map((l) => l.cells), [lines]);
  const lineOf = (row: number) => lines[row - 1]?.line ?? row + 1;
  const hasName = mapping.includes('name');

  const read = async (file: File) => {
    setError(null);
    setResult(null);
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { setError('That file has no rows under its header.'); return; }
    setFileName(file.name);
    setRows(parsed);
    const taken = new Set<string>();
    setMapping(parsed[0].map((h) => { const g = guess(h, fields, taken); if (g) taken.add(g); return g; }));
  };

  const run = async () => {
    const payload: ImportRow[] = body.map((cells) => {
      const row: ImportRow = { name: '', fields: {} };
      mapping.forEach((target, i) => {
        const v = (cells[i] ?? '').trim();
        if (!target || !v) return;
        if (target.startsWith('field:')) row.fields![target.slice(6)] = v;
        else (row as unknown as Record<string, string>)[target] = v;
      });
      return row;
    });
    setBusy(true);
    setError(null);
    try {
      const out = await workApi.importTasks(listId, payload);
      setResult(out);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label="Import tasks" onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[88vh] w-[48rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white p-5 shadow-xl">
          <div className="mb-3 flex items-center gap-2">
            <FileUp size={17} className="text-brand-600" />
            <h3 className="font-semibold text-gray-900">Import tasks into {listName}</h3>
            <button type="button" title="Close" onClick={onClose} className="ml-auto rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button>
          </div>

          {result ? (
            <div className="min-h-0 overflow-auto text-sm">
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800" role="status">
                Imported {result.created} task{result.created === 1 ? '' : 's'}{result.errors.length ? `, ${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped` : ''}.
              </p>
              {result.errors.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase text-red-600">Skipped rows</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-red-700">{result.errors.map((e) => <li key={`e${e.row}`}>Row {lineOf(e.row)}: {e.message}</li>)}</ul>
                </>
              )}
              {result.warnings.length > 0 && (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase text-amber-600">Imported with notes</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800">{result.warnings.map((w, i) => <li key={`w${i}`}>Row {lineOf(w.row)}: {w.message}</li>)}</ul>
                </>
              )}
              <div className="mt-4 flex justify-end"><button type="button" onClick={onClose} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">Done</button></div>
            </div>
          ) : !rows ? (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-300 px-6 py-10 text-center hover:border-brand-300 hover:bg-brand-50/30">
              <FileUp size={28} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Choose a CSV file</span>
              <span className="text-xs text-gray-500">Export from Excel or Google Sheets as “CSV”. The first row must be the column headings.</span>
              <input type="file" accept=".csv,text/csv" aria-label="CSV file" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
            </label>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <p className="mb-2 text-sm text-gray-600"><b>{fileName}</b> · {body.length} row{body.length === 1 ? '' : 's'}. Match each column to a task field:</p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-sm" aria-label="Column mapping">
                  <thead className="bg-gray-50">
                    <tr>
                      {header.map((h, i) => (
                        <th key={i} className="min-w-[10rem] border-b border-r border-gray-200 px-2 py-1.5 text-left align-top font-medium text-gray-700 last:border-r-0">
                          <span className="block truncate text-xs text-gray-500">{h || `Column ${i + 1}`}</span>
                          <select aria-label={`Map ${h || `column ${i + 1}`}`} value={mapping[i] ?? ''} onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value as Target : x)))}
                            className="mt-1 w-full rounded border border-gray-300 px-1 py-0.5 text-xs font-normal">
                            <option value="">Don't import</option>
                            {TARGETS.map((t) => <option key={t.value} value={t.value} disabled={mapping.includes(t.value) && mapping[i] !== t.value}>{t.label}</option>)}
                            {fields.length > 0 && (
                              <optgroup label="Custom fields">
                                {fields.map((f) => <option key={f.id} value={`field:${f.id}`} disabled={mapping.includes(`field:${f.id}`) && mapping[i] !== `field:${f.id}`}>{f.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {body.slice(0, 5).map((r, i) => (
                      <tr key={i}>{header.map((_, j) => <td key={j} className={`max-w-[14rem] truncate border-b border-r border-gray-100 px-2 py-1 last:border-r-0 ${mapping[j] ? 'text-gray-800' : 'text-gray-300'}`}>{r[j]}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {body.length > 5 && <p className="mt-1 text-xs text-gray-400">…and {body.length - 5} more.</p>}
              <p className="mt-2 text-xs text-gray-500">Dates can be YYYY-MM-DD or DD/MM/YYYY. Priority: Urgent, High, Normal or Low. Several assignees or tags: separate with commas.</p>
              {!hasName && <p className="mt-2 text-xs text-amber-700">Choose which column holds the task name.</p>}
              {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setRows(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Choose another file</button>
                <button type="button" disabled={!hasName || busy} onClick={run} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {busy ? 'Importing…' : `Import ${body.length} task${body.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          )}
          {error && !rows && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      </div>
    </Portal>
  );
};
