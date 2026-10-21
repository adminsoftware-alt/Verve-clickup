// The Assistant, sentence by sentence, against docs/assistant-spec-and-test-plan.md §1.3.
//
// Each row is something a person would actually type, and what the spec says the Assistant must
// make of it. Rows that fail are the to-do list in §1.4, not mistakes in the test -- fix the
// parser, not the expectation, unless the spec itself changes.
//
// The pipeline under test is the part of Assistant.tsx `think()` that needs no server:
// toEnglish -> readIntent -> readWhere / splitTasks / parseCommand / readEdit / readDelete.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import type { Hierarchy } from '../api';
import { readDelete, readEdit, type Change } from './edit';
import { toEnglish } from './hindi';
import { readIntent, type Intent } from './intent';
import { parseCommand, type ParsedCommand, type Person } from './parseCommand';
import { splitTasks } from './splitTasks';
import { readWhere } from './where';

// Monday 12 October 2026, mid-morning.
const NOW = new Date(2026, 9, 12, 10, 0, 0);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

const ME = 'me-id';
const PEOPLE: Person[] = [
  { id: 'aarti', display_name: 'Aarti Yadav', email: 'aarti.yadav@verveadvisory.com' },
  { id: 'laxmi', display_name: 'Laxmi Kadam', email: 'laxmi.kadam@verveadvisory.com' },
  { id: 'vidya', display_name: 'Vidya Khandelwal', email: 'vidya.k@verveadvisory.com' },
];

const list = (id: string, name: string) => ({
  id, name, color: null, is_private: false, archived: false, orderindex: 0,
  permission_level: 'full' as const, open_task_count: 0, assignee_id: null,
});
const HIERARCHY = {
  workspace_id: 'ws', role: 'member', sections: [],
  spaces: [
    { id: 's-acc', name: 'Accounts', color: null, icon: null, is_private: false, archived: false, orderindex: 0,
      permission_level: 'full', folders: [], lists: [list('l-payroll', 'Payroll'), list('l-gst', 'GST Returns')] },
    { id: 's-hol', name: 'Holidays', color: null, icon: null, is_private: false, archived: false, orderindex: 1,
      permission_level: 'full', lists: [],
      folders: [{ id: 'f-sep', name: 'September', color: null, is_private: false, archived: false, orderindex: 0,
        permission_level: 'full', folders: [], lists: [list('l-sep', 'List')] }] },
  ],
  shared_with_me: { folders: [], lists: [], tasks: [] },
  personal_list: null,
} as unknown as Hierarchy;

/** The calendar day of an ISO instant, in local time -- what the person sees on the card. */
const day = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** What the panel makes of a sentence that creates tasks. */
function create(sentence: string) {
  const english = toEnglish(sentence).text;
  const where = readWhere(english, HIERARCHY);
  const forParsing = where.from ? english.replace(where.from, ' ') : english;
  const { tasks } = splitTasks(forParsing, PEOPLE, ME);
  const all: ParsedCommand[] = tasks.length ? tasks : [parseCommand(forParsing, PEOPLE, ME)];
  return { intent: readIntent(english).intent, where, tasks: all };
}

/** Words that belong to a clause and must never survive into a task's name (spec G4). Not
 *  "due": "due diligence" is a real task here. */
const CLAUSE_WORDS = /\b(priorit(?:y|ies)|estimate|assign(?:ed)?|start(?:s|ed|ing)?|deadline|today|tomorrow|hours?|minutes?)\b/i;

// --- 1. Which kind of request ---------------------------------------------------------------

