// The assistant against the phrases people actually say, through `interpret` -- the one function
// everything the panel understands goes through.
//
// Started as a QA pass's phrase matrix: 117 sentences, of which 82 were read correctly. Each row
// is a sentence and what it must come out as; a failing row is a bug in the reading, not in the
// row, unless the row asks for something the assistant has deliberately chosen not to do.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import type { Hierarchy } from '../api';
import { interpret, searchable, type Reading } from './interpret';
import { matchPerson, type Person } from './parseCommand';
import { sayRepeat } from './recurrence';
import { readDuration, pastDay, tidy } from './tidy';
import { askedAbout, topicOf } from './topics';
import { holdingAll, pickMatch } from './match';
import { forget, ownerOf, remember, sessions } from './history';

// Wednesday 14 October 2026, 10:00.
const NOW = new Date(2026, 9, 14, 10, 0, 0);
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterAll(() => { vi.useRealTimers(); });

const ME = 'me-id';
const PEOPLE: Person[] = [
  { id: 'me-id', display_name: 'Harish Kandi', email: 'harish@verveadvisory.com' },
  { id: 'aarti', display_name: 'Aarti Yadav', email: 'aarti.yadav@verveadvisory.com' },
  { id: 'laxmi', display_name: 'Laxmi Kadam', email: 'laxmi.kadam@verveadvisory.com' },
  { id: 'aditya', display_name: 'Aditya Sharma', email: 'aditya@verveadvisory.com' },
  { id: 'aditi', display_name: 'Aditi Jain', email: 'aditi.jain@verveadvisory.com' },
  { id: 'asmita', display_name: 'Asmita Patil', email: 'asmita.patil@verveadvisory.com' },
  // The two names from the bug report: "do" and "MIS" used to find them.
  { id: 'sayam', display_name: 'Sayam Doshi', email: 'sayam.doshi@verveadvisory.com' },
  { id: 'pushpa', display_name: 'Pushpadevi Mishra', email: 'pushpadevi.mishra@verveadvisory.com' },
];
const list = (id: string, name: string) => ({
  id, name, color: null, is_private: false, archived: false, orderindex: 0,
  permission_level: 'full' as const, open_task_count: 0, assignee_id: null,
});
const HIERARCHY = {
  workspace_id: 'ws', role: 'member', sections: [],
  spaces: [
    { id: 's-acc', name: 'Accounts', color: null, icon: null, is_private: false, archived: false, orderindex: 0,
      permission_level: 'full', folders: [], lists: [list('l-payroll', 'Payroll'), list('l-gst', 'GST Returns'), list('l-skills', 'Skills')] },
  ],
  shared_with_me: { folders: [], lists: [], tasks: [] },
  personal_list: null,
} as unknown as Hierarchy;

