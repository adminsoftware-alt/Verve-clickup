// One address, typed in, with the city and state filled in from the pincode. (Filling it from
// "where you are now" was removed: it is usually an admin entering someone else's address.)
//
// It replaces the separate "Location" and "Address" boxes. The address is still kept as plain
// lines of text -- everything that shows a person's address prints it as it is -- and the city
// becomes their location, so the People pages keep working without a second field to fill.
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, MapPin, Pencil, Plus } from 'lucide-react';

import { COUNTRIES, INDIA } from './addressData';

export interface AddressParts {
  line1: string; line2: string; landmark: string; city: string; state: string; pincode: string; country: string;
}

const EMPTY: AddressParts = { line1: '', line2: '', landmark: '', city: '', state: '', pincode: '', country: 'India' };
const STATES = Object.keys(INDIA);
const isCountry = (s: string) => COUNTRIES.some((c) => c.toLowerCase() === s.toLowerCase());
const isState = (s: string) => STATES.some((c) => c.toLowerCase() === s.toLowerCase());

export function formatAddress(p: AddressParts): string {
  const place = [p.city, p.state].map((s) => s.trim()).filter(Boolean).join(', ');
  const pin = p.pincode.trim();
  return [
    p.line1, p.line2, p.landmark.trim() && `Near ${p.landmark.trim()}`,
    place && pin ? `${place} - ${pin}` : place || pin,
    p.country,
  ].map((s) => (s || '').trim()).filter(Boolean).join('\n');
}

/** Reads back what formatAddress wrote; an older free-text address lands in the first line. */
export function parseAddress(text: string | null | undefined): AddressParts {
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: AddressParts = { ...EMPTY, country: '' };
  if (lines.length && isCountry(lines[lines.length - 1])) out.country = lines.pop()!;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const withPin = lines[i].match(/^(.*?)[\s,-]*(\d{4,10})$/);
    const rest = withPin ? withPin[1] : lines[i];
    const parts = rest.split(',').map((s) => s.trim()).filter(Boolean);
    if (!withPin && !(parts.length >= 2 && isState(parts[parts.length - 1]))) continue;
    if (withPin) out.pincode = withPin[2];
    if (parts.length >= 2) out.state = parts.pop()!;
    out.city = parts.join(', ');
    lines.splice(i, 1);
    break;
  }
  const near = lines.findIndex((l) => /^near\s+/i.test(l));
  if (near >= 0) out.landmark = lines.splice(near, 1)[0].replace(/^near\s+/i, '');
  out.line1 = lines.shift() ?? '';
  out.line2 = lines.join(', ');
  if (!out.country && (out.state ? isState(out.state) : !text)) out.country = 'India';
  return out;
}

interface PostOffice { Name: string; District: string; Block: string; State: string; Country: string }

const cls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15';
const Label: React.FC<{ text: string; hint?: string; children: React.ReactNode; wide?: boolean }> = ({ text, hint, children, wide }) => (
  <label className={`block text-xs font-medium text-gray-600 ${wide ? 'sm:col-span-2' : ''}`}>
    {text}{hint && <span className="ml-1 font-normal text-gray-400">{hint}</span>}
    <div className="mt-1">{children}</div>
  </label>
);