describe('intent: the sentence is read as the right kind of request', () => {
  const cases: [string, Intent][] = [
    ['add task File GSTR-3B due friday', 'create'],
    ['create Close books start today due tomorrow', 'create'],
    ['remind me to call the auditor tomorrow', 'create'],
    ['call the auditor tomorrow', 'create'],
    ['add a task to update the client list', 'create'],
    ['set up review meeting tomorrow', 'create'],
    ['add Close books for Shreeji', 'create'],
    ['started is today and when it is tomorrow priorities normal estimate is 1 hour assign to me and make it as an priority high', 'create'],

    ['change the due date of GSTR-3B to friday', 'update'],
    ['set priority of Close books to urgent', 'update'],
    ['rename Close books to Close Shreeji books', 'update'],
    ['reassign GSTR-3B to Aarti', 'update'],
    ['push the audit to next week', 'update'],
    ['remove the due date of the audit', 'update'],
    ['move GSTR-3B to the Payroll list', 'update'],
    ['set GSTR-3B to in progress', 'update'],

    ['delete GSTR-3B', 'delete'],
    ['remove the Bluepeak task', 'delete'],
    ['get rid of Close books', 'delete'],

    ['mark GSTR-3B done', 'complete'],
    ['close the payroll run', 'complete'],
    ["I've finished the Bluepeak reply", 'complete'],

    ['log 2h on GSTR-3B', 'log_time'],
    ['spent 45 minutes on payroll', 'log_time'],

    ['show my overdue tasks', 'find'],
    ["what's due today", 'find'],
    ['how many hours have I logged this week?', 'ask'],
    ['who is my manager?', 'ask'],
  ];
  test.each(cases)('%s  →  %s', (sentence, intent) => {
    expect(readIntent(toEnglish(sentence).text).intent).toBe(intent);
  });
});

// --- 2. Creating a task: every field, every way of saying it -----------------------------------

interface Want {
  name?: string;
  start?: string | null;
  due?: string | null;
  priority?: number | null;
  estimate?: number | null;
  assignees?: string[];
  list?: string;
}

