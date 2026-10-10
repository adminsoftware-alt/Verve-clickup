// How close two names are.
//
// Shared because the assistant has to recognise the same name in three places -- a List to file a
// task in, a person to assign it to, a task to change -- and three different notions of "close
// enough" would mean "aarti" finding Aarti when assigning and not when reassigning.
//
// Dictation is the reason any of this is needed. Speech recognition hears "skils" for "skills" and
// "sailes" for "sales", and a transliterated Devanagari name arrives a letter or two off whatever
// it was typed as in the workspace.

/** Levenshtein distance, with an early exit: anything far apart is not worth counting precisely. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * Near enough to be the same word, scaled to its length.
 *
 * One slip in a short word is a different word -- "mon" and "jon" are two people -- while two in a
 * long one is still obviously the same name.
 */
export function close(a: string, b: string): boolean {
  if (!a || !b) return false;
  const allowed = b.length >= 8 ? 2 : b.length >= 5 ? 1 : 0;
  return allowed > 0 && distance(a, b) <= allowed;
}
