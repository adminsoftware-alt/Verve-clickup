// Download tasks as Excel or CSV, as ClickUp's view export does.
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

export function exportTasks(format: 'xlsx' | 'csv', filename: string, rows: Record<string, string | number>[]): void {
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
