// Which task a sentence meant, out of the ones a search turned up.
//
// "Mark the GST return done" in a firm with a GST return for every client finds a dozen. Taking
// the first one closes somebody else's client's return -- quietly, and with the assistant saying
// it did exactly what was asked. So a pick is only made when it is plainly the one; otherwise the
// person is asked, with each candidate's List beside it so namesakes can be told apart.

import type { Task } from '../api';

// The same test as `isOpen` in api.ts, repeated so this file needs nothing that signs in -- it is
// run in tests with no browser.
const isOpen = (t: Task) => t.status.group !== 'closed' && t.status.group !== 'done';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

/** Words worth searching on, without the ones every task name has. */
const FILLER = /^(?:the|a|an|and|of|for|to|on|in|with|my|task|tasks|ko|ka|ke|ki)$/i;
export const significant = (s: string) => norm(s).split(' ').filter((w) => w.length >= 2 && !FILLER.test(w));

export interface Picked {
  /** The one it means, when it is plain which. */
  task: Task | null;
  /** The ones it could mean, when it is not -- for the person to choose between. */
  options: Task[];
}

/**
 * Choose among search results.
 *
 * A single result, or a single exact name, is a pick. Several that fit equally well are a question.
 *
 * @param preferOpen for marking done, logging time and timers: of several namesakes, the only one
 *                   still open is the one meant. Not for deleting, where a wrong guess is permanent.
 */
export function pickMatch(query: string, found: Task[], preferOpen = false): Picked {
  if (!found.length) return { task: null, options: [] };
  if (found.length === 1) return { task: found[0], options: [] };
  const q = norm(query);
  const exact = found.filter((t) => norm(t.name) === q);
  if (exact.length === 1) return { task: exact[0], options: [] };
  if (exact.length > 1) return narrow(exact, preferOpen);
  // In the name, as said, beats only in the description.
  const inName = found.filter((t) => norm(t.name).includes(q));
  if (inName.length === 1) return { task: inName[0], options: [] };
  return narrow(inName.length ? inName : found, preferOpen);
}

function narrow(candidates: Task[], preferOpen: boolean): Picked {
  if (preferOpen) {
    const open = candidates.filter(isOpen);
    if (open.length === 1) return { task: open[0], options: [] };
  }
  return { task: null, options: candidates.slice(0, 6) };
}

/**
 * Narrow a broad search to the tasks whose names hold every word said.
 *
 * The server's search is "the name contains this exact phrase", so "GST return Sharma" finds
 * nothing when the task is called "Sharma - GST return". Searching on the rarest word and keeping
 * the tasks that have all the others is the second try.
 */
export function holdingAll(query: string, found: Task[]): Task[] {
  const words = significant(query);
  return found.filter((t) => {
    const name = ` ${norm(t.name)} `;
    return words.every((w) => name.includes(` ${w} `) || name.includes(w));
  });
}
