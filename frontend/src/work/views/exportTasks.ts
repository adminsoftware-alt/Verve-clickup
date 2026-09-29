// Download tasks as a spreadsheet, a CSV, or a PDF to send someone.
//
// The three are not the same request. A spreadsheet is for working on the numbers, a CSV is for
// feeding another system, and a PDF is for a person who is going to read it -- a client, a
// partner, a file -- which is why the PDF is laid out rather than being a grid of cells.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { CustomField, Task, UserRef } from '../api';
import { PRIORITIES, formatDuration, toDateInput } from '../ui';
import { valueText } from '../fields/FieldValue';

export function taskRows(tasks: Task[], fields: CustomField[], people: UserRef[], listName: (id: string) => string | null): Record<string, string | number>[] {
  return tasks.map((t) => {
    const row: Record<string, string | number> = {
      'Task ID': t.custom_id ?? '',
      Task: t.name,
      Status: t.status.name,
      Assignees: t.assignees.map((u) => u.display_name || u.email).join(', '),
      Priority: t.priority ? PRIORITIES[t.priority].label : '',
      'Start date': toDateInput(t.start_date),
      'Due date': toDateInput(t.due_date),
      'Time estimate (h)': t.time_estimate_seconds ? Math.round((t.time_estimate_seconds / 3600) * 100) / 100 : '',
      'Time tracked (h)': t.time_tracked_seconds ? Math.round((t.time_tracked_seconds / 3600) * 100) / 100 : '',
      Tags: t.tags.map((x) => x.name).join(', '),
      List: listName(t.list_id) ?? '',
      Created: toDateInput(t.created_at),
    };
    fields.forEach((f) => {
      const v = t.custom_fields?.[f.id];
      row[f.name] = typeof v === 'number' ? v : valueText(f, v, people);
    });
    return row;
  });
}

export type ExportFormat = 'xlsx' | 'csv' | 'pdf';

/** Columns a printed page has no room for; the spreadsheet still carries them. */
const PDF_SKIP = ['Created'];

/**
 * A PDF someone can actually read: landscape, a title saying what it is and when it was taken,
 * the rows striped, and a page number on every sheet. A spreadsheet dumped into a PDF is neither
 * a spreadsheet nor a document.
 */
function tasksPdf(filename: string, rows: Record<string, string | number>[], title?: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const columns = Object.keys(rows[0] ?? { Task: '' }).filter((c) => !PDF_SKIP.includes(c));
  const width = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(17, 24, 39);
  doc.text(title || filename, 40, 40);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(
    `${rows.length} task${rows.length === 1 ? '' : 's'} · ${new Date().toLocaleString()}`,
    40,
    56,
  );

  autoTable(doc, {
    startY: 72,
    head: [columns],
    body: rows.map((r) => columns.map((c) => String(r[c] ?? ''))),
    styles: { fontSize: 8, cellPadding: 5, overflow: 'linebreak', textColor: [31, 41, 55] },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 249, 248] },
    columnStyles: { 1: { cellWidth: 190 } },  // the task name needs the room
    margin: { left: 40, right: 40, bottom: 40 },
    didDrawPage: () => {
      const page = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(`Page ${page}`, width - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
    },
  });
  doc.save(`${filename}.pdf`);
}

export function exportTasks(
  format: ExportFormat, filename: string, rows: Record<string, string | number>[], title?: string,
): void {
  if (format === 'pdf') return tasksPdf(filename, rows, title);
  const sheet = XLSX.utils.json_to_sheet(rows);
  if (format === 'csv') {
    const blob = new Blob([`﻿${XLSX.utils.sheet_to_csv(sheet)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Tasks');
  XLSX.writeFile(book, `${filename}.xlsx`);
}

export { formatDuration };