export const AddressField: React.FC<{
  value: string | null | undefined;
  /** The whole address as text, and the city on its own (kept as the person's location). */
  onChange: (address: string, city: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(!value);
  const [parts, setParts] = useState<AddressParts>(() => parseAddress(value));
  const [offices, setOffices] = useState<PostOffice[]>([]);
  const [busy, setBusy] = useState<'pin' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const looked = useRef('');
  const id = useRef(`addr-${Math.random().toString(36).slice(2, 8)}`).current;

  // Kept in a ref too, so a lookup that answers after more typing builds on what is there now.
  const latest = useRef(parts);
  const update = (p: Partial<AddressParts>) => {
    const next = { ...latest.current, ...p };
    latest.current = next;
    setParts(next);
    onChange(formatAddress(next), next.city.trim());
  };

  // A full Indian pincode fills city, state and country, and offers its post offices as areas.
  useEffect(() => {
    const pin = parts.pincode.trim();
    if (parts.country !== 'India' || !/^\d{6}$/.test(pin) || looked.current === pin) return;
    looked.current = pin;
    let live = true;
    setBusy('pin'); setNote(null);
    fetch(`https://api.postalpincode.in/pincode/${pin}`)
      .then((r) => r.json())
      .then((data: { Status: string; PostOffice: PostOffice[] | null }[]) => {
        if (!live) return;
        const found = data?.[0]?.Status === 'Success' ? data[0].PostOffice ?? [] : [];
        setOffices(found);
        if (!found.length) { setNote('No post office has that pincode. Check it, or fill the rest in by hand.'); return; }
        const first = found[0];
        update({ state: first.State, city: latest.current.city.trim() || first.District, country: 'India' });
      })
      .catch(() => live && setNote('Could not look the pincode up just now. Fill the rest in by hand.'))
      .finally(() => live && setBusy(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.pincode, parts.country]);

  const india = parts.country === 'India';
  const cities = Array.from(new Set([
    ...offices.flatMap((o) => [o.District, o.Block]).filter((s) => s && s !== 'NA'),
    ...(india ? INDIA[parts.state] ?? [] : []),
  ]));

  if (!open) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2">
        <span className="flex min-w-0 items-start gap-2 text-sm text-gray-900">
          <MapPin size={15} className="mt-0.5 shrink-0 text-gray-400" />
          {value ? <span className="whitespace-pre-line">{value}</span> : <span className="text-gray-400">No address yet</span>}
        </span>
        <button type="button" onClick={() => setOpen(true)} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">
          {value ? <><Pencil size={12} /> Change</> : <><Plus size={12} /> Add address</>}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <p className="mb-3 text-xs font-normal text-gray-500">Type it in. A pincode fills the city and state.</p>
      {note && <p role="status" className="mb-3 rounded-md bg-white px-2.5 py-1.5 text-xs text-gray-600 ring-1 ring-gray-200">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Label text="Country">
          <div className="relative">
            <select aria-label="Country" value={parts.country} onChange={(e) => { setOffices([]); looked.current = ''; update({ country: e.target.value, state: '', city: '' }); }} className={`${cls} appearance-none pr-8`}>
              <option value="">Choose a country</option>
              {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          </div>
        </Label>
        <Label text={india ? 'Pincode' : 'Postal code'}>
          <div className="relative">
            <input aria-label="Pincode" inputMode={india ? 'numeric' : 'text'} maxLength={india ? 6 : 10} value={parts.pincode}
              onChange={(e) => update({ pincode: india ? e.target.value.replace(/\D/g, '') : e.target.value })}
              placeholder={india ? 'e.g. 411001' : ''} className={cls} />
            {busy === 'pin' && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
          </div>
        </Label>
        <Label text="State">
          {india ? (
            <div className="relative">
              <select aria-label="State" value={STATES.find((s) => s.toLowerCase() === parts.state.toLowerCase()) ?? ''} onChange={(e) => update({ state: e.target.value })} className={`${cls} appearance-none pr-8`}>
                <option value="">Choose a state</option>
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            </div>
          ) : (
            <input aria-label="State" value={parts.state} onChange={(e) => update({ state: e.target.value })} placeholder="State, province or region" className={cls} />
          )}
        </Label>
        <Label text="City">
          <input aria-label="City" list={`${id}-cities`} value={parts.city} onChange={(e) => update({ city: e.target.value })} placeholder={cities.length ? 'Pick or type' : 'City or town'} className={cls} />
          <datalist id={`${id}-cities`}>{cities.map((c) => <option key={c} value={c} />)}</datalist>
        </Label>
        <Label text="House, flat or building" wide>
          <input aria-label="House, flat or building" value={parts.line1} onChange={(e) => update({ line1: e.target.value })} placeholder="e.g. Flat 302, Sai Residency" className={cls} />
        </Label>
        <Label text="Street, area or locality" wide>
          <input aria-label="Street, area or locality" list={`${id}-areas`} value={parts.line2} onChange={(e) => update({ line2: e.target.value })} placeholder={offices.length ? 'Pick your area or type the street' : 'e.g. FC Road, Shivajinagar'} className={cls} />
          <datalist id={`${id}-areas`}>{offices.map((o) => <option key={o.Name} value={o.Name} />)}</datalist>
        </Label>
        <Label text="Landmark" hint="optional" wide>
          <input aria-label="Landmark" value={parts.landmark} onChange={(e) => update({ landmark: e.target.value })} placeholder="e.g. Opposite City Mall" className={cls} />
        </Label>
      </div>
      {value && (
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">Done</button>
        </div>
      )}
    </div>
  );
};
