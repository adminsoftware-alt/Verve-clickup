import { describe, expect, it } from 'vitest';
import { answer, begin, isBareCreate, langOf, placeSaid, question, wantsToBeAsked, type Ctx, type Guide, type Next } from './guide';
import type { Hierarchy } from '../api';

const now = new Date(2026, 9, 16, 10, 0, 0); // Fri 16 Oct 2026
const hierarchy = {
  spaces: [{ id: 's1', name: 'Ops', folders: [], lists: [{ id: 'l1', name: 'Payroll' }, { id: 'l2', name: 'GST' }] }],
} as unknown as Hierarchy;
const ctx: Ctx = {
  people: [{ id: 'me', display_name: 'Harish Kandi', email: 'harish@x.com' }, { id: 'aarti', display_name: 'Aarti Yadav', email: 'aarti@x.com' }],
  me: 'me', hierarchy, suggested: [], now,
};

function talk(g: Guide, ...said: string[]): Next {
  let next: Next = { kind: 'ask', guide: g };
  for (const s of said) {
    if (next.kind !== 'ask') throw new Error(`stopped before "${s}"`);
    next = answer(next.guide, s, ctx);
  }
  return next;
}

describe('talking a task through', () => {
  it('hears Hinglish and answers in it', () => {
    expect(langOf('ek task create karo')).toBe('hi');
    expect(langOf('create a task')).toBe('en');
    expect(question(begin('hi', null)).text).toMatch(/naam/);
  });

  it('asks every detail in turn, then where, and has it all', () => {
    const done = talk(begin('hi', null), 'Cognivion GST return file karna', 'urgent', 'to do', 'aaj', 'kal', '2 ghante', 'mujhe', 'GST');
    expect(done.kind).toBe('ready');
    if (done.kind !== 'ready') return;
    const d = done.guide.draft;
    expect(d.name).toBe('Cognivion GST return file karna');
    expect(d.priority).toBe(1);
    expect(d.status).toBe('not_started');
    expect(new Date(d.start!).getDate()).toBe(16);
    expect(new Date(d.due!).getDate()).toBe(17);
    expect(d.estimate).toBe(7200);
    expect(d.assignees).toEqual(['me']);
    expect(d.list?.id).toBe('l2');
  });

  it('skips what the first sentence already said', () => {
    const g = begin('en', { name: 'Call auditor', priority: 2, start_date: null, due_date: null, time_estimate_seconds: null,
      assignees: [], recurrence: null, found: [], unknown: [], confidence: 'high' });
    expect(g.step).toBe('status');
  });

  it('lets optional ones be skipped, defaulting start to today and the assignee to me', () => {
    const done = talk(begin('en', null), 'Weekly MIS', 'skip', 'skip', 'skip', 'Friday', 'skip', 'skip', 'Payroll');
    expect(done.kind).toBe('ready');
    if (done.kind !== 'ready') return;
    expect(done.guide.draft.priority).toBeNull();
    expect(new Date(done.guide.draft.start!).getDate()).toBe(16);
    expect(done.guide.draft.assignees).toEqual(['me']);
  });

  it('asks again when an answer does not fit', () => {
    const g = talk(begin('en', null), 'Weekly MIS');
    expect(g.kind === 'ask' && g.guide.step).toBe('priority');
    const r = talk(g.kind === 'ask' ? g.guide : begin('en', null), 'banana');
    expect(r.kind === 'ask' && r.retry).toMatch(/Urgent/);
    const early = talk(begin('en', null), 'X', 'high', 'to do', 'Monday', 'today');
    expect(early.kind === 'ask' && early.retry).toMatch(/before the start/);
  });

  it('assigns to someone by name, and refuses a name nobody has', () => {
    const at = talk(begin('en', null), 'X', 'low', 'in progress', 'today', 'tomorrow', '1 hour');
    if (at.kind !== 'ask') throw new Error('expected a question');
    const aarti = answer(at.guide, 'Aarti', ctx);
    expect(aarti.kind === 'ask' && aarti.guide.draft.assignees).toEqual(['aarti']);
    const nobody = answer(at.guide, 'Zebedee', ctx);
    expect(nobody.kind === 'ask' && nobody.retry).toMatch(/Nobody/);
  });

  it('never makes a task without a name or a List, and stops when told to', () => {
    expect(answer(begin('hi', null), 'skip', ctx).kind === 'ask').toBe(true);
    expect(answer(begin('hi', null), 'rehne do', ctx).kind).toBe('cancel');
  });
});

describe('knowing when a task was asked for without saying what', () => {
  it.each(['ek task create karo', 'create a task', 'naya task banao', 'task banana hai', 'mujhe ek task banana hai', 'add a task', 'ek urgent task banao kal tak'])(
    '%s', (s) => expect(isBareCreate(s)).toBe(true));
  it.each(['create a task to call the auditor', 'GST return ka task banao', 'add task payroll check', 'what tasks are due', 'mere tasks dikhao'])(
    'not: %s', (s) => expect(isBareCreate(s)).toBe(false));
  it('keeps what was said with it', () => {
    expect(begin('hi', null, 'ek urgent task banao').draft.priority).toBe(1);
  });
});

describe('where it goes', () => {
  it('takes a tapped path as well as a spoken name', () => {
    const at = talk(begin('en', null), 'X', 'skip', 'skip', 'skip', 'skip', 'skip', 'skip');
    if (at.kind !== 'ask') throw new Error('expected the where question');
    expect(at.guide.step).toBe('where');
    const tapped = answer(at.guide, 'Ops › Payroll', ctx);
    expect(tapped.kind === 'ready' && tapped.guide.draft.list?.id).toBe('l1');
    const missing = answer(at.guide, 'Nowhere list', ctx);
    expect(missing.kind === 'ask' && missing.retry).toMatch(/No List/);
  });
});

describe('talk about making a task is not its name', () => {
  it.each([
    'I want to create a task under in a marketing what are the details you want to get from me',
    'can you help me add a task',
    'I need to create a new task in GST',
    'task banana hai, kya kya batana hoga?',
  ])('%s', (s) => expect(wantsToBeAsked(s, s)).toBe(true));
  it.each(['create a task to call the auditor tomorrow', 'add task payroll check due friday', 'GST return ka task banao kal tak'])(
    'still made at once: %s', (s) => expect(wantsToBeAsked(s, s.replace(/^(create a task to|add task)\s*/i, ''))).toBe(false));
  it('starts the questions without taking the sentence as the name', () => {
    const said = 'I want to create a task under in a marketing what are the details you want to get from me';
    const g = begin(langOf(said), { name: said, priority: null, start_date: null, due_date: null, time_estimate_seconds: null,
      assignees: [], recurrence: null, found: [], unknown: [], confidence: 'high' }, said);
    expect(g.draft.name).toBe('');
    expect(g.step).toBe('name');
  });
  it('notices the place named', () => {
    const h = { spaces: [{ id: 's', name: 'Marketing', folders: [], lists: [] }] } as unknown as Hierarchy;
    expect(placeSaid('create a task under in a marketing', h)).toBe('Marketing');
  });
});
