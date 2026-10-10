// Where a task goes, taken from the sentence instead of a dropdown.
//
// "Add a task to the skills section" names its destination, and making somebody then pick that
// same thing from a list of fifty is the kind of small insult that stops people using a feature
// they asked for. So the sentence is read for a place, and the place is resolved against the
// Spaces, Folders and Lists they can actually see.
//
// This workspace is what makes it hard. It really contains a List called "skills", two called
// "Personal List", three called "List", one called "learning" -- and seven more called
// "Learning - Accounts", "Learning - HR" and so on. So:
//
//   An exact name wins outright, even when longer names contain it. "learning" means the List
//   called "learning", not the seven that begin with it.
//
//   Two equally good matches are not a decision. Saying "the special events list" picks out eight
//   of them, and choosing one at random would file a client's work in another client's folder.
//   Those come back as options for the person to pick, which is slower exactly once.
//
//   Nothing recognised is not an error. The caller falls back to where it would have guessed
//   anyway, and says what it did.

import type { FolderNode, Hierarchy, ListNode } from '../api';
import { distance } from './fuzzy';
import { isHindi, romanise } from './hindi';

/** A List a task can go in, with enough of the tree around it to tell it from its namesakes. */
export interface Where {
  id: string;
  name: string;
  /** The Space it sits in, which is what makes a name like "List" mean anything. */
  group: string;
  /** "Space › Folder › List", for when the name alone is not enough. */
  path: string;
}

export interface WhereRead {
  /** The one place it means, when it means exactly one. */
  list: Where | null;
  /** The places it could have meant, when more than one is equally likely. */
  options: Where[];
  /** The words the destination was read from, so they can be shown and taken out of the name. */
  from: string | null;
  /** What was asked for, when it matched nothing -- worth saying out loud rather than ignoring. */
  missed: string | null;
}

/**
 * Where a destination can appear in a sentence.
 *
 * The keyword forms come first and are trusted: somebody who says "section", "list", "space" or
 * "folder" is naming a place. "in Skills" with no keyword is also common and much riskier -- "call
 * the auditor in the morning" is not a destination -- so that form is only believed when what
 * follows is the exact name of somewhere real.
 */
/**
 * A place's name: up to four words, none of them a preposition, and not a bare article.
 *
 * It used to be any run of up to sixty characters. Lazy matching stops at the *first* keyword, and
 * in "working on tasknext under the skills section" the only keyword is the one at the very end --
 * so the name swallowed "tasknext under the skills" whole. Capping the words, and refusing a
 * preposition inside one, keeps a name to the thing it actually names.
 */
const STOP = "in|on|to|under|inside|into|due|by|with|as|for|and|assign|assigned|priority|start|starting|end|ending|estimate|from|before|after|today|tomorrow";
const NAME = `(?!(?:the|a|an|my)\\b)((?:[a-z0-9ऀ-ॿ&'’.-]+(?:\\s+(?!(?:${STOP})\\b)[a-z0-9ऀ-ॿ&'’.-]+){0,3}))`;

/**
 * The words that mark a place.
 *
 * "project" was in here and had to come out. Half the work at this firm is "the Sharma project",
 * and with it listed, "working on tasknext project" read as a task called "Working" going into a
 * place called "tasknext". A word that turns up inside ordinary task names cannot also mean "what
 * comes before me is a destination".
 */
const PLACE = "section|space|list|folder|board";

const KEYWORD = new RegExp(`\\b(?:in|into|on|to|under|inside)\\s+(?:the\\s+)?${NAME}\\s+(${PLACE})\\b`, 'i');
/** The same thing said the other way round: "in the list skills", "under folder september". */
const KEYWORD_FIRST = new RegExp(
  `\\b(?:in|into|on|to|under|inside)\\s+(?:the\\s+)?(${PLACE})\\s+(?:called\\s+|named\\s+)?${NAME}`, 'i');
