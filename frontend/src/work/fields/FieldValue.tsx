// Showing and editing custom field values, shared by the task view, List columns and Table view.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AlignLeft, AtSign, Calendar, CheckSquare, ChevronDown, CircleDollarSign, ExternalLink, Gauge, Hash, Link2,
  ListChecks, MapPin, Phone, Star, Tags, Type, Users,
} from 'lucide-react';
import type { CustomField, FieldType, Task, UserRef } from '../api';
import type { LocatedNode } from '../WorkContext';
import { Avatar, Portal } from '../ui';

export const FIELD_TYPES: { type: FieldType; label: string; icon: React.ReactNode; hint: string }[] = [
  { type: 'dropdown', label: 'Dropdown', icon: <ChevronDown size={14} />, hint: 'Pick one option' },
  { type: 'labels', label: 'Labels', icon: <Tags size={14} />, hint: 'Pick several options' },
  { type: 'text', label: 'Text', icon: <Type size={14} />, hint: 'A single line' },
  { type: 'long_text', label: 'Text area', icon: <AlignLeft size={14} />, hint: 'Longer notes' },
  { type: 'number', label: 'Number', icon: <Hash size={14} />, hint: 'Counts, quantities' },
  { type: 'money', label: 'Money', icon: <CircleDollarSign size={14} />, hint: 'Amounts in a currency' },
  { type: 'date', label: 'Date', icon: <Calendar size={14} />, hint: 'Any extra date' },
  { type: 'checkbox', label: 'Checkbox', icon: <CheckSquare size={14} />, hint: 'Yes or no' },
  { type: 'people', label: 'People', icon: <Users size={14} />, hint: 'Workspace members' },
  { type: 'email', label: 'Email', icon: <AtSign size={14} />, hint: 'An email address' },
  { type: 'phone', label: 'Phone', icon: <Phone size={14} />, hint: 'A phone number' },
  { type: 'url', label: 'Website', icon: <Link2 size={14} />, hint: 'A link' },
  { type: 'rating', label: 'Rating', icon: <Star size={14} />, hint: 'Stars, 1 to 10' },
  { type: 'progress', label: 'Progress', icon: <Gauge size={14} />, hint: '0-100%, set by hand' },
  { type: 'location', label: 'Location', icon: <MapPin size={14} />, hint: 'A place, shown on the Map view' },
];
export const fieldIcon = (t: FieldType) => FIELD_TYPES.find((x) => x.type === t)?.icon ?? <ListChecks size={14} />;

