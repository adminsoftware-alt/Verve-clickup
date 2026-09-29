// One Export control, offering the same three everywhere.
//
// Export used to be a single button that silently produced an .xlsx. Three different people want
// three different things from it -- a spreadsheet to work in, a CSV to feed something else, a PDF
// to send to a client -- and a button that picks one of them for you is right a third of the time.
import React from 'react';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';

import { Menu } from '../ui';
import { exportTasks, type ExportFormat } from './exportTasks';

const CHOICES: { format: ExportFormat; label: string; Icon: React.ElementType; hint: string }[] = [
  { format: 'xlsx', label: 'Excel', Icon: FileSpreadsheet, hint: 'A workbook to work in' },
  { format: 'csv', label: 'CSV', Icon: Sheet, hint: 'For feeding another system' },
  { format: 'pdf', label: 'PDF', Icon: FileText, hint: 'Laid out to read and to send' },
];

export const ExportMenu: React.FC<{
  /** Called for the chosen format; the rows are built here so nothing is computed until asked. */
  rows: () => Record<string, string | number>[];
  filename: string;
  /** The heading on the PDF. Defaults to the file name. */
  title?: string;
  /** Matches the toolbar it sits in. */
  className?: string;
}> = ({ rows, filename, title, className }) => (
  <Menu
    align="right"
    label="Export"
    width={210}
    items={CHOICES.map((c) => ({
      label: c.label,
      icon: <c.Icon size={14} className="text-gray-400" />,
      onClick: () => {
        const data = rows();
        // Exporting nothing produces a file with a header row and no rows, which looks like a
        // failure. Say so instead.
        if (!data.length) return;
        exportTasks(c.format, filename, data, title);
      },
    }))}
    trigger={
      <span className={className ?? 'flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50'}>
        <Download size={14} /> Export
      </span>
    }
  />
);
