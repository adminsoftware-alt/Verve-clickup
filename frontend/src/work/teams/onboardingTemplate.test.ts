// The onboarding workbook in public/templates must read back through the importer's own parsing:
// a renamed header there would silently drop a column for every person in the firm.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
// Vite hands the file over as a data URL, so the test needs nothing from Node (the app's
// type-check, which the production build runs, has no Node types).
import template from '../../../public/templates/verve-people-onboarding.xlsx?inline';
import { rowsFromSheet, teamsFromSheet } from './AdminDialogs';

const book = XLSX.read(template.slice(template.indexOf(',') + 1), { type: 'base64', cellDates: true });
const headers = (sheet: string) => (XLSX.utils.sheet_to_json<string[]>(book.Sheets[sheet], { header: 1 })[0] ?? []) as string[];

describe('the onboarding workbook', () => {
  it('has Read me, Teams and People sheets, an Example and the hidden Lists', () => {
    expect(book.SheetNames).toEqual(['Read me', 'Teams', 'People', 'Example', 'Lists']);
  });

  it('maps every People column to an importer field', () => {
    const record = Object.fromEntries(headers('People').map((h) => [h, 'x']));
    record['Work email *'] = 'priya.nair@verveadvisory.com';
    record['Date of joining *'] = '01/09/2024';
    record['Level *'] = 'L4';
    const { rows, missing } = rowsFromSheet([record]);
    expect(missing).toEqual([]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      'address', 'date_of_birth', 'date_of_joining', 'department', 'designation', 'email', 'emergency_contact_name',
      'emergency_contact_phone', 'employee_code', 'employment_type', 'level', 'location',
      'manager_email', 'marriage_anniversary', 'name', 'phone', 'role', 'teams',
    ]);
    expect(rows[0].date_of_joining).toBe('2024-09-01'); // DD/MM/YYYY, as written in India
    expect(rows[0].level).toBe(4); // "L4" from the dropdown
  });

  it('reads the Example rows whole, address included', () => {
    const example = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets.Example, { defval: '', raw: true });
    const { rows } = rowsFromSheet(example);
    expect(rows).toHaveLength(3);
    const priya = rows[1];
    expect(priya).toMatchObject({
      name: 'Priya Nair', email: 'priya.nair@verveadvisory.com', role: 'Employee', level: 5, employment_type: 'Full-time',
      teams: 'Tax, GST', manager_email: 'anil.mehta@verveadvisory.com', date_of_joining: '2024-07-01', location: 'Mumbai',
    });
    expect(priya.address).toBe('B-7, Green Park Society\nAndheri East\nMumbai, Maharashtra - 400069\nIndia');
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
