// Hindi and Hinglish, turned into something the English rules can read.
//
// The alternative was a second parser, and a second parser is a second set of bugs that only shows
// up for the people least likely to report it. So there is one parser, and this translates into it.
//
// Two things make it more than a word swap.
//
// Hindi puts its postpositions after the word where English puts prepositions before it:
//
//     कल   तक        ->  by tomorrow        (not "tomorrow by")
//     आरती को असाइन  ->  assign to aarti    (not "aarti to assign")
//     स्किल्स में      ->  in skills          (not "skills in")
//
// Get that wrong and "कल तक GST रिटर्न फाइल करो" yields a date the parser never sees. So the
// postpositions are rewritten into prepositions first, moving the word they govern, and only then
// is the vocabulary swapped.
//
// And \b does not work here. JavaScript defines a word boundary against [A-Za-z0-9_], so every
// character of Devanagari is a non-word character and /\bआज\b/ matches nothing at all -- silently,
// which is the worst way for a translation table to fail. Boundaries are asserted against the
// Devanagari block itself instead, which also keeps "कम" (low) from matching inside "कमरा" (room).
//
// The Devanagari list can be generous: none of it collides with an English word or a client's name.
// The romanised list cannot, and is deliberately short. "Do" is Hindi for "two" and English for
// "do"; "me" is Hindi for "in"; "or" is Hindi for "and"; "to" means "so". Mapping any of those
// would quietly corrupt ordinary English sentences, which are the overwhelming majority -- so a
// romanised word earns its place only when it is unambiguous: "aaj", "parso", "shukravar".

import { parseTypedDate } from '../dates';
import { tidySpoken } from './spoken';
import { TRAILING_VERB } from './verbs';

const BLOCK = '\\u0900-\\u097F';
const DEVANAGARI = new RegExp(`[${BLOCK}]`);

/**
 * Spelling with and without the nukta, folded into one.
 *
 * जोड़ो and जोडो are the same word typed two ways, and a phone keyboard, a speech engine and a
 * person all pick differently. Without this, a table written one way misses half of what arrives --
 * which is how "जोडो" came through untranslated and ended up inside a task's name.
 */
const PRECOMPOSED: Record<string, string> = {
  'ऩ': 'न', 'ऱ': 'र', 'ऴ': 'ळ',
  'क़': 'क', 'ख़': 'ख', 'ग़': 'ग', 'ज़': 'ज',
  'ड़': 'ड', 'ढ़': 'ढ', 'फ़': 'फ', 'य़': 'य',
};
const fold = (s: string) =>
  s.replace(/़/g, '').replace(/[ऩऱऴक़-य़]/g, (c) => PRECOMPOSED[c] ?? c);

/** Devanagari spelled out in Latin letters, for matching against names typed in Latin. */
const LETTERS: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऒ': 'o',
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // Vowel signs.
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
  'ं': 'n', 'ः': 'h', 'ँ': 'n',
  '्': '', // halant: the vowel is suppressed, so the consonants run together
};

/**
 * Spell a Devanagari word out in Latin letters.
 *
 * The short vowel convention, which is how Indian names are actually typed: ी becomes "i", not
 * "ee", so आरती spells out "arti" and lands one letter from "Aarti". Spelled "aartee" it was two
 * letters away, which is one too many, and the assistant could assign to her by name in English
 * and not in Hindi.
 *
 * Rough on purpose. "स्किल्स" comes out "skils" rather than "skills", and that is close enough:
 * everything that uses this compares with a tolerance for a letter or two, because dictation is off
 * by that much anyway. Latin characters pass through untouched, so a mixed phrase still works.
 */
export function romanise(text: string): string {
  let out = '';
  for (const ch of text) out += LETTERS[ch] ?? (DEVANAGARI.test(ch) ? '' : ch);
  return out.replace(/\s+/g, ' ').trim();
}

/** One Devanagari alternation, bounded so it cannot match inside a longer word. */
const dev = (...words: string[]) =>
  new RegExp(`(?<![${BLOCK}])(?:${words.join('|')})(?![${BLOCK}])`, 'g');