const day = (iso: string | null | undefined) => {
  if (!iso) return undefined;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Flat = Record<string, unknown>;
/** A reading, flattened to the handful of things a row checks. */
function flat(r: Reading): Flat {
  const o: Flat = { intent: r.kind };
  if (r.kind === 'create') {
    const t = r.tasks[0];
    Object.assign(o, {
      name: t.name, due: day(t.due_date), start: day(t.start_date), pri: t.priority ?? undefined,
      asg: t.assignees.length ? t.assignees.join('+') : undefined, est: t.time_estimate_seconds ?? undefined,
      rec: t.recurrence ? sayRepeat(t.recurrence) : undefined, count: r.tasks.length,
      list: r.where.list?.name, unk: t.unknown.length ? t.unknown.join('; ') : undefined,
    });
  } else if (r.kind === 'update') {
    o.which = r.which;
    o.changes = r.changes.map((c) => {
      if (c.field === 'list' || c.field === 'status') return `${c.field}=${c.said}`;
      if (c.field === 'due_date' || c.field === 'start_date') return `${c.field}=${day(c.value) ?? 'null'}`;
      if (c.field === 'recurrence') return `recurrence=${sayRepeat(c.value)}`;
      return `${c.field}=${JSON.stringify(c.value)}`;
    }).join(', ');
  } else if (r.kind === 'complete' || r.kind === 'delete') {
    o.which = r.which;
  } else if (r.kind === 'log_time') {
    Object.assign(o, { seconds: r.seconds, which: r.which, day: day(r.day) });
  } else if (r.kind === 'timer') {
    Object.assign(o, { action: r.action, which: r.which });
  } else if (r.kind === 'comment') {
    Object.assign(o, { which: r.which, body: r.body });
  } else if (r.kind === 'find') {
    Object.assign(o, { due: r.due ?? undefined, person: r.person?.id, search: r.search || undefined });
  } else if (r.kind === 'ask') {
    Object.assign(o, { topic: r.topic, about: r.about?.id, day: day(r.day), which: r.which || undefined });
  }
  return o;
}

const read = (s: string) => flat(interpret(s, { people: PEOPLE, me: ME, hierarchy: HIERARCHY, now: NOW }));

type Row = [string, Flat];

/** Check only the keys a row names; `undefined` in a row means "must not be set". */
function rows(cases: Row[]) {
  test.each(cases)('%s', (phrase, want) => {
    const got = read(phrase);
    const picked: Flat = {};
    for (const k of Object.keys(want)) picked[k] = got[k];
    expect(picked).toEqual(want);
  });
}

describe('create', () => rows([
  ['call the auditor', { intent: 'create', name: 'Call the auditor' }],
  ['add task prepare board pack', { intent: 'create', name: 'Prepare board pack' }],
  ['call the auditor today', { intent: 'create', name: 'Call the auditor', due: '10-14' }],
  ['call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['file GST return next friday', { intent: 'create', name: 'File GST return', due: '10-23' }],
  ['add task file GST return by 25 dec', { intent: 'create', name: 'File GST return', due: '12-25' }],
  ['add task send invoices in 3 days', { intent: 'create', name: 'Send invoices', due: '10-17' }],
  ['add task send invoices in three days', { intent: 'create', name: 'Send invoices', due: '10-17' }],
  ['add task close books by end of month', { intent: 'create', name: 'Close books', due: '10-31' }],
  ['send invoices end of month', { intent: 'create', name: 'Send invoices', due: '10-31' }],
  ['add task review payroll due 25 dec', { intent: 'create', name: 'Review payroll', due: '12-25' }],
  ['add task review payroll on monday', { intent: 'create', name: 'Review payroll', due: '10-19' }],
  ['add urgent task fix the server', { intent: 'create', name: 'Fix the server', pri: 1 }],
  ['add a high priority task fix the server', { intent: 'create', name: 'Fix the server', pri: 2 }],
  ['add task fix the server urgent', { intent: 'create', name: 'Fix the server', pri: 1 }],
  ['add task fix the server high priority', { intent: 'create', name: 'Fix the server', pri: 2 }],
  ['add task tidy the drive low priority', { intent: 'create', name: 'Tidy the drive', pri: 4 }],
  ['add task High court filing', { intent: 'create', name: 'High court filing', pri: undefined }],
  ['add task call the bank assign to Aarti', { intent: 'create', name: 'Call the bank', asg: 'aarti' }],
  // From the 29 October test pass: the second name used to stay in the task's name.
  ['add review payroll for Aarti and Aditya by 5 Nov', { intent: 'create', name: 'Review payroll', asg: 'aarti+aditya', due: '11-05' }],
  ['add task for me and Aarti to prepare MIS', { intent: 'create', name: 'Prepare MIS', asg: 'me-id+aarti' }],
  ['Aarti ko payroll ka task do kal tak', { intent: 'create', name: 'Payroll', asg: 'aarti', due: '10-15' }],
  ['plz add a tsk to chk bank stmt', { intent: 'create', name: 'Chk bank stmt' }],
  ['add task call the bank assign to Aditya Sharma', { intent: 'create', name: 'Call the bank', asg: 'aditya' }],
  ['add task call the bank assign to me', { intent: 'create', name: 'Call the bank', asg: ME }],
  ['add task call the bank for Aarti', { intent: 'create', name: 'Call the bank', asg: 'aarti' }],
  ['add task call the bank for Aarti tomorrow', { intent: 'create', name: 'Call the bank', asg: 'aarti', due: '10-15' }],
  // A surname after "for" is a client, not a colleague.
  ['add task prepare report for Sharma and Co', { intent: 'create', name: 'Prepare report for Sharma and Co', asg: undefined }],
  ['add task call the bank and assign it to Aditi', { intent: 'create', name: 'Call the bank', asg: 'aditi' }],
  ['add task draft memo estimate 2h', { intent: 'create', name: 'Draft memo', est: 7200 }],
  ['add task draft memo estimate 90 minutes', { intent: 'create', name: 'Draft memo', est: 5400 }],
  ['add task draft memo estimate 2.30', { intent: 'create', name: 'Draft memo', est: 9000 }],
  ['add task draft memo estimate 2.5', { intent: 'create', name: 'Draft memo', est: 9000 }],
  ['add task draft memo should take 2 hours', { intent: 'create', name: 'Draft memo', est: 7200 }],
  ['add task draft memo should take two hours', { intent: 'create', name: 'Draft memo', est: 7200 }],
  ['add task draft memo estimate thirty minutes', { intent: 'create', name: 'Draft memo', est: 1800 }],
  ['add task draft memo 2h', { intent: 'create', name: 'Draft memo', est: 7200 }],
  ['add task call 2 clients', { intent: 'create', name: 'Call 2 clients', est: undefined }],
  ['add task reconcile salaries to the Payroll list', { intent: 'create', name: 'Reconcile salaries', list: 'Payroll' }],
  ['add task reconcile salaries in payroll', { intent: 'create', name: 'Reconcile salaries', list: 'Payroll' }],
  ['add task prepare the detailed quarterly compliance report for Sharma and Co including GST TDS and PF reconciliations',
    { intent: 'create', name: 'Prepare the detailed quarterly compliance report for Sharma and Co including GST TDS and PF reconciliations' }],
  ['add task delete old backups', { intent: 'create', name: 'Delete old backups' }],
  ['add task plan tomorrow meeting agenda', { intent: 'create', name: 'Plan tomorrow meeting agenda' }],
  ['add task remove duplicate invoices', { intent: 'create', name: 'Remove duplicate invoices' }],
  ['add task mark attendance done for interns', { intent: 'create', name: 'Mark attendance done for interns' }],
  ['add task close books start today due friday high priority estimate 3h assign to me',
    { intent: 'create', name: 'Close books', start: '10-14', due: '10-16', pri: 2, est: 10800, asg: ME }],
  ['add task close books due friday high priority', { intent: 'create', name: 'Close books', due: '10-16', pri: 2 }],
  ['call the auditor, file the return and book the venue friday', { intent: 'create', count: 3, name: 'Call the auditor' }],
  ['add task Update client list', { intent: 'create', name: 'Update client list' }],
  ['add a task to update the client list', { intent: 'create', name: 'Update the client list', list: undefined }],
  ['add task Sunday review', { intent: 'create', name: 'Sunday review' }],
  ['add task call Monday Motors', { intent: 'create', name: 'Call Monday Motors' }],
  ['add task weekly review', { intent: 'create', name: 'Weekly review', rec: undefined }],
]));

describe('create: repeats', () => rows([
  ['add pay rent every monday', { intent: 'create', name: 'Pay rent', rec: 'Every Mon', due: '10-19' }],
  ['add task submit TDS return monthly', { intent: 'create', name: 'Submit TDS return', rec: 'Every month on day 14' }],
  ['add task check bank balance daily', { intent: 'create', name: 'Check bank balance', rec: 'Every day' }],
  ['add task review timesheets every 2 weeks', { intent: 'create', name: 'Review timesheets', rec: 'Every 2 weeks on Wed' }],
  ['add task pay rent on the 5th of every month', { intent: 'create', name: 'Pay rent', rec: 'Every month on day 5', due: '11-05' }],
  ['add task team standup every weekday', { intent: 'create', name: 'Team standup', rec: 'Every weekday' }],
]));

describe('create: typing, politeness and spelling', () => rows([
  ['please add task call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['can you add a task to call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['could you please add task call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['ADD TASK CALL THE AUDITOR TOMORROW', { intent: 'create', name: 'CALL THE AUDITOR', due: '10-15' }],
  ['add task call the auditor tomorrow!!', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['add task call the auditor tommorow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['add task call the auditor tomorow.', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['add task call the auditor on fridy', { intent: 'create', name: 'Call the auditor', due: '10-16' }],
  ['add task call the auditor on wednsday', { intent: 'create', name: 'Call the auditor', due: '10-21' }],
  ['remind me to call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['i need to call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15' }],
  ['remind me tomorrow to call the bank', { intent: 'create', name: 'Call the bank', due: '10-15' }],
  ['add a task for me to call the bank', { intent: 'create', name: 'Call the bank', asg: ME }],
  ['add a task for Aarti to call the bank', { intent: 'create', name: 'Call the bank', asg: 'aarti' }],
  ['set a reminder to call the bank tomorrow', { intent: 'create', due: '10-15' }],
]));

describe('not a task: unknown sentences say so instead', () => rows([
  ['play some music', { intent: 'unknown' }],
  ["what's the weather like", { intent: 'unknown' }],
  ['hello there', { intent: 'unknown' }],
  ['the quarterly numbers', { intent: 'unknown' }],
]));

describe('update', () => rows([
  ['rename Close books to Close October books', { intent: 'update', which: 'Close books', changes: 'name="Close October books"' }],
  ['change the due date of GST return to tomorrow', { intent: 'update', which: 'GST return', changes: 'due_date=10-15' }],
  ['push the audit to next week', { intent: 'update', which: 'audit', changes: 'due_date=10-19' }],
  ['move the audit to friday', { intent: 'update', which: 'audit', changes: 'due_date=10-16' }],
  ['set priority of Close books to urgent', { intent: 'update', which: 'Close books', changes: 'priority=1' }],
  ['make Close books high priority', { intent: 'update', which: 'Close books', changes: 'priority=2' }],
  ['make it urgent', { intent: 'update', which: '', changes: 'priority=1' }],
  ['change Close books priority to low', { intent: 'update', which: 'Close books', changes: 'priority=4' }],
  ['move GST return to in progress', { intent: 'update', which: 'GST return', changes: 'status=in progress' }],
  ['set GST return to on hold', { intent: 'update', which: 'GST return', changes: 'status=on hold' }],
  ['set GST return to in progress and make it urgent', { intent: 'update', which: 'GST return', changes: 'status=in progress, priority=1' }],
  ['change status of GST return to review', { intent: 'update', which: 'GST return', changes: 'status=review' }],
  ['set estimate of GST return to 3h', { intent: 'update', which: 'GST return', changes: 'estimate=10800' }],
  ['add estimate 2h to GST return', { intent: 'update', which: 'GST return', changes: 'estimate=7200' }],
  ['add an estimate of 90 minutes to GST return', { intent: 'update', which: 'GST return', changes: 'estimate=5400' }],
  ['set start date of GST return to monday', { intent: 'update', which: 'GST return', changes: 'start_date=10-19' }],
  ['move GST return to the Payroll list', { intent: 'update', which: 'GST return', changes: 'list=the Payroll list' }],
  ['change the due date of Close books to 25 dec and make it high priority', { intent: 'update', which: 'Close books', changes: 'due_date=12-25, priority=2' }],
  ['clear the due date of Close books', { intent: 'update', which: 'Close books', changes: 'due_date=null' }],
  ['archive Close books', { intent: 'update', which: 'Close books', changes: 'archived=true' }],
  ['unarchive Close books', { intent: 'update', which: 'Close books', changes: 'archived=false' }],
]));

describe('update: who is on it', () => rows([
  ['reassign GST return to Aarti', { intent: 'update', which: 'GST return', changes: 'assignees=["aarti"]' }],
  ['assign GST return to Laxmi', { intent: 'update', which: 'GST return', changes: 'add_assignees=["laxmi"]' }],
  ['assign the GST return to Laxmi and Aarti', { intent: 'update', which: 'GST return', changes: 'add_assignees=["laxmi","aarti"]' }],
  ['give GST return to Asmita', { intent: 'update', which: 'GST return', changes: 'assignees=["asmita"]' }],
  ['hand over the audit to Asmita', { intent: 'update', which: 'audit', changes: 'assignees=["asmita"]' }],
  ['hand the audit over to Asmita', { intent: 'update', which: 'audit', changes: 'assignees=["asmita"]' }],
  ['unassign Aarti from GST return', { intent: 'update', which: 'GST return', changes: 'remove_assignees=["aarti"]' }],
  ['remove Aarti from GST return', { intent: 'update', which: 'GST return', changes: 'remove_assignees=["aarti"]' }],
  ['take Aarti off the audit', { intent: 'update', which: 'audit', changes: 'remove_assignees=["aarti"]' }],
  ['remove the assignee of GST return', { intent: 'update', which: 'GST return', changes: 'assignees=[]' }],
  ['unassign GST return', { intent: 'update', which: 'GST return', changes: 'assignees=[]' }],
  ['change the assignee of GST return to Aditya', { intent: 'update', which: 'GST return', changes: 'assignees=["aditya"]' }],
  ['assign it to me', { intent: 'update', which: '', changes: `add_assignees=["${ME}"]` }],
]));

describe('update: tags and repeats', () => rows([
  ['add tag urgent-client to GST return', { intent: 'update', which: 'GST return', changes: 'add_tags=["urgent-client"]' }],
  ['tag GST return as follow-up', { intent: 'update', which: 'GST return', changes: 'add_tags=["follow-up"]' }],
  ['remove tag urgent-client from GST return', { intent: 'update', which: 'GST return', changes: 'remove_tags=["urgent-client"]' }],
  ['make GST return repeat every monday', { intent: 'update', which: 'GST return', changes: 'recurrence=Every Mon' }],
  ['set Close books to repeat monthly', { intent: 'update', which: 'Close books', changes: 'recurrence=Every month' }],
  ['repeat payroll run every 2 weeks', { intent: 'update', which: 'payroll run', changes: 'recurrence=Every 2 weeks' }],
  ['stop repeating payroll run', { intent: 'update', which: 'payroll run', changes: 'recurrence=Does not repeat' }],
]));

describe('complete', () => rows([
  ['mark GST return done', { intent: 'complete', which: 'GST return' }],
  ['mark the GST return as complete', { intent: 'complete', which: 'GST return' }],
  ['Can you please mark GST return done', { intent: 'complete', which: 'GST return' }],
  ['Mark GST return as Done.', { intent: 'complete', which: 'GST return' }],
  ['close the payroll run', { intent: 'complete', which: 'payroll run' }],
  ["I've finished the Bluepeak reply", { intent: 'complete', which: 'Bluepeak reply' }],
]));

describe('delete', () => rows([
  ['delete task GST return', { intent: 'delete', which: 'GST return' }],
  ['delete the GST return task', { intent: 'delete', which: 'GST return' }],
  ['remove Close books', { intent: 'delete', which: 'Close books' }],
  ['get rid of the payroll draft', { intent: 'delete', which: 'payroll draft' }],
  ['delete task Update due date sheet', { intent: 'delete', which: 'Update due date sheet' }],
  ['delete it', { intent: 'delete', which: '' }],
  ['could you delete Close books', { intent: 'delete', which: 'Close books' }],
  ['GST return ko delete karo', { intent: 'delete', which: 'GST return' }],
]));

describe('time', () => rows([
  ['log 2 hours on GST return', { intent: 'log_time', seconds: 7200, which: 'GST return', day: undefined }],
  ['log 90 minutes on Close books', { intent: 'log_time', seconds: 5400, which: 'Close books' }],
  ['spent 1.5 hours on payroll', { intent: 'log_time', seconds: 5400, which: 'payroll' }],
  ['log 2h on GST return yesterday', { intent: 'log_time', seconds: 7200, which: 'GST return', day: '10-13' }],
  ['log 3 hours on the audit on Monday', { intent: 'log_time', seconds: 10800, which: 'audit', day: '10-12' }],
  ['yesterday I worked 2 hours on payroll', { intent: 'log_time', seconds: 7200, which: 'payroll', day: '10-13' }],
  ['I worked 3 hours on the audit', { intent: 'log_time', seconds: 10800, which: 'audit' }],
  ['log two hours on GST return', { intent: 'log_time', seconds: 7200, which: 'GST return' }],
  ['log half an hour on GST return', { intent: 'log_time', seconds: 1800, which: 'GST return' }],
  ['kal GST return pe 2 ghante log kiye', { intent: 'log_time', seconds: 7200, which: 'GST return', day: '10-13' }],
  ['start timer on GST return', { intent: 'timer', action: 'start', which: 'GST return' }],
  ['start the timer for the audit', { intent: 'timer', action: 'start', which: 'audit' }],
  ['stop timer', { intent: 'timer', action: 'stop' }],
  ['stop the timer', { intent: 'timer', action: 'stop' }],
]));

describe('comments', () => rows([
  ['comment on GST return: waiting for client docs', { intent: 'comment', which: 'GST return', body: 'waiting for client docs' }],
  ['add a comment to the audit saying sent to partner', { intent: 'comment', which: 'audit', body: 'sent to partner' }],
  ['add comment waiting for client docs on GST return', { intent: 'comment', which: 'GST return', body: 'waiting for client docs' }],
]));

describe('questions', () => rows([
  ["what's due today", { intent: 'find', due: 'today' }],
  ['what is overdue', { intent: 'find', due: 'overdue' }],
  ["what's due tomorrow", { intent: 'find', due: 'tomorrow' }],
  ['what is due tomorrow?', { intent: 'find', due: 'tomorrow' }],
  ['how many tasks do I have', { intent: 'ask', topic: 'tasks', about: undefined }],
  // A Hinglish question with a day in it was made into a task called "My kaam kya" on the spot.
  ['mera aaj ka kaam kya hai', { intent: 'ask' }],
  ['mera manager kaun hai', { intent: 'ask' }],
  ['how many open tasks do I have', { intent: 'ask', topic: 'tasks', about: undefined }],
  ['what did I finish this week', { intent: 'ask', topic: 'done' }],
  ['what did I complete this week?', { intent: 'ask', topic: 'done' }],
  ['who is working on GST return', { intent: 'ask', topic: 'who', which: 'GST return' }],
  ['who is working on prepare MIS', { intent: 'ask', topic: 'who', which: 'prepare MIS', about: undefined }],
  ['how much time did I log yesterday', { intent: 'ask', topic: 'hours', day: '10-13' }],
  ['how many hours did I log yesterday?', { intent: 'ask', topic: 'hours', day: '10-13' }],
  ['how much time did I log on Monday', { intent: 'ask', topic: 'hours', day: '10-12' }],
  ['kal kitne hours log kiye?', { intent: 'ask', topic: 'hours', day: '10-13' }],
  ["what's my workload", { intent: 'ask', topic: 'tasks' }],
  ["what's on my plate this week", { intent: 'ask', topic: 'week' }],
  ['show tasks for Aditya', { intent: 'find', person: 'aditya' }],
  ["show Asmita's tasks", { intent: 'find', person: 'asmita' }],
  ["Asmita's tasks", { intent: 'find', person: 'asmita' }],
  ['tasks for Aditya', { intent: 'find', person: 'aditya' }],
  ['show my overdue tasks', { intent: 'find', due: 'overdue', person: undefined }],
  ['how many tasks does Aditya have?', { intent: 'ask', topic: 'tasks', about: 'aditya' }],
  ['who is my manager?', { intent: 'ask', topic: 'manager' }],
  ['how much time did I spend on GST return', { intent: 'ask', topic: 'hours', which: 'GST return' }],
  ['how many hours did Aarti log this week', { intent: 'ask', topic: 'hours', about: 'aarti', which: undefined }],
  ['what did Aarti finish this week', { intent: 'ask', topic: 'done', about: 'aarti' }],
  ['list overdue tasks for Aarti', { intent: 'find', due: 'overdue', person: 'aarti' }],
  // With the question mark it wants a count; without, a list.
  ['anything overdue?', { intent: 'ask', topic: 'overdue' }],
  ['anything overdue', { intent: 'find', due: 'overdue' }],
]));

describe('Hinglish', () => rows([
  ['kal GST return file karo', { intent: 'create', due: '10-15' }],
  ['GST return kal tak file karo', { intent: 'create', name: 'File GST return', due: '10-15' }],
  ['aaj client ko call karna', { intent: 'create', name: 'Call client', due: '10-14' }],
  ['parso tak report bhejo', { intent: 'create', name: 'Send report', due: '10-16' }],
  ['kal ka task dikhao', { intent: 'find', due: 'tomorrow' }],
  ['aaj ke tasks dikhao', { intent: 'find', due: 'today' }],
  ['mere kitne task pending hai', { intent: 'ask', topic: 'tasks' }],
  ['कल तक GST रिटर्न फाइल करो', { intent: 'create', due: '10-15' }],
  ['आज बोर्ड पैक बनाओ', { intent: 'create', due: '10-14' }],
]));

// --- the pieces underneath ----------------------------------------------------------------------

describe('a person is only matched on a clear name', () => {
  test('"I", "my" and "me" are the asker, even when a word is inside somebody\'s name', () => {
    expect(askedAbout('how many open tasks do I have', PEOPLE, ME)).toBeNull();
    expect(askedAbout('who is working on prepare MIS', PEOPLE, ME)).toBeNull();
    expect(askedAbout('what do I have due today', PEOPLE, ME)).toBeNull();
  });
  test('a name that is plainly the subject still wins', () => {
    expect(askedAbout("show me Asmita's tasks", PEOPLE, ME)?.id).toBe('asmita');
    expect(askedAbout('how many tasks does Aditya have', PEOPLE, ME)?.id).toBe('aditya');
    expect(askedAbout('how many tasks are overdue of Aditi Jain', PEOPLE, ME)?.id).toBe('aditi');
  });
  test('the question about a task is about the task', () => {
    expect(topicOf('who is working on the hours report')).toBe('who');
  });
});

describe('the words a task is searched by', () => {
  test.each([
    ['the GST return task', 'GST return'],
    ['"Close books".', 'Close books'],
    ['GST return ko', 'GST return'],
    ['task called payroll run', 'payroll run'],
    ['it', ''],
  ])('%s → %s', (said, want) => expect(searchable(said)).toBe(want));
});

describe('durations and days', () => {
  test.each([
    ['2.5', 9000], ['2.30', 9000], ['1.5 hours', 5400], ['90m', 5400], ['2h', 7200], ['1.75', 6300],
  ])('%s → %s seconds', (said, want) => expect(readDuration(said)).toBe(want));

  test.each([
    ['yesterday', '10-13'], ['on monday', '10-12'], ['last wednesday', '10-07'], ['wednesday', '10-14'],
    ['day before yesterday', '10-12'], ['12 oct', '10-12'],
  ])('%s → %s', (said, want) => {
    const d = pastDay(said, NOW)!.day;
    expect(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).toBe(want);
  });

  test('tidy keeps a task\'s own words', () => {
    expect(tidy('call Monday Motors').text).toBe('call Monday Motors');
    expect(tidy('check the fridge').text).toBe('check the fridge');
    expect(tidy('call one client').text).toBe('call one client');
  });
});

// --- which task, out of several --------------------------------------------------------------

const task = (id: string, name: string, group: 'not_started' | 'active' | 'done' | 'closed' = 'not_started') =>
  ({ id, name, list_id: `list-${id}`, status: { id: 's', name: group, color: '', group, orderindex: 0 } }) as unknown as import('../api').Task;

describe('several tasks match: ask, do not pick the first', () => {
  test('one result is the one', () => {
    expect(pickMatch('GST return', [task('a', 'GST return - Sharma')]).task?.id).toBe('a');
  });
  test('an exact name wins over longer names that contain it', () => {
    const r = pickMatch('GST return', [task('a', 'GST return - Sharma'), task('b', 'GST return'), task('c', 'GST return - Mehta')]);
    expect(r.task?.id).toBe('b');
  });
  test('several equally good: no pick, and the options to choose from', () => {
    const r = pickMatch('GST return', [task('a', 'GST return - Sharma'), task('b', 'GST return - Mehta')]);
    expect(r.task).toBeNull();
    expect(r.options.map((t) => t.id)).toEqual(['a', 'b']);
  });
  test('two tasks with the very same name are still a question', () => {
    expect(pickMatch('Payroll', [task('a', 'Payroll'), task('b', 'Payroll')]).task).toBeNull();
  });
  test('for marking done, the only one still open is the one meant', () => {
    const found = [task('a', 'GST return - Sep', 'done'), task('b', 'GST return - Oct')];
    expect(pickMatch('GST return', found, true).task?.id).toBe('b');
    // ...but never for deleting, where a wrong guess cannot be taken back.
    expect(pickMatch('GST return', found, false).task).toBeNull();
  });
  test('a second search keeps only names holding every word', () => {
    const found = [task('a', 'Sharma - GST return'), task('b', 'Sharma - TDS'), task('c', 'GST return - Mehta')];
    expect(holdingAll('GST return Sharma', found).map((t) => t.id)).toEqual(['a']);
  });
});

// --- the people in the room are not the words of the question (user report #6) -------------------
//
// "What is due today?" was answered about Harish ("is") and "what am I working on?" about Satyam
// ("am"). Asked here by Devendra, in a firm with names that start like the small words.
describe('first-person questions are about the asker', () => {
  const DEV = 'devendra';
  const TEAM: Person[] = [
    { id: DEV, display_name: 'Devendra Mandhana', email: 'devendra@verveadvisory.com' },
    { id: 'harish', display_name: 'Harish Kandi', email: 'harish@verveadvisory.com' },
    { id: 'satyam', display_name: 'Satyam Rathi', email: 'satyam@verveadvisory.com' },
    { id: 'isha', display_name: 'Isha Shah', email: 'isha@verveadvisory.com' },
    { id: 'aman', display_name: 'Aman Paul', email: 'aman@verveadvisory.com' },
    { id: 'amit', display_name: 'Amit Rao', email: 'amit@verveadvisory.com' },
    { id: 'om', display_name: 'Om Bhosale', email: 'om.bhosale@verveadvisory.com' },
  ];
  const ask = (s: string) => flat(interpret(s, { people: TEAM, me: DEV, hierarchy: HIERARCHY, now: NOW }));
  test.each<Row>([
    ['What is due today?', { intent: 'find', due: 'today', person: undefined }],
    ['What am I working on?', { intent: 'ask', topic: 'doing', about: undefined }],
    ['my tasks', { intent: 'find', person: undefined }],
    ['what is overdue', { intent: 'find', due: 'overdue', person: undefined }],
    ['what am i doing today', { intent: 'ask', about: undefined }],
    ['what is on my plate today', { intent: 'ask', about: undefined }],
    ['aaj kya due hai', { intent: 'find', due: 'today', person: undefined }],
    ['mera kya pending hai', { intent: 'find', person: undefined }],
    ['mere tasks', { intent: 'find', person: undefined }],
    // A name said plainly is still heard.
    ['what is Isha working on', { intent: 'ask', about: 'isha' }],
    ['show Satyam’s tasks', { intent: 'find', person: 'satyam' }],
  ])('%s', (phrase, want) => {
    const got = ask(phrase);
    const picked: Flat = {};
    for (const k of Object.keys(want)) picked[k] = got[k];
    expect(picked).toEqual(want);
  });
  test.each(['is', 'am', 'are', 'on', 'i', 'the', 'what', 'due', 'today', 'working', 'hai', 'ka', 'ki', 'kya', 'is due', 'am i'])(
    'the word "%s" is nobody', (w) => {
      const hit = matchPerson(w, TEAM);
      expect(hit === null || hit === 'me').toBe(true);
    });
  test('"mera" is me, a two-letter first name still counts, and a near miss needs the same first letter', () => {
    expect(matchPerson('mera', TEAM)).toBe('me');
    expect((matchPerson('om', TEAM) as Person).id).toBe('om');
    expect((matchPerson('satyem', TEAM) as Person).id).toBe('satyam');
    expect(matchPerson('amin', TEAM)).toBeNull();
  });
});

// --- the assistant's own examples work as written (user report #12) ---------------------------

describe('a length first is hours logged, not a new task', () => rows([
  ['2 hours on CWC data fix', { intent: 'log_time', seconds: 7200, which: 'CWC data fix' }],
  ['2h on CWC data fix', { intent: 'log_time', seconds: 7200, which: 'CWC data fix' }],
  ['30 mins on GST return', { intent: 'log_time', seconds: 1800, which: 'GST return' }],
  ['1.5 hrs for audit', { intent: 'log_time', seconds: 5400, which: 'audit' }],
  ['2 ghante CWC data fix par', { intent: 'log_time', seconds: 7200, which: 'CWC data fix' }],
  ['CWC data fix pe 2 ghante', { intent: 'log_time', seconds: 7200, which: 'CWC data fix' }],
  // A length at the end is still an estimate.
  ['draft memo 2h', { intent: 'create', name: 'Draft memo', est: 7200 }],
]));

describe('every example the assistant shows', () => rows([
  // The Home screen's starters.
  ['What’s due today?', { intent: 'find', due: 'today', person: undefined }],
  ['Add call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15', unk: undefined }],
  ['Log 1h on GST filing', { intent: 'log_time', seconds: 3600, which: 'GST filing' }],
  ['Start a timer on payroll', { intent: 'timer', action: 'start', which: 'payroll' }],
  // The button's rotating hints.
  ['call the auditor tomorrow', { intent: 'create', name: 'Call the auditor', due: '10-15', unk: undefined }],
  ['2 hours on the Sharma audit', { intent: 'log_time', seconds: 7200, which: 'Sharma audit' }],
  ['mark the GST filing done', { intent: 'complete', which: 'GST filing' }],
  ['what’s overdue?', { intent: 'find', due: 'overdue' }],
  ['how many hours this week?', { intent: 'ask', topic: 'hours' }],
  ['start timer on payroll', { intent: 'timer', action: 'start', which: 'payroll' }],
  ['who is working on the GST return?', { intent: 'ask', topic: 'who', which: 'GST return' }],
]));

// --- who, when and how long come out of the name (user report #13) -----------------------------

describe('assignee, due date and estimate are taken out of the name', () => rows([
  ['Prepare GST summary for me by friday 2h', { intent: 'create', name: 'Prepare GST summary', asg: ME, due: '10-16', est: 7200, unk: undefined }],
  ['Prepare GST summary for Aarti by 20 Oct', { intent: 'create', name: 'Prepare GST summary', asg: 'aarti', due: '10-20' }],
  ['Draft memo @aarti due tomorrow est 2h', { intent: 'create', name: 'Draft memo', asg: 'aarti', due: '10-15', est: 7200 }],
  ['Review accounts by next monday 30m', { intent: 'create', name: 'Review accounts', due: '10-19', est: 1800 }],
  ['GST return kal tak file karo', { intent: 'create', name: 'File GST return', due: '10-15' }],
  ['add task call the bank assign to Aarti by friday', { intent: 'create', name: 'Call the bank', asg: 'aarti', due: '10-16' }],
  // A client's name after "for" is not a day, and "on 2 clients" is not a date.
  ['add task call Sun Pharma for the renewal', { intent: 'create', name: 'Call Sun Pharma for the renewal', due: undefined }],
  ['add task call for 2 clients', { intent: 'create', name: 'Call for 2 clients', due: undefined }],
]));

// --- history belongs to one person ------------------------------------------------------------

describe('history is kept per person and workspace', () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      },
    };
  });
  afterAll(() => { delete (globalThis as unknown as { window?: unknown }).window; });

  test('one person cannot see another\'s, and the old shared key is dropped', () => {
    store.set('verve.assistant.history', JSON.stringify([{ id: 'old', startedAt: 1, turns: [] }]));
    const harish = ownerOf('harish', 'ws1');
    const aarti = ownerOf('aarti', 'ws1');
    remember(harish, 's1', 1, { said: 'how many hours this week', reply: '12h', at: 1 });
    expect(sessions(harish)).toHaveLength(1);
    expect(sessions(aarti)).toHaveLength(0);
    expect(sessions(ownerOf('harish', 'ws2'))).toHaveLength(0);
    expect(store.has('verve.assistant.history')).toBe(false);
    forget(harish);
    expect(sessions(harish)).toHaveLength(0);
  });
});
