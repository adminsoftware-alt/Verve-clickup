// The verbs an instruction starts with.
//
// Shared by the two places that need to know whether a fragment is an instruction: splitting one
// sentence into several tasks, and moving a Hindi sentence's verb to the front. They have to agree,
// because "GST रिटर्न फाइल करो" and "file the GST return" are the same instruction and the second
// is produced from the first.
//
// Not exhaustive, and it does not need to be. A fragment starting with a word that is not here is
// treated as part of the previous task rather than a new one, which is the safe direction: splitting
// too eagerly invents tasks nobody asked for, while splitting too rarely leaves one task to edit.

export const VERB_WORDS = [
  'add', 'arrange', 'ask', 'audit', 'book', 'call', 'cancel', 'chase', 'check', 'close', 'collect',
  'complete', 'compute', 'confirm', 'create', 'discuss', 'do', 'download', 'draft', 'email', 'enter',
  'file', 'finish', 'fix', 'follow', 'get', 'give', 'issue', 'make', 'meet', 'organise', 'organize',
  'pay', 'plan', 'prepare', 'print', 'raise', 'read', 'reconcile', 'remind', 'reply', 'review',
  'schedule', 'scan', 'send', 'set', 'share', 'sign', 'sort', 'speak', 'submit', 'take', 'talk',
  'update', 'upload', 'verify', 'visit', 'write',
] as const;

/** Does this fragment open with an instruction? */
export const IMPERATIVE = new RegExp(`^(?:please\\s+)?(?:${VERB_WORDS.join('|')})\\b`, 'i');

/**
 * A single verb sitting at the end of a sentence, which is where Hindi puts it.
 *
 * Only the verbs above plus the handful that name what the assistant itself does, so an ordinary
 * English sentence ending in a noun is left alone.
 */
export const TRAILING_VERB = new RegExp(`^(.*?)\\s+(${[...VERB_WORDS, 'change', 'delete', 'show', 'mark', 'find'].join('|')})\\s*$`, 'i');