/** A Devanagari or Latin word, for the patterns that capture the word a postposition governs. */
const WORD = `[${BLOCK}a-zA-Z0-9]+`;

/**
 * Postpositions, rewritten as prepositions.
 *
 * Order matters: the assignment forms come first, because को also appears in sentences that are
 * not about assigning anybody, and the longer pattern is the surer reading.
 */
const REORDER: [RegExp, string][] = [
  // "आज से शुक्रवार तक" -> from today to friday.
  //
  // First, and as one rule rather than two. Rewriting से and तक independently let the तक pattern
  // swallow the से in front of it -- "आज से शुक्रवार तक" became "today from by friday", which is
  // two dates said and none understood. The span is also the form English already parses best.
  [new RegExp(`(${WORD})\\s+से\\s+((?:अगले\\s+)?${WORD})\\s+तक`, 'g'), 'from $1 to $2'],
  // "GST रिटर्न की तारीख कल करो" -> change date of GST रिटर्न to tomorrow.
  //
  // Here करो is the verb, not politeness: "X की तारीख Y करो" is how you say "set X's date to Y".
  // Stripped as a courtesy word, as it is everywhere else, the sentence lost the only thing saying
  // it was a change at all and read as a brand new task called "GST रिटर्न date tomorrow".
  [new RegExp(`(.+?)\\s+(तारीख|दिनांक|प्राथमिकता|प्रायोरिटी|नाम|समय\\s*सीमा|डेडलाइन|अनुमान)\\s+(${WORD}(?:\\s+${WORD})?)\\s+(?:करो|कर\\s*दो|करें|कीजिए|बदलो|बदलें|रखो)`, 'g'),
    'change $2 of $1 to $3'],
  // "आरती को असाइन करो" / "आरती को दे दो" -> assign to aarti
  [new RegExp(`(${WORD})\\s+को\\s+(?:असाइन|सौंप(?:ो|ें|िए)?|दे\\s*दो|दीजिए)`, 'g'), 'assign to $1'],
  [dev('मुझे\\s+(?:असाइन|सौंप(?:ो|ें)?|दे\\s*दो)'), 'assign to me'],
  // "कल तक" / "अगले सोमवार तक" -> by tomorrow / by next monday.
  //
  // One word, plus "अगले" where it is there. A second free word let it reach back over whatever
  // preceded the date -- "टास्क कल तक" became "by task tomorrow", putting the task's own name
  // inside the date clause.
  [new RegExp(`((?:अगले\\s+)?${WORD})\\s+तक`, 'g'), 'by $1'],
  // "स्किल्स सेक्शन में" -> in skills section
  [new RegExp(`([${BLOCK}a-zA-Z0-9 ]+?)\\s+(?:में|मे)(?![${BLOCK}])`, 'g'), 'in $1'],
  // "सोमवार से" -> from monday
  [new RegExp(`(${WORD})\\s+से(?![${BLOCK}])`, 'g'), 'from $1'],
  // का/की/के mark possession and carry nothing the parser needs.
  [dev('का', 'की', 'के'), ' '],
];

