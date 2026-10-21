// The onboarding workbook in public/templates must read back through the importer's own parsing:
// a renamed header there would silently drop a column for every person in the firm.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { rowsFromSheet, teamsFromSheet } from './AdminDialogs';

const book = XLSX.read(readFileSync(resolve(__dirname, '../../../public/templates/verve-people-onboarding.xlsx')), { cellDates: true });
const headers = (sheet: string) => (XLSX.utils.sheet_to_json<string[]>(book.Sheets[sheet], { header: 1 })[0] ?? []) as string[];

describe('the onboarding workbook', () => {
  it('has Read me, Teams and People sheets', () => {
    expect(book.SheetNames).toEqual(['Read me', 'Teams', 'People']);
  });

  it('maps every People column to an importer field', () => {
    const record = Object.fromEntries(headers('People').map((h) => [h, 'x']));
    record['Work email *'] = 'priya.nair@verveadvisory.com';
    record['Date of joining *'] = '01/09/2024';
    const { rows, missing } = rowsFromSheet([record]);
    expect(missing).toEqual([]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'date_of_birth', 'date_of_joining', 'department', 'designation', 'email', 'employee_code', 'location',
      'manager_email', 'marriage_anniversary', 'name', 'phone', 'role', 'teams',
    ]);
    expect(rows[0].date_of_joining).toBe('2024-09-01'); // DD/MM/YYYY, as written in India
  });

  it('reads the Teams sheet', () => {
    const [name, parent, description] = headers('Teams');
    expect(teamsFromSheet([{ [name]: 'GST', [parent]: 'Tax', [description]: 'Returns' }]))
      .toEqual([{ name: 'GST', parent: 'Tax', description: 'Returns' }]);
  });

  it('imports nothing from an empty template', () => {
    const people = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.People, { defval: '', raw: true });
    expect(rowsFromSheet(people).rows).toEqual([]);
  });
});
