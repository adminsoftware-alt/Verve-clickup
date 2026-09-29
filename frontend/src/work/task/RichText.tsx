// Rich text for task descriptions, stored as Markdown (plain text stays readable as it is).
// Rendering builds React elements directly — never HTML strings — so nothing typed can inject markup.
import React, { useEffect, useRef, useState } from 'react';
import { Bold, Code, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Inline formatting: **bold**, *italic*, ~~strike~~, `code`, [text](url) and bare links. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*]+)\*)|(_([^_]+)_)|(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[2]) out.push(<strong key={k}>{inline(m[2], k)}</strong>);
    else if (m[4]) out.push(<s key={k}>{inline(m[4], k)}</s>);
    else if (m[6]) out.push(<code key={k} className="rounded bg-gray-100 px-1 py-px font-mono text-[0.85em] text-pink-700">{m[6]}</code>);
    else if (m[8]) {
      out.push(SAFE_URL.test(m[9])
        ? <a key={k} href={m[9]} target="_blank" rel="noreferrer" className="text-brand-600 underline">{m[8]}</a>
        : <span key={k}>{m[8]}</span>);
    } else if (m[11] || m[13]) out.push(<em key={k}>{inline(m[11] ?? m[13], k)}</em>);
    else if (m[14]) out.push(<a key={k} href={m[14]} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline">{m[14]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Block formatting: headings, lists, checklists, quotes, code blocks, paragraphs. */
export const Markdown: React.FC<{ text: string; onToggle?: (line: number) => void }> = ({ text, onToggle }) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i += 1; }
      i += 1;
      blocks.push(<pre key={k} className="my-2 overflow-x-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100">{code.join('\n')}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const cls = h[1].length === 1 ? 'text-lg font-semibold' : h[1].length === 2 ? 'text-base font-semibold' : 'text-sm font-semibold';
      blocks.push(<p key={k} role="heading" aria-level={h[1].length + 1} className={`mb-1 mt-3 text-gray-900 ${cls}`}>{inline(h[2], k)}</p>);
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      blocks.push(<blockquote key={k} className="my-2 border-l-4 border-gray-200 pl-3 text-gray-600">{inline(quote.join(' '), k)}</blockquote>);
      continue;
    }
    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i])) {
        const idx = i;
        const done = /\[[xX]\]/.test(lines[i]);
        const body = lines[i].replace(/^\s*[-*]\s+\[[ xX]\]\s/, '');
        items.push(
          <li key={`c${idx}`} className="flex items-start gap-2">
            <input type="checkbox" checked={done} disabled={!onToggle} onChange={() => onToggle?.(idx)} className="mt-1" aria-label={body} />
            <span className={done ? 'text-gray-400 line-through' : ''}>{inline(body, `c${idx}`)}</span>
          </li>,
        );
        i += 1;
      }
      blocks.push(<ul key={k} className="my-1 space-y-0.5">{items}</ul>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i])) {
        items.push(<li key={`u${i}`}>{inline(lines[i].replace(/^\s*[-*]\s+/, ''), `u${i}`)}</li>);
        i += 1;
      }
      blocks.push(<ul key={k} className="my-1 list-disc space-y-0.5 pl-5">{items}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(<li key={`o${i}`}>{inline(lines[i].replace(/^\s*\d+[.)]\s+/, ''), `o${i}`)}</li>);
        i += 1;
      }
      blocks.push(<ol key={k} className="my-1 list-decimal space-y-0.5 pl-5">{items}</ol>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={k} className="my-3 border-gray-200" />); i += 1; continue; }
    if (!line.trim()) { i += 1; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|```|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push(<p key={k} className="my-1 whitespace-pre-wrap">{inline(para.join('\n'), k)}</p>);
  }
  return <div className="text-sm leading-relaxed text-gray-800">{blocks}</div>;
};

type Wrap = { before: string; after?: string; line?: boolean; placeholder: string };
const TOOLS: { label: string; icon: React.ReactNode; wrap: Wrap; key?: string }[] = [
  { label: 'Bold', icon: <Bold size={14} />, wrap: { before: '**', after: '**', placeholder: 'bold text' }, key: 'b' },
  { label: 'Italic', icon: <Italic size={14} />, wrap: { before: '*', after: '*', placeholder: 'italic text' }, key: 'i' },
  { label: 'Strikethrough', icon: <Strikethrough size={14} />, wrap: { before: '~~', after: '~~', placeholder: 'text' } },
  { label: 'Heading', icon: <Heading2 size={14} />, wrap: { before: '## ', line: true, placeholder: 'Heading' } },
  { label: 'Bulleted list', icon: <List size={14} />, wrap: { before: '- ', line: true, placeholder: 'item' } },
  { label: 'Numbered list', icon: <ListOrdered size={14} />, wrap: { before: '1. ', line: true, placeholder: 'item' } },
  { label: 'Checklist', icon: <ListChecks size={14} />, wrap: { before: '- [ ] ', line: true, placeholder: 'to do' } },
  { label: 'Quote', icon: <Quote size={14} />, wrap: { before: '> ', line: true, placeholder: 'quote' } },
  { label: 'Code', icon: <Code size={14} />, wrap: { before: '`', after: '`', placeholder: 'code' } },
  { label: 'Link', icon: <Link2 size={14} />, wrap: { before: '[', after: '](https://)', placeholder: 'link text' }, key: 'k' },
];

/** The description: formatted when reading; click to edit with a toolbar (Ctrl+B / I / K). */
export const RichTextEditor: React.FC<{ value: string; disabled?: boolean; onSave: (text: string) => void; placeholder?: string }> = ({ value, disabled, onSave, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  // What's shown: the saved text, or a just-ticked checklist until the save comes back.
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const box = useRef<HTMLTextAreaElement>(null);
  const start = () => { if (disabled) return; setDraft(value); setEditing(true); setTimeout(() => box.current?.focus(), 0); };
  const finish = () => { setEditing(false); if (draft !== value) { setShown(draft); onSave(draft); } };
  const apply = (w: Wrap) => {
    const el = box.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const chosen = draft.slice(a, b) || w.placeholder;
    let next: string;
    let cursor: number;
    if (w.line) {
      const lineStart = draft.lastIndexOf('\n', a - 1) + 1;
      const body = draft.slice(lineStart, b) || w.placeholder;
      const prefixed = body.split('\n').map((l) => `${w.before}${l}`).join('\n');
      next = draft.slice(0, lineStart) + prefixed + draft.slice(Math.max(b, lineStart));
      cursor = lineStart + prefixed.length;
    } else {
      next = draft.slice(0, a) + w.before + chosen + (w.after ?? '') + draft.slice(b);
      cursor = a + w.before.length + chosen.length;
    }
    setDraft(next);
    setTimeout(() => { el.focus(); el.setSelectionRange(cursor, cursor); }, 0);
  };
  const toggleLine = (line: number) => {
    const lines = shown.split('\n');
    lines[line] = /\[[xX]\]/.test(lines[line]) ? lines[line].replace(/\[[xX]\]/, '[ ]') : lines[line].replace('[ ]', '[x]');
    setShown(lines.join('\n'));
    onSave(lines.join('\n'));
  };
  if (!editing) {
    return (
      <div role="button" tabIndex={disabled ? -1 : 0} aria-label="Description" onClick={(e) => { if ((e.target as HTMLElement).closest('a,input')) return; start(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') start(); }}
        className={`min-h-18 rounded-md border border-gray-200 px-3 py-2 ${disabled ? '' : 'cursor-text hover:border-gray-300'}`}>
        {shown.trim() ? <Markdown text={shown} onToggle={disabled ? undefined : toggleLine} /> : <span className="text-sm text-gray-400">{placeholder ?? 'Add a description'}</span>}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-brand-400">
      <div className="flex flex-wrap gap-0.5 border-b border-gray-100 px-1.5 py-1" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t) => (
          <button key={t.label} type="button" title={`${t.label}${t.key ? ` (Ctrl+${t.key.toUpperCase()})` : ''}`} aria-label={t.label}
            onMouseDown={(e) => { e.preventDefault(); apply(t.wrap); }} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900">{t.icon}</button>
        ))}
        <span className="ml-auto self-center pr-1 text-[11px] text-gray-400">Markdown · click outside to save</span>
      </div>
      <textarea
        ref={box}
        aria-label="Edit description"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(value); setEditing(false); return; }
          if (e.ctrlKey || e.metaKey) {
            const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
            if (tool) { e.preventDefault(); apply(tool.wrap); }
          }
        }}
        rows={Math.min(20, Math.max(6, draft.split('\n').length + 1))}
        placeholder={placeholder ?? 'Add a description'}
        className="block w-full resize-y rounded-b-md px-3 py-2 font-mono text-[13px] text-gray-800 focus:outline-none"
      />
    </div>
  );
};