/** One Hindi word, one English word. */
const WORDS: [RegExp, string][] = [
  // --- what to do ---------------------------------------------------------------------------
  [dev('जोडो', 'जोडें', 'जोडिए', 'बनाओ', 'बनाएं', 'बनाइए'), 'add'],
  [dev('नया', 'नई'), 'new'],
  [dev('टास्क', 'काम', 'कार्य'), 'task'],
  [dev('बदलो', 'बदलें', 'बदलिए', 'बदल'), 'change'],
  [dev('हटाओ', 'हटाएं', 'हटाइए', 'मिटाओ', 'डिलीट'), 'delete'],
  [dev('दिखाओ', 'दिखाएं', 'दिखाइए', 'बताओ', 'बताएं', 'बताइए'), 'show'],
  [dev('पूरा', 'पूर्ण', 'हो\\s*गया', 'खत्म\\s*हो\\s*गया'), 'done'],
  [dev('निशान\\s*लगाओ', 'मार्क'), 'mark'],
  [dev('कितने', 'कितनी', 'कितना'), 'how many'],
  [dev('कौन', 'किसको'), 'who'],
  [dev('मेरे', 'मेरा', 'मेरी'), 'my'],
  [dev('मुझे', 'मैं'), 'me'],
  [dev('असाइन', 'सौंपो', 'सौंपें'), 'assign'],
  // --- when --------------------------------------------------------------------------------
  [dev('आज'), 'today'],
  [dev('कल'), 'tomorrow'],
  [dev('परसों', 'परसो'), 'day after tomorrow'],
  [dev('सोमवार', 'सोम'), 'monday'],
  [dev('मंगलवार', 'मंगल'), 'tuesday'],
  [dev('बुधवार', 'बुध'), 'wednesday'],
  [dev('गुरुवार', 'गुरवार', 'बृहस्पतिवार'), 'thursday'],
  [dev('शुक्रवार', 'शुक्र'), 'friday'],
  [dev('शनिवार', 'शनि'), 'saturday'],
  [dev('रविवार', 'इतवार'), 'sunday'],
  [dev('अगले\\s*हफ्ते', 'अगले\\s*सप्ताह'), 'next week'],
  [dev('इस\\s*हफ्ते', 'इस\\s*सप्ताह'), 'this week'],
  [dev('अगले\\s*महीने'), 'next month'],
  [dev('वीकेंड', 'सप्ताहांत'), 'weekend'],
  [dev('शुरू\\s*(?:की\\s*)?(?:तारीख|दिन)', 'आरंभ'), 'start date'],
  [dev('आखिरी\\s*(?:तारीख|दिन)', 'अंतिम\\s*तारीख', 'समय\\s*सीमा', 'डेडलाइन'), 'deadline'],
  [dev('खत्म', 'समाप्त', 'अंत'), 'end'],
  [dev('तारीख', 'दिनांक'), 'date'],
  [dev('घंटे', 'घंटा', 'घंटों'), 'hours'],
  [dev('मिनट'), 'minutes'],
  // --- how urgent --------------------------------------------------------------------------
  // Spelled without the nukta, because fold() has already removed it from the input.
  [dev('जरूरी', 'अत्यावश्यक', 'तुरंत'), 'urgent'],
  [dev('उच्च', 'ऊंची', 'हाई'), 'high'],
  [dev('सामान्य', 'मध्यम', 'नॉर्मल'), 'normal'],
  [dev('कम', 'निम्न', 'लो'), 'low'],
  [dev('प्राथमिकता', 'प्रायोरिटी'), 'priority'],
  // --- what to ask about -------------------------------------------------------------------
  [dev('बाकी', 'लंबित', 'पेंडिंग'), 'pending'],
  [dev('देर\\s*से', 'लेट', 'ओवरड्यू'), 'overdue'],
  [dev('छुट्टी', 'अवकाश', 'लीव'), 'leave'],
  [dev('टाइमशीट', 'समय\\s*पत्रक'), 'timesheet'],
  [dev('मैनेजर', 'प्रबंधक'), 'manager'],
  [dev('टीम', 'दल'), 'team'],
  [dev('सूची', 'लिस्ट'), 'list'],
  [dev('सेक्शन', 'अनुभाग'), 'section'],
  [dev('स्पेस'), 'space'],
  [dev('फोल्डर'), 'folder'],
  // --- glue --------------------------------------------------------------------------------
  [dev('और'), 'and'],
  [dev('पर', 'पे'), 'on'],
  // Politeness verbs that carry no meaning once the real verb is known. Last, so the patterns
  // above still see the forms that end in them.
  [dev('करो', 'करें', 'कीजिए', 'कर\\s*दो', 'दो', 'दें', 'है', 'हैं', 'चाहिए'), ' '],
];

