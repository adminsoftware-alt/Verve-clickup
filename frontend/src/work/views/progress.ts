// The three steps every List has -- To do, In progress, Complete -- whatever its own statuses are
// called. Used by the status circle on a row or card, and by dragging between progress columns.
import type { Status } from '../api';

export type Step = 'todo' | 'doing' | 'done';

/** The List's first status of that kind; Complete prefers a closed status over a done one. */
export function statusForStep(set: Status[], step: Step): Status | undefined {
  const ordered = [...set].sort((a, b) => a.orderindex - b.orderindex);
  if (step === 'todo') return ordered.find((st) => st.group === 'not_started');
  if (step === 'doing') return ordered.find((st) => st.group === 'active');
  return ordered.find((st) => st.group === 'closed') ?? ordered.find((st) => st.group === 'done');
}