const money = (value: number, currency = 'INR') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value}`; }
};
const dateText = (iso: string, withTime?: boolean) => {
  const d = new Date(iso);
  return withTime ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** A field applies to a task if it's defined on the task's List or anywhere above it. */
export function fieldApplies(f: CustomField, t: Task, locate: (kind: 'list', id: string) => LocatedNode | null): boolean {
  if (f.location === 'space') return true;
  if (f.location === 'list') return f.location_id === t.list_id;
  return !!locate('list', t.list_id)?.path.some((c) => c.id === f.location_id);
}

/** Plain-text form of a value (CSV export, titles). */
export function valueText(field: CustomField, value: unknown, people: UserRef[]): string {
  if (value === undefined || value === null) return '';
  const opts = field.config.options ?? [];
  switch (field.type) {
    case 'dropdown': return opts.find((o) => o.id === value)?.name ?? '';
    case 'labels': return (value as string[]).map((v) => opts.find((o) => o.id === v)?.name).filter(Boolean).join(', ');
    case 'money': return money(value as number, field.config.currency);
    case 'number': return (value as number).toFixed(field.config.precision ?? 0);
    case 'date': return dateText(value as string, field.config.include_time);
    case 'checkbox': return value ? 'Yes' : '';
    case 'rating': return `${value}/${field.config.max ?? 5}`;
    case 'progress': return `${value}%`;
    case 'people': return (value as string[]).map((id) => { const p = people.find((x) => x.id === id); return p?.display_name || p?.email || id; }).join(', ');
    case 'location': return (value as { address?: string }).address ?? '';
    default: return String(value);
  }
}

// --- a small dropdown for option / people pickers ------------------------------------------------

const Picker: React.FC<{ label: string; trigger: React.ReactNode; disabled?: boolean; children: (close: () => void) => React.ReactNode }> = ({ label, trigger, disabled, children }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = r.bottom + 260 < window.innerHeight;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 264), left: Math.min(r.left, window.innerWidth - 248) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <>
      <button ref={button} type="button" aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="flex min-h-[1.5rem] w-full min-w-0 items-center gap-1 rounded px-1 text-left hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent">
        {trigger}
      </button>
      {open && pos && (
        <Portal>
          <div ref={panel} role="listbox" aria-label={label} onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: 240 }}
            className="z-[160] max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-lg">
            {children(() => setOpen(false))}
          </div>
        </Portal>
      )}
    </>
  );
};

const Chip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="max-w-full truncate rounded px-1.5 py-px text-[11px] font-medium text-white" style={{ backgroundColor: color }}>{children}</span>
);

// --- the editor ---------------------------------------------------------------------------------

/**
 * Edit one value. Text-like inputs save when you leave them (or press Enter); pickers save
 * on each choice. `compact` is for table and list cells.
 */
export const FieldEditor: React.FC<{
  field: CustomField; value: unknown; people: UserRef[]; disabled?: boolean; compact?: boolean;
  onChange: (value: unknown) => void;
}> = ({ field, value, people, disabled, compact, onChange }) => {
  const opts = field.config.options ?? [];
  const input = `w-full min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-gray-800 placeholder:text-gray-300 hover:border-gray-200 focus:border-brand-400 focus:bg-white focus:outline-none disabled:hover:border-transparent`;
  const commitText = (raw: string, current: unknown, parse: (s: string) => unknown = (s) => s) => {
    const next = raw.trim() === '' ? null : parse(raw.trim());
    if (next !== (current ?? null)) onChange(next);
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url': {
      const href = typeof value === 'string' && value
        ? field.type === 'email' ? `mailto:${value}` : field.type === 'phone' ? `tel:${value}` : field.type === 'url' ? value : null
        : null;
      return (
        <span className="flex min-w-0 items-center gap-1" onClick={stop}>
          <input key={String(value ?? '')} aria-label={field.name} disabled={disabled} defaultValue={(value as string) ?? ''}
            type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'} placeholder={compact ? '' : '—'}
            onBlur={(e) => commitText(e.target.value, value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={input} />
          {href && <a href={href} target="_blank" rel="noreferrer" title="Open" className="shrink-0 text-gray-400 hover:text-brand-600"><ExternalLink size={12} /></a>}
        </span>
      );
    }
    case 'long_text':
      return compact ? (
        <span onClick={stop} className="block min-w-0">
          <input key={String(value ?? '')} aria-label={field.name} disabled={disabled} defaultValue={(value as string) ?? ''}
            onBlur={(e) => commitText(e.target.value, value)} className={input} />
        </span>
      ) : (
        <textarea key={String(value ?? '')} aria-label={field.name} disabled={disabled} defaultValue={(value as string) ?? ''} rows={2} placeholder="—"
          onBlur={(e) => commitText(e.target.value, value)} className={`${input} resize-y`} />
      );
    case 'number':
    case 'money':
      return (
        <span className="flex min-w-0 items-center gap-1" onClick={stop}>
          {field.type === 'money' && <span className="shrink-0 text-xs text-gray-400">{field.config.currency ?? 'INR'}</span>}
          <input key={String(value ?? '')} aria-label={field.name} disabled={disabled} type="number" step="any" defaultValue={value === undefined || value === null ? '' : String(value)}
            placeholder={compact ? '' : '—'}
            onBlur={(e) => commitText(e.target.value, value, Number)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className={`${input} tabular-nums`} />
        </span>
      );
    case 'date': {
      const withTime = !!field.config.include_time;
      const local = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, withTime ? 16 : 10); };
      return (
        <span onClick={stop} className="block min-w-0">
          <input key={String(value ?? '')} aria-label={field.name} disabled={disabled} type={withTime ? 'datetime-local' : 'date'}
            defaultValue={typeof value === 'string' ? local(value) : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) { onChange(null); return; }
              const d = withTime ? new Date(v) : new Date(`${v}T12:00:00`);
              onChange(d.toISOString());
            }}
            className={input} />
        </span>
      );
    }
    case 'checkbox':
      return (
        <span onClick={stop} className="flex items-center px-1">
          <input type="checkbox" aria-label={field.name} disabled={disabled} checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        </span>
      );
    case 'rating': {
      const top = field.config.max ?? 5;
      const n = typeof value === 'number' ? value : 0;
      return (
        <span onClick={stop} className="flex items-center gap-0.5 px-1" role="radiogroup" aria-label={field.name}>
          {Array.from({ length: top }, (_, i) => i + 1).map((i) => (
            <button key={i} type="button" role="radio" aria-checked={n === i} aria-label={`${i} star${i === 1 ? '' : 's'}`} disabled={disabled}
              onClick={() => onChange(n === i ? null : i)} className="text-amber-400 disabled:cursor-default">
              <Star size={14} fill={i <= n ? 'currentColor' : 'none'} className={i <= n ? '' : 'text-gray-300'} />
            </button>
          ))}
        </span>
      );
    }
    case 'progress': {
      const n = typeof value === 'number' ? value : 0;
      return (
        <span onClick={stop} className="flex min-w-0 items-center gap-2 px-1">
          <input type="range" min={0} max={100} step={5} aria-label={field.name} disabled={disabled} key={n} defaultValue={n}
            onMouseUp={(e) => onChange(Number((e.target as HTMLInputElement).value) || null)}
            onKeyUp={(e) => onChange(Number((e.target as HTMLInputElement).value) || null)}
            className="h-1.5 min-w-0 flex-1 accent-emerald-500" />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-gray-600">{n}%</span>
        </span>
      );
    }
    case 'dropdown': {
      const current = opts.find((o) => o.id === value);
      return (
        <Picker label={field.name} disabled={disabled} trigger={
          current && compact
            // In List and Table cells, ClickUp's full-width coloured pill with a chevron.
            ? <span className="flex w-full min-w-0 items-center justify-between gap-1 rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: current.color }}>
                <span className="truncate">{current.name}</span><ChevronDown size={12} className="shrink-0 opacity-80" />
              </span>
            : current ? <Chip color={current.color}>{current.name}</Chip> : <span className="text-sm text-gray-300">{compact ? '' : '—'}</span>}>
          {(close) => (
            <>
              {opts.map((o) => (
                <button key={o.id} type="button" role="option" aria-selected={o.id === value} onClick={() => { close(); onChange(o.id === value ? null : o.id); }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-50">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.color }} /> {o.name}
                </button>
              ))}
              {opts.length === 0 && <p className="px-2 py-1 text-xs text-gray-400">No options yet — add them in the field's settings.</p>}
              {current && <button type="button" onClick={() => { close(); onChange(null); }} className="w-full rounded px-2 py-1 text-left text-xs text-gray-500 hover:bg-gray-50">Clear</button>}
            </>
          )}
        </Picker>
      );
    }
    case 'location':
      return <LocationEditor label={field.name} value={value} disabled={disabled} compact={compact} onChange={onChange} />;
    case 'labels':
    case 'people': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (id: string) => {
        const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
        onChange(next.length ? next : null);
      };
      const trigger = chosen.length === 0 ? <span className="text-sm text-gray-300">{compact ? '' : '—'}</span>
        : field.type === 'labels'
          ? <span className="flex min-w-0 flex-wrap gap-1">{chosen.map((id) => { const o = opts.find((x) => x.id === id); return o ? <Chip key={id} color={o.color}>{o.name}</Chip> : null; })}</span>
          : <span className="flex -space-x-1">{chosen.map((id) => { const p = people.find((x) => x.id === id); return p ? <Avatar key={id} user={p} size={20} /> : null; })}</span>;
      const choices = field.type === 'labels'
        ? opts.map((o) => ({ id: o.id, name: o.name, color: o.color as string | undefined }))
        : people.map((p) => ({ id: p.id, name: p.display_name || p.email, color: undefined }));
      return (
        <Picker label={field.name} disabled={disabled} trigger={trigger}>
          {() => choices.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-gray-50">
              <input type="checkbox" checked={chosen.includes(c.id)} onChange={() => toggle(c.id)} aria-label={c.name} />
              {c.color && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />}
              <span className="truncate">{c.name}</span>
            </label>
          ))}
        </Picker>
      );
    }
  }
};


// --- places --------------------------------------------------------------------------------------

type PlaceValue = { address: string; lat: number; lng: number };
const asPlace = (v: unknown): PlaceValue | null =>
  v && typeof v === 'object' && typeof (v as PlaceValue).lat === 'number' ? (v as PlaceValue) : null;

/** An address with its point on the map: type "lat, lng", or look the address up (OpenStreetMap). */
const LocationEditor: React.FC<{ label: string; value: unknown; disabled?: boolean; compact?: boolean; onChange: (v: unknown) => void }> = ({ label, value, disabled, compact, onChange }) => {
  const place = asPlace(value);
  const [address, setAddress] = useState(place?.address ?? '');
  const [coords, setCoords] = useState(place ? `${place.lat}, ${place.lng}` : '');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { setAddress(place?.address ?? ''); setCoords(place ? `${place.lat}, ${place.lng}` : ''); }, [place?.address, place?.lat, place?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = async () => {
    setNote('Looking up…');
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
      const [hit] = await res.json();
      if (!hit) { setNote('Not found — type the latitude and longitude instead'); return; }
      setCoords(`${Number(hit.lat).toFixed(5)}, ${Number(hit.lon).toFixed(5)}`);
      setNote(null);
    } catch { setNote('Lookup unavailable — type the latitude and longitude instead'); }
  };
  const save = (close: () => void) => {
    const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) { setNote('Give a latitude and longitude, e.g. 19.0596, 72.8295'); return; }
    onChange({ address: address.trim(), lat: Number(m[1]), lng: Number(m[2]) });
    close();
  };
  const trigger = place
    ? <span className="flex min-w-0 items-center gap-1 text-sm text-gray-800"><MapPin size={12} className="shrink-0 text-gray-400" /><span className="truncate">{place.address}</span></span>
    : <span className="text-sm text-gray-300">{compact ? '' : '—'}</span>;
  return (
    <Picker label={label} disabled={disabled} trigger={trigger}>
      {(close) => (
        <div className="space-y-1.5 p-1" onKeyDown={(e) => e.stopPropagation()}>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" aria-label="Address" className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          <div className="flex gap-1">
            <input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="lat, lng" aria-label="Latitude, longitude" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
            <button type="button" onClick={find} disabled={!address.trim()} className="rounded border border-gray-300 px-2 text-xs hover:bg-gray-50 disabled:opacity-40">Find</button>
          </div>
          {note && <p className="text-[11px] text-gray-500">{note}</p>}
          <div className="flex justify-end gap-1">
            {place && <button type="button" onClick={() => { onChange(null); close(); }} className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">Clear</button>}
            <button type="button" onClick={() => save(close)} className="rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">Save place</button>
          </div>
        </div>
      )}
    </Picker>
  );
};