/** Romanised Hindi, only where the word cannot be mistaken for English or a client's name. */
const LENGTH = String.raw`\d+(?:\.\d+)?\s*(?:ghant(?:e|a|on)|h|hrs?|hours?|m|mins?|minutes?)`;
const ROMAN: [RegExp, string][] = [
  // "2 ghante CWC data fix par" and "CWC data fix pe 2 ghante": hours on a task, said with the
  // postposition. Put in English order -- the length, then "on" and the task -- before "pe" alone
  // becomes "on" and leaves "CWC data fix on 2 hours".
  [new RegExp(String.raw`^(${LENGTH})\s+(.+?)\s+(?:par|pe)\b`, 'i'), '$1 on $2'],
  [new RegExp(String.raw`^(.+?)\s+(?:par|pe)\s+(${LENGTH})(?=\s|$)`, 'i'), '$2 on $1'],
  // "Aarti ko payroll ka task do": give Aarti a task. The person comes first and "do" (give) last,
  // and with "ko" dropped below it read as a task called "Aarti payroll task do" for nobody.
  [/^(.+?)\s+ko\s+(.+?)\s+(?:ka|ki|ke)\s+(?:task|kaam)\s+(?:do|de\s*do|dedo|dena)\b/i, 'add $2 for $1'],
  [/^(.+?)\s+ko\s+(?:ek\s+)?(?:task|kaam)\s+(?:do|de\s*do|dedo|dena)\b\s*(.*)$/i, 'add $2 for $1'],
  // "Ek task create karo" -- "create a task". First, before "banao" becomes "add" below.
  [/\b(?:ek|ik)\s+(?:nay[aie]\s+)?(?:task|kaam)\s+(?:create|add|bana(?:o|ao|na)?|jodo)\b/gi, 'create a task'],
  // "vah task ke liye" -- "for that task": it points at the task being made and names nothing.
  [/\b(?:vah|woh?|wo|us|is|iss|ye|yeh)\s+(?:task|kaam)\s+ke\s+liye\b/gi, ' '],
  [/\bke\s+liye\b/gi, 'for'],
  // The postposition, which has to move here too.
  [/\b([a-z]+)\s+tak\b/gi, 'by $1'],
  [/\baaj\b/gi, 'today'],
  [/\bkal\b/gi, 'tomorrow'],
  [/\bparso+n?\b/gi, 'day after tomorrow'],
  [/\bsom(?:war|vaar|var)\b/gi, 'monday'],
  [/\bmangal(?:war|vaar|var)\b/gi, 'tuesday'],
  [/\bbudh(?:war|vaar|var)\b/gi, 'wednesday'],
  [/\bguru(?:war|vaar|var)\b/gi, 'thursday'],
  [/\bshukra(?:war|vaar|var)\b/gi, 'friday'],
  [/\bshani(?:war|vaar|var)\b/gi, 'saturday'],
  [/\bravi(?:war|vaar|var)\b|\bitwar\b/gi, 'sunday'],
  [/\b(?:zaroori|jaroori|zaruri)\b/gi, 'urgent'],
  [/\bsaamanya\b/gi, 'normal'],
  [/\b(?:jodo|banao|banaao)\b/gi, 'add'],
  [/\bbadlo\b/gi, 'change'],
  [/\b(?:hatao|mitao)\b/gi, 'delete'],
  [/\b(?:dikhao|batao)\b/gi, 'show'],
  [/\bkitne?\b/gi, 'how many'],
  [/\bmujhe\b/gi, 'me'],
  [/\b(?:mere|mera|meri)\b/gi, 'my'],
  [/\bchutti\b/gi, 'leave'],
  [/\b(?:bhejo|bhej\s*do|bhejna)\b/gi, 'send'],
  [/\bghant(?:e|a|on)\b/gi, 'hours'],
  [/\bpe\b/gi, 'on'],
  // The tense markers, once they have done their job of saying which day "kal" was.
  // Not "gaya" or "diya" alone: Gaya is a city and Diya is somebody's name.
  [/\s*\b(?:(?:kar|ho)\s+(?:diya|diye|gaya|gayi|gaye)|kiya|kiye|kie|kia|tha|thi|hua|hui|hue|lagaya|lagaye)\b/gi, ' '],
  [/\s*\b(?:hai|hain|hoon|hu)\b/gi, ' '],
  // Politeness verbs, romanised. "Karo" carries no meaning once the real verb is known, and left in
  // place it sits at the end of the sentence where the real verb needs to be found.
  [/\s*\b(?:karo|karen|kijiye|kar\s*do|kardo|karna)\b/gi, ' '],
  // "aaj kya due hai", "mera kya pending hai": the question word sits in the middle. Put it in
  // front, where the English rules look for a question -- otherwise "aaj kya due" read as a new
  // task called "Today kya".
  [/^(.+?)\s+kya\s+(.+?)\s*$/i, 'what is $2 $1'],
  // And at the very end, which is where Hinglish most often puts it: "mera aaj ka kaam kya hai"
  // was read as a new task called "My kaam kya", made on the spot because it had a day in it.
  [/^(.+?)\s+kya\s*$/i, 'what is $1'],
  // The other question words, moved to the front for the same reason: "mera manager kaun hai".
  [/^(.+?)\s+kaun\b\s*(.*)$/i, 'who is $1 $2'],
  [/^(.+?)\s+kab\b\s*(.*)$/i, 'when is $1 $2'],
  [/^(.+?)\s+kaha+n?\b\s*(.*)$/i, 'where is $1 $2'],
  [/^(.+?)\s+kaise\b\s*(.*)$/i, 'how do i $2 $1'],
  [/^(.+?)\s+kyo+n?\b\s*(.*)$/i, 'why is $1 $2'],
  [/^(.+?)\s+kyu+n?\b\s*(.*)$/i, 'why is $1 $2'],
];