describe('create: fields are read from the sentence', () => {
  const cases: [string, Want][] = [
    // Everything at once, in the order people usually say it.
    ['add task File GSTR-3B due friday priority high estimate 2h assign to me',
      { name: 'File GSTR-3B', due: '2026-10-16', priority: 2, estimate: 7200, assignees: [ME] }],
    ['create Close books start today due tomorrow', { name: 'Close books', start: '2026-10-12', due: '2026-10-13' }],
    ['remind me to call the auditor tomorrow', { name: 'Call the auditor', due: '2026-10-13' }],
    ['add Prepare MIS today to friday', { name: 'Prepare MIS', start: '2026-10-12', due: '2026-10-16' }],

    // Start dates.
    ['add File TDS starting tomorrow due friday', { name: 'File TDS', start: '2026-10-13', due: '2026-10-16' }],
    ['add Bank reconciliation start date is 14 oct deadline 25 dec',
      { name: 'Bank reconciliation', start: '2026-10-14', due: '2026-12-25' }],
    ['add File TDS, started is today', { name: 'File TDS', start: '2026-10-12' }],

    // Due dates.
    ['add File TDS by tomorrow', { name: 'File TDS', due: '2026-10-13' }],
    ['add File TDS due date is tomorrow', { name: 'File TDS', due: '2026-10-13' }],
    ['add File TDS end date tomorrow', { name: 'File TDS', due: '2026-10-13' }],

    // Priority, said every way.
    ['add Payroll run high priority', { name: 'Payroll run', priority: 2 }],
    ['add Payroll run priority is normal', { name: 'Payroll run', priority: 3 }],
    ['add Payroll run, priorities normal', { name: 'Payroll run', priority: 3 }],
    ['add Payroll run urgent', { name: 'Payroll run', priority: 1 }],
    ['add Payroll run low priority', { name: 'Payroll run', priority: 4 }],
    ['add Payroll run and make it high priority', { name: 'Payroll run', priority: 2 }],
    // Said twice: the later one wins.
    ['add Payroll run priority normal and make it priority high', { name: 'Payroll run', priority: 2 }],
    ['add Payroll run priority high, actually priority low', { name: 'Payroll run', priority: 4 }],

    // Estimates.
    ['add File TDS estimate 2h', { name: 'File TDS', estimate: 7200 }],
    ['add File TDS estimate is 1 hour', { name: 'File TDS', estimate: 3600 }],
    ['add File TDS estimate: 90m', { name: 'File TDS', estimate: 5400 }],
    ['add File TDS should take 30 minutes', { name: 'File TDS', estimate: 1800 }],
    ['add File TDS about 1.5 hours', { name: 'File TDS', estimate: 5400 }],

    // Assignees.
    ['add File TDS assign to Aarti', { name: 'File TDS', assignees: ['aarti'] }],
    ['add File TDS assign to aarti and laxmi', { name: 'File TDS', assignees: ['aarti', 'laxmi'] }],
    ['add File TDS assign it to Laxmi Kadam', { name: 'File TDS', assignees: ['laxmi'] }],

    // Spoken, through a speech recogniser: filler words, articles before values, and "end date"
    // misheard as "in that". From a real attempt in the app -- it names no task, so the
    // Assistant must read the five details and ask only for the name.
    ['Ek task create karo vah task ke liye make me as an assigning make started as a today in that as an tomorrow priority as normal estimated as a 2 hours',
      { name: '', start: '2026-10-12', due: '2026-10-13', priority: 3, estimate: 7200, assignees: [ME] }],
    ['add Bank reconciliation make me as assignee start as a today end date as a friday estimated as a 3 hours',
      { name: 'Bank reconciliation', start: '2026-10-12', due: '2026-10-16', estimate: 10800, assignees: [ME] }],
    ['add GST filing, assignee is Aarti, due on a friday', { name: 'GST filing', due: '2026-10-16', assignees: ['aarti'] }],
    ['add Payroll run assigning to me priority as a high', { name: 'Payroll run', priority: 2, assignees: [ME] }],
    // ...and ordinary words that only look like those mishearings are left alone.
    ['add Check entries in that ledger', { name: 'Check entries in that ledger' }],

    // Sentences the parser was originally written against (see its comments) still work.
    ['add task workup meeting as normal for today to tomorrow and assign to me',
      { name: 'Workup meeting', priority: 3, start: '2026-10-12', due: '2026-10-13', assignees: [ME] }],
    ['add Board pack with normal priority, start date as today, and end date as Friday',
      { name: 'Board pack', priority: 3, start: '2026-10-12', due: '2026-10-16' }],

    // Words that look like fields but are part of the work itself.
    ['add Due diligence for Bluepeak due friday', { name: 'Due diligence for Bluepeak', due: '2026-10-16' }],
    ['add High court filing for Infrabeat', { name: 'High court filing for Infrabeat' }],

    // Where it goes.
    ['add task Close Shreeji Traders books in Payroll list', { name: 'Close Shreeji Traders books', list: 'l-payroll' }],
    ['add Reconcile GSTR-2B to the GST Returns list', { name: 'Reconcile GSTR-2B', list: 'l-gst' }],

    // The sentence from the bug report: every field is there, and there is no task name in it.
    // The Assistant must find all five and then ask for the name -- not make a task called
    // "Started is today and when it is tomorrow priorities normal ...".
    ['started is today and when it is tomorrow priorities normal estimate is 1 hour assign to me and make it as an priority high',
      { name: '', start: '2026-10-12', due: '2026-10-13', priority: 2, estimate: 3600, assignees: [ME] }],
  ];

  test.each(cases)('%s', (sentence, want) => {
    const { tasks, where } = create(sentence);
    const t = tasks[0];
    const got: Want = {};
    if ('name' in want) got.name = t.name;
    if ('start' in want) got.start = day(t.start_date);
    if ('due' in want) got.due = day(t.due_date);
    if ('priority' in want) got.priority = t.priority;
    if ('estimate' in want) got.estimate = t.time_estimate_seconds;
    if ('assignees' in want) got.assignees = t.assignees;
    if ('list' in want) got.list = where.list?.id;
    expect(got).toEqual(want);
  });

  // G4: whatever the parser makes of a sentence, it must not quietly put an instruction into
  // the name. A leftover that still reads like a clause must be reported, not saved.
  test.each(cases.map(([s]) => [s]))('no instruction words left in the name: %s', (sentence) => {
    const t = create(sentence).tasks[0];
    if (CLAUSE_WORDS.test(t.name)) {
      expect(t.confidence, `name "${t.name}" still holds an instruction`).toBe('low');
    }
  });
});