/** No keyword: believed only against an exact name. */
/**
 * No keyword: "...under holidays".
 *
 * Anchored to the end of the sentence, and believed only against an exact name. People put the
 * destination last when they do not say the word "list" -- "having a holiday under holidays" --
 * and anything mid-sentence is far more likely to be the task itself.
 */
const BARE = new RegExp(`\\b(?:in|into|to|under|inside)\\s+(?:the\\s+)?${NAME}\\s*$`, 'i');

/**
 * A word that cannot be the name of anywhere.
 *
 * "In the list skills" put this here: the article in "the" is optional in the pattern above, so
 * without this the first pattern reads "the" as the name, matches "in the list", and reports that
 * there is nowhere called "the" -- while the actual name sits one word to the right, unread.
 */
const STOPWORD = /^(?:the|a|an|my|our|this|that|these|those|it|section|space|list|folder|board|project)$/i;

/** Which keywords mean a container rather than a List, so the right tree is searched first. */
const IS_CONTAINER = /^(?:folder|space|project|board)$/i;

const flat = (s: string) => s.toLowerCase().replace(/[‘’']/g, "'").replace(/[^a-z0-9ऀ-ॿ&' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Everywhere a task can go, in the order a person would think of them. */
export function places(hierarchy: Hierarchy | null): Where[] {
  const out: Where[] = [];
  const walk = (node: { lists?: ListNode[]; folders?: FolderNode[] }, group: string, trail: string[]) => {
    for (const l of node.lists ?? []) {
      if (l.archived) continue;
      out.push({ id: l.id, name: l.name, group, path: [group, ...trail, l.name].join(' › ') });
    }
    for (const f of node.folders ?? []) {
      if (f.archived) continue;
      walk(f, group, [...trail, f.name]);
    }
  };
  for (const space of hierarchy?.spaces ?? []) {
    if (space.archived) continue;
    walk(space, space.name, []);
  }
  walk(hierarchy?.shared_with_me ?? {}, 'Shared with me', []);
  if (hierarchy?.personal_list) {
    out.unshift({
      id: hierarchy.personal_list.id, name: hierarchy.personal_list.name,
      group: 'Yours', path: `Yours › ${hierarchy.personal_list.name}`,
    });
  }
  return out;
}

/**
 * The names of Folders and Spaces, each with the Lists inside it.
 *
 * Said names are as often a Folder or a Space as a List -- "put it in the Learning folder" -- and
 * a task cannot go in either, so what is wanted is the Lists underneath.
 */
function containers(hierarchy: Hierarchy | null): { name: string; lists: Where[] }[] {
  const out: { name: string; lists: Where[] }[] = [];
  const all = places(hierarchy);
  const under = (prefix: string) => all.filter((p) => p.path.startsWith(prefix));
  const walk = (node: { folders?: FolderNode[] }, trail: string[]) => {
    for (const f of node.folders ?? []) {
      if (f.archived) continue;
      out.push({ name: f.name, lists: under([...trail, f.name].join(' › ')) });
      walk(f, [...trail, f.name]);
    }
  };
  for (const space of hierarchy?.spaces ?? []) {
    if (space.archived) continue;
    out.push({ name: space.name, lists: under(space.name) });
    walk(space, [space.name]);
  }
  return out;
}

/** 100 exact, then by how specifically the said words pick the name out. 0 means no. */
function score(said: string, name: string): number {
  // Said in Devanagari, while the Lists here are named in Latin: "स्किल्स" spells out as "skils",
  // which the tolerance below closes the rest of the way to "skills". Scored under the plain
  // reading, never over it, so an exact Latin match always wins.
  // No penalty on the spelled-out reading. best() already compares every candidate against the
  // same said words, so docking the transliteration only pushed real matches under the threshold:
  // "स्किल्स" spells out one letter away from "skills", scored 45, and 45 minus 5 was a miss.
  if (!isHindi(said)) return rate(flat(said), flat(name));
  return Math.max(rate(flat(said), flat(name)), rate(flat(romanise(said)), flat(name)));
}

function rate(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (b.startsWith(`${a} `) || b.startsWith(`${a}-`)) return 70;
  if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(b)) return 55;
  // One or two characters out, which is what "skils" or "sailes" costs. Short names only: on a
  // three-letter name an edit distance of two is a different word entirely.
  const slip = distance(a, b);
  if (slip <= (b.length >= 6 ? 2 : 1)) return 45;
  if (b.includes(a) && a.length >= 4) return 30;
  return 0;
}

/** The best matches among `names`, and whether the best is a single clear winner. */
function best<T>(said: string, items: T[], nameOf: (t: T) => string): { top: T[]; points: number } {
  let points = 0;
  let top: T[] = [];
  for (const item of items) {
    const s = score(said, nameOf(item));
    if (s === 0 || s < points) continue;
    if (s > points) { points = s; top = [item]; } else top.push(item);
  }
  return { top, points };
}

/**
 * Read a destination out of a sentence.
 *
 * @param hierarchy the tree as this person can see it, so nothing is offered that they cannot open.
 */
export function readWhere(input: string, hierarchy: Hierarchy | null): WhereRead {
  const nothing: WhereRead = { list: null, options: [], from: null, missed: null };
  const text = input.trim();
  if (!text) return nothing;
  const lists = places(hierarchy);
  if (!lists.length) return nothing;
  const folders = containers(hierarchy);

  // Most specific pattern first. "In the list skills" matches both keyword patterns, and only the
  // one that expects the keyword before the name reads it correctly.
  const tries: { said: string; from: string; kind: string; trusted: boolean }[] = [];
  const kwFirst = text.match(KEYWORD_FIRST);
  if (kwFirst) tries.push({ said: kwFirst[2], from: kwFirst[0], kind: kwFirst[1], trusted: true });
  const kw = text.match(KEYWORD);
  if (kw) tries.push({ said: kw[1], from: kw[0], kind: kw[2], trusted: true });
  const bare = text.match(BARE);
  if (bare) tries.push({ said: bare[1], from: bare[0], kind: '', trusted: false });

  /** The Lists a said name means, and whether it means exactly one. */
  const asList = (said: string) => best(said, lists, (l) => l.name);
  /** The Lists inside whatever Folder or Space a said name means. */
  const asContainer = (said: string) => {
    const box = best(said, folders, (f) => f.name);
    return box.points >= 45 ? { top: box.top.flatMap((f) => f.lists), points: box.points } : { top: [], points: 0 };
  };

  for (const attempt of tries) {
    const said = attempt.said.replace(/\b(section|space|list|folder|board|project)\b/gi, '').trim();
    if (!said || STOPWORD.test(said)) continue;

    // The keyword says which tree to believe. This workspace has a Folder called "Learning" and a
    // List called "learning", so "in the Learning folder" and "in the learning list" are two
    // different destinations said almost identically -- and the word they chose is the evidence.
    const order = IS_CONTAINER.test(attempt.kind)
      ? [asContainer(said), asList(said)]
      : [asList(said), asContainer(said)];

    // An untrusted "in X" is only a destination when X names something exactly. Otherwise "call
    // the auditor in the morning" files a task in whichever List is nearest to "morning".
    //
    // Both trees, not just the first. This only looked at Lists, so "having a holiday under
    // holidays" found nothing -- Holidays is a Space -- and the words stayed in the task's name.
    if (!attempt.trusted && !order.some((hit) => hit.points >= 100)) continue;

    for (const hit of order) {
      if (hit.top.length === 1 && hit.points >= 45) {
        return { list: hit.top[0], options: [], from: attempt.from, missed: null };
      }
      if (hit.top.length > 1) {
        // Several places share the name. Eight "Attending Special Events - <client>" are eight
        // different clients' work, so picking one would file it against the wrong client.
        return { list: null, options: hit.top.slice(0, 8), from: attempt.from, missed: null };
      }
    }

    if (attempt.trusted) {
      return { list: null, options: [], from: attempt.from, missed: said };
    }
  }
  return nothing;
}