export interface Translated {
  /** The sentence the English rules will read. */
  text: string;
  /** True when anything was actually rewritten, so the panel can show its working. */
  changed: boolean;
}

/** Is there Devanagari in here at all? */
export const isHindi = (text: string) => DEVANAGARI.test(text);

/**
 * Rewrite a Hindi or Hinglish sentence as English the rules understand.
 *
 * Safe to call on plain English: with no Devanagari and none of the romanised words, nothing
 * matches and the sentence comes back as it went in.
 */

/**
 * Hindi puts the verb last; English puts it first.
 *
 * "GST रिटर्न डिलीट करो" translates word for word to "GST रिटर्न delete", and every rule that
 * recognises an instruction looks at the front of the sentence -- so it read as a new task called
 * "GST रिटर्न delete" instead of a deletion. Moving the verb forward is what makes the two
 * languages agree about what kind of instruction this is.
 */
function verbToFront(text: string): string {
  const m = text.match(TRAILING_VERB);
  return m && m[1].trim() ? `${m[2].toLowerCase()} ${m[1].trim()}` : text;
}

/**
 * And Hindi puts the time first, where English trails it.
 *
 * "कल तक GST रिटर्न फाइल करो" becomes "by tomorrow GST रिटर्न फाइल", and the rule that reads
 * "by <date>" expects it at the end of the sentence. Only moved when it really is a date, so an
 * ordinary "by" is left where it stands.
 */
function dateToBack(text: string, now: Date): string {
  // A span is already in the order the parser wants, and it finds one anywhere in the sentence.
  // Moving its first half to the end turned "from today to friday audit" into "to friday audit
  // from today" -- two dates said, one understood, and the wrong one.
  if (/^from\s+\S+(?:\s+\S+)?\s+to\s+/i.test(text)) return text;
  // Up to three words, for "day after tomorrow" ("parso tak"), and with the verb in front of it
  // when the verb has already been moved there: "send by day after tomorrow report".
  const m = text.match(/^((?:[a-z]+\s+)?)(by|from)\s+(\S+(?:\s+\S+){0,2})\s+(.+)$/i);
  if (m) {
    for (let take = 3; take >= 1; take -= 1) {
      const words = m[3].split(/\s+/);
      if (words.length < take) continue;
      const candidate = words.slice(0, take).join(' ');
      if (!parseTypedDate(candidate, now)) continue;
      const leftover = words.slice(take).join(' ');
      return `${m[1]}${leftover} ${m[4]} ${m[2].toLowerCase()} ${candidate}`.replace(/\s+/g, ' ').trim();
    }
    if (!m[1]) return text;
  }
  // And a date with no preposition at all, which is the commonest way to say it: "आज बोर्ड पैक
  // बनाओ" becomes "add today board pack", where the date sits between the verb and the task's name
  // and reads as the first word of it. English puts it at the end.
  const bare = text.match(/^([a-z]+\s+)?(\S+(?:\s+\S+)?)\s+(.+)$/i);
  if (!bare) return text;
  for (let take = 2; take >= 1; take -= 1) {
    const candidate = bare[2].split(/\s+/).slice(0, take).join(' ');
    if (!parseTypedDate(candidate, now)) continue;
    const leftover = bare[2].split(/\s+/).slice(take).join(' ');
    return `${bare[1] ?? ''}${leftover} ${bare[3]} ${candidate}`.replace(/\s+/g, ' ').trim();
  }
  return text;
}