describe('create: several tasks in one sentence', () => {
  test('two tasks joined by "and"', () => {
    const { tasks } = create('add call the auditor tomorrow and draft the reply by friday');
    expect(tasks.map((t) => [t.name, day(t.due_date)])).toEqual([
      ['Call the auditor', '2026-10-13'],
      ['Draft the reply', '2026-10-16'],
    ]);
  });
});

// --- 3. Changing a task -----------------------------------------------------------------------

/** A change as the card shows it: field and value, without the working. */
const shown = (c: Change) => {
  if (c.field === 'list') return { field: 'list', value: c.said.toLowerCase().replace(/^the\s+/, '') };
  if (c.field === 'status') return { field: 'status', value: c.said };
  if (c.field === 'due_date' || c.field === 'start_date') return { field: c.field, value: day(c.value) };
  return { field: c.field, value: c.value };
};
/** How the task was referred to, without the article -- what gets searched for. */
const which = (s: string) => s.toLowerCase().replace(/^the\s+/, '').trim();

describe('update: which task, and what changes', () => {
  const cases: [string, string, { field: string; value: unknown }[]][] = [
    ['change the due date of GSTR-3B to friday', 'gstr-3b', [{ field: 'due_date', value: '2026-10-16' }]],
    ['set priority of Close books to urgent', 'close books', [{ field: 'priority', value: 1 }]],
    ['rename Close books to Close Shreeji books', 'close books', [{ field: 'name', value: 'Close Shreeji books' }]],
    ['reassign GSTR-3B to Aarti', 'gstr-3b', [{ field: 'assignees', value: ['aarti'] }]],
    ['push the audit to next week', 'audit', [{ field: 'due_date', value: '2026-10-19' }]],
    ['clear the estimate of the audit', 'audit', [{ field: 'estimate', value: null }]],
    ['remove the due date of the audit', 'audit', [{ field: 'due_date', value: null }]],
    ['set start date of payroll to today', 'payroll', [{ field: 'start_date', value: '2026-10-12' }]],
    ['change the estimate of payroll to 3 hours', 'payroll', [{ field: 'estimate', value: 10800 }]],
    ['move GSTR-3B to the Payroll list', 'gstr-3b', [{ field: 'list', value: 'payroll list' }]],
    // Two changes in one sentence.
    ['change the due date of GSTR-3B to friday and make it high priority', 'gstr-3b', [
      { field: 'due_date', value: '2026-10-16' }, { field: 'priority', value: 2 }]],
    // Status other than done (spec §1.3, "Required addition").
    ['set GSTR-3B to in progress', 'gstr-3b', [{ field: 'status', value: 'in progress' }]],
    ['mark payroll as on hold', 'payroll', [{ field: 'status', value: 'on hold' }]],
    ['change the status of the audit to review', 'audit', [{ field: 'status', value: 'review' }]],
  ];
  test.each(cases)('%s', (sentence, task, changes) => {
    const read = readEdit(toEnglish(sentence).text, PEOPLE, ME);
    expect({ which: which(read.which), changes: read.changes.map(shown) }).toEqual({ which: task, changes });
  });
});

// --- 4. Deleting a task -------------------------------------------------------------------------

describe('delete: which task, and never a field', () => {
  const cases: [string, string | null][] = [
    ['delete GSTR-3B', 'gstr-3b'],
    ['remove the Bluepeak task', 'bluepeak'],
    ['get rid of Close books', 'close books'],
    ['please delete the payroll run', 'payroll run'],
    // Clearing a field is an update, never a delete.
    ['remove the due date of the audit', null],
    ['delete the priority of payroll', null],
  ];
  test.each(cases)('%s', (sentence, task) => {
    const got = readDelete(toEnglish(sentence).text);
    expect(got === null ? null : which(got).replace(/\s+task$/, '')).toBe(task);
  });
});
