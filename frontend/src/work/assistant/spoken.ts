// Speech, tidied into the sentence the rules read.
//
// Typed, people write "start today, due tomorrow, assign to me". Spoken -- and then put through a
// speech recogniser -- the same thing arrives as "make me as an assigning, make started as a today,
// in that as an tomorrow, estimated as a 2 hours". Every word of the meaning is there; the parser
// just never expected the filler around it, so it understood none of it and asked for all five
// details again.
//
// So this is a pass that only removes filler and repairs the recogniser's usual mishearings, before
// any rule reads the sentence. It changes the shape, never the meaning: nothing here invents a date
// or a person that was not said.

const DAY = 'today|tomorrow|tmrw|day after tomorrow|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun';
const LEVEL = 'normal|medium|high|low|urgent|critical|important';

const RULES: [RegExp, string][] = [
  // "end date", misheard. Only where a value follows ("in that as tomorrow"), because "in that"
  // and "and that" are ordinary words everywhere else.
  [/\b(?:in|and|end)\s+(?:that|date|data|it)\b(?=\s+(?:as|is|on|of|=|:)\s)/gi, 'end date'],

  // "as a today", "as an tomorrow", "as a 2 hours": an article between a field and its value.
  [new RegExp(`\\b(as|is|of|at|to|on|for|by|be)\\s+(?:a|an)\\s+(?=\\d|(?:${DAY}|${LEVEL})\\b)`, 'gi'), '$1 '],

  // Who it is for, said every way except the one the parser knows.
  [/\b(?:make|set|keep|put|add)\s+me\s+(?:as\s+)?(?:an?\s+|the\s+)?(?:assign(?:ing|ee|ed)?|owner)\b/gi, 'assign to me'],
  [/\bme\s+as\s+(?:an?\s+|the\s+)?(?:assign(?:ing|ee)|owner)\b/gi, 'assign to me'],
  [/\b(?:make|set|keep|put)\s+([a-z]+)\s+as\s+(?:an?\s+|the\s+)?(?:assign(?:ing|ee)|owner)\b/gi, 'assign to $1'],
  [/\bassign(?:ing|ed)?\s+(?:it\s+)?(?:to\s+)?me\b/gi, 'assign to me'],
  // Not after "the", "change", "remove" and the like: there "assignee" names the field being
  // changed, and "remove the assignee of X" read as "remove the assign to of X" became a deletion.
  [/(?<!\b(?:the|its|change|remove|clear|unset|set|new|no)\s+)\bassignee\s+(?:is\s+|as\s+|:\s*)?(?!of\b|for\b|on\b|to\b)/gi, 'assign to '],
  // "assign aarti" means "assign to aarti" -- but not "assign the GST return to Laxmi", where the
  // "to" comes later and the words in between are the task.
  [/\bassign\s+(?!to\b|it\b)(?!.*\bto\b)/gi, 'assign to '],

  // "make started as today", "keep it due friday": a verb in front of a field, mid-sentence. Not at
  // the start, where "set the priority of X to high" is an instruction to change a task.
  [/(?<=\w[\s,]+)(?:and\s+)?(?:make|keep)\s+(?:it\s+)?(?:as\s+)?(?=(?:start(?:s|ed|ing)?|due|end|deadline|estimated?|priority)\b)/gi, ''],
];

export function tidySpoken(text: string): string {
  let out = text;
  for (const [pattern, into] of RULES) out = out.replace(pattern, into);
  return out.replace(/\s+/g, ' ').trim();
}