/**
 * Said in the past tense, which is what makes "kal" yesterday.
 *
 * Hindi has one word for both days either side of today, and only the verb tells them apart: "kal
 * tak bhejo" is by tomorrow, "kal 2 ghante log kiye" is two hours yesterday. So the tense is looked
 * for before the word is translated. Not "liye": "ke liye" means "for" and is in every tense.
 */
const PAST_ROMAN = /\b(?:kiya|kiye|kie|kia|tha|thi|hua|hui|hue|lagaya|lagaye|bitaya|(?:kar|ho)\s+(?:diya|diye|gaya|gayi|gaye))\b/i;
const PAST_DEVANAGARI = dev('किया', 'किये', 'किए', 'था', 'थी', 'थे', 'हुआ', 'हुई', 'हुए', 'गया', 'गई', 'गए', 'लगाया', 'लगाए');

export function toEnglish(input: string, now = new Date()): Translated {
  let text = fold(input);
  // "कल" and "kal" are yesterday when the sentence is about something already done.
  if (DEVANAGARI.test(input) ? new RegExp(PAST_DEVANAGARI.source).test(text) : PAST_ROMAN.test(text)) {
    text = text.replace(dev('कल'), 'yesterday').replace(/\bkal\b/gi, 'yesterday');
  }
  for (const [pattern, into] of REORDER) text = text.replace(pattern, into);
  for (const [pattern, into] of WORDS) text = text.replace(pattern, into);
  // Romanised rewrites only where there was no Devanagari: a Devanagari sentence has been handled,
  // and running these over its output invites collisions with whatever English it contained.
  if (!DEVANAGARI.test(input)) {
    for (const [pattern, into] of ROMAN) text = text.replace(pattern, into);
    // "ko", "ka", "ke", "ki" only mark who or whose, and carry nothing the parser needs: "client
    // ko call karna" is "call the client". Only in a sentence that was Hinglish to begin with --
    // in English they are nobody's words, but a client called "Ki Mobility" is somebody's.
    if (text.replace(/\s+/g, ' ').trim() !== input.replace(/\s+/g, ' ').trim()) {
      text = text.replace(/\s*\b(?:ko|ka|ke|ki)\b/gi, ' ');
    }
  }
  text = text.replace(/\s+/g, ' ').trim();
  // Decided before the tidy-up below: only a sentence that was translated has Hindi word order to
  // undo. Tidied English is still in English order.
  const translated = DEVANAGARI.test(input) || text !== input.replace(/\s+/g, ' ').trim();
  // Spoken filler and mishearings, in either language, once everything is in English words.
  text = tidySpoken(text);
  // Word order, last: both of these read the translated sentence, not the original.
  // Not when it opens with a length: "2 hours on CWC data fix" is already in English order, and
  // moving its last word ("fix") to the front made it a new task.
  if (translated && !/^\d+(?:[.:]\d+)?\s*[a-z]*\s+(?:on|for)\s/i.test(text)) text = dateToBack(verbToFront(text), now);
  const same = text.toLowerCase() === input.replace(/\s+/g, ' ').trim().toLowerCase();
  return { text, changed: !same };
}

/** The two languages the microphone can be set to. */
export const LANGUAGES = [
  { code: 'en-IN', label: 'English', hint: 'Say what you want, or ask a question' },
  { code: 'hi-IN', label: 'हिंदी', hint: 'जो करना है वह बोलिये' },
] as const;
export type LanguageCode = typeof LANGUAGES[number]['code'];
