// How a comment's text is written, stored and shown.
//
// A mention is stored as `@[Name](user:<id>)` or `@[Name](team:<id>)`. The composer shows plain
// `@Name` while you type and turns the people you picked into tokens on send; the feed shows the
// person's current name, so a rename does not leave a dead "@Old name" behind. The name inside
// the token is only a fallback for someone who has since left.
//
// Formatting is a small, safe subset of Markdown -- **bold**, *italic*, `code`, links, and lines
// starting "- " or "1. " as lists -- built as React elements, never as HTML.
import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { attachmentBlob, openAttachment, type Comment, type CommentFile } from '../collabApi';
import { useWork } from '../WorkContext';

export interface MentionPick { kind: 'user' | 'team'; id: string; label: string }

const TOKEN = /@\[([^\]\n]{1,100})\]\((user|team):([\w.@:-]{1,128})\)/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain `@Name` for each picked mention becomes its token; longer names first, so "Ann Lee" beats "Ann". */
export function toTokens(text: string, picks: MentionPick[]): string {
  let out = text;
  for (const p of [...picks].sort((a, b) => b.label.length - a.label.length)) {
    if (!p.label) continue;
    // Not inside a token already, and not the start of a longer word.
    out = out.replace(new RegExp(`(^|[^\\[\\w])@${escape(p.label)}(?![\\w\\]])`, 'g'), `$1@[${p.label}](${p.kind}:${p.id})`);
  }
  return out;
}

/** The current name for a token, falling back to the name it was written with. */
function useNames() {
  const { allMembers, teams } = useWork();
  return (kind: string, id: string, fallback: string) => {
    if (kind === 'team') return teams.find((t) => t.id === id)?.name ?? fallback;
    const m = allMembers.find((x) => x.user.id === id);
    return m ? m.user.display_name || m.user.email : fallback;
  };
}

/** A stored body as editable text, plus the mentions in it, so saving turns them back into tokens. */
export function useEditable() {
  const name = useNames();
  return (body: string): { text: string; picks: MentionPick[] } => {
    const picks: MentionPick[] = [];
    const text = body.replace(TOKEN, (_m, label: string, kind: 'user' | 'team', id: string) => {
      const now = name(kind, id, label);
      picks.push({ kind, id, label: now });
      return `@${now}`;
    });
    return { text, picks };
  };
}

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;
// One pass over a line: a token, a URL, **bold**, *italic* or `code`, whichever comes first.
const INLINE = new RegExp(`${TOKEN.source}|(${URL_RE.source})|\\*\\*([^*\\n]+)\\*\\*|\\*([^*\\s][^*\\n]*)\\*|\`([^\`\\n]+)\``, 'g');

const Mention: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="rounded bg-brand-50 px-0.5 font-medium text-brand-700">{children}</span>
);

/** Mentions written before tokens existed are still highlighted by name. */
function legacy(text: string, names: string[], key: string): React.ReactNode[] {
  if (!names.length) return [text];
  const pattern = new RegExp(`(@(?:${names.map(escape).join('|')}))`, 'g');
  return text.split(pattern).map((part, i) => (names.some((n) => part === `@${n}`)
    ? <Mention key={`${key}-l${i}`}>{part}</Mention>
    : <React.Fragment key={`${key}-l${i}`}>{part}</React.Fragment>));
}

function inline(line: string, names: string[], name: ReturnType<typeof useNames>, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of line.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...legacy(line.slice(last, at), names, `${key}-${n++}`));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<Mention key={k}>@{name(m[2], m[3], m[1])}</Mention>);
    else if (m[4] !== undefined) out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{m[4]}</a>);
    else if (m[5] !== undefined) out.push(<strong key={k} className="font-semibold">{m[5]}</strong>);
    else if (m[6] !== undefined) out.push(<em key={k}>{m[6]}</em>);
    else if (m[7] !== undefined) out.push(<code key={k} className="rounded bg-gray-100 px-1 text-[12px]">{m[7]}</code>);
    last = at + m[0].length;
  }
  if (last < line.length) out.push(...legacy(line.slice(last), names, `${key}-${n}`));
  return out;
}

/** A comment's text, formatted. */
export const CommentBody: React.FC<{ comment: Pick<Comment, 'body' | 'mentions' | 'mention_teams'> }> = ({ comment }) => {
  const name = useNames();
  const names = [...comment.mentions.map((m) => m.display_name || m.email), ...comment.mention_teams.map((t) => t.name)].filter(Boolean) as string[];
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, names, name, `b${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered
      ? <ol key={`b${blocks.length}`} className="ml-5 list-decimal">{items}</ol>
      : <ul key={`b${blocks.length}`} className="ml-5 list-disc">{items}</ul>);
    list = null;
  };
  for (const line of comment.body.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      list = list ?? { ordered, items: [] };
      list.items.push(item[1]);
      continue;
    }
    flush();
    blocks.push(<p key={`b${blocks.length}`} className="min-h-[1.25rem]">{inline(line, names, name, `b${blocks.length}`)}</p>);
  }
  flush();
  return <div className="break-words text-sm text-gray-800">{blocks}</div>;
};

const isImage = (f: CommentFile) => f.content_type.startsWith('image/');

/** A picture, fetched with the person's sign-in, since the download link needs it. */
const Thumb: React.FC<{ file: CommentFile }> = ({ file }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    attachmentBlob(file.id).then((b) => { if (!gone) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => undefined);
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [file.id]);
  return (
    <button type="button" title={file.filename} onClick={() => openAttachment(file)} className="block overflow-hidden rounded-md border border-gray-200 bg-gray-50">
      {url ? <img src={url} alt={file.filename} className="h-24 max-w-[12rem] object-cover" /> : <span className="skeleton block h-24 w-32" role="status" aria-label="Loading" />}
    </button>
  );
};

/** The files sent with a comment: pictures as thumbnails, anything else as a chip to open. */
export const CommentFiles: React.FC<{ files: CommentFile[] }> = ({ files }) => {
  if (!files.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {files.map((f) => (isImage(f) ? <Thumb key={f.id} file={f} /> : (
        <button key={f.id} type="button" onClick={() => openAttachment(f)} title="Open"
          className="flex max-w-[14rem] items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 hover:border-brand-300">
          <FileText size={13} className="shrink-0 text-gray-400" /><span className="truncate">{f.filename}</span>
        </button>
      )))}
    </div>
  );
};
