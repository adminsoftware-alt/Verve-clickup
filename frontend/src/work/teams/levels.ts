// The firm's six levels, L1 at the top. The number is the rung, apart from the job title:
// "Executive" and "Senior Executive" are two designations, and only the level sorts the same way
// everywhere -- the org chart, the People table and the onboarding workbook all use these.
export const LEVEL_NAMES: Record<number, string> = {
  1: 'Leadership',        // Partner, Director
  2: 'Senior Management', // Associate Director, Senior Manager
  3: 'Management',        // Manager, Deputy Manager
  4: 'Senior Staff',      // Assistant Manager, Senior Executive
  5: 'Staff',             // Executive, Associate, Accountant
  6: 'Trainees',          // Article Assistant, Intern
};

export const LEVELS = [1, 2, 3, 4, 5, 6];

/** "L3" */
export const levelTag = (n: number) => `L${n}`;
/** "L3 · Management" */
export const levelLabel = (n: number) => `L${n} · ${LEVEL_NAMES[n] ?? ''}`;

/** A level as typed in a spreadsheet: "L3", "l3", "3", "L3 · Management" → 3. Anything else is left for the server to refuse. */
export function parseLevel(raw: unknown): number | undefined {
  const m = String(raw ?? '').trim().match(/^l?\s*(\d+)/i);
  return m ? Number(m[1]) : undefined;
}

export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Article', 'Intern', 'Consultant'] as const;
