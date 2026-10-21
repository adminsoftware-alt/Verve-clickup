// Your profile: who you are here, how to reach you, and the working week you are measured against.
//
// It used to be capacity inputs anybody could change, a Pomodoro length, and a "My Team" tab,
// all saved to the old store or the browser. Two of those were wrong in kind, not just in place:
// working hours are what capacity, workload and every "over or under" figure divide by, so they
// are set for people by an admin -- the server refuses anything else -- and a page that offered
// the inputs anyway only invited a save that would fail. The team is on the People pages.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Briefcase, Building2, Cake, Calendar, Camera, Clock, Hash, Lock, Mail, MapPin, Pencil, Phone,
  Sparkles, Trash2, User, Users,
} from 'lucide-react';

import { ask } from '../components/ask';
import { StatusSelector } from '../components/StatusSelector';
import { AddressField } from '../work/teams/AddressField';
import { useIsAdmin, useWork } from '../work/WorkContext';
import { Avatar } from '../work/ui';
import { peopleApi, personName, type Person } from '../work/teams/peopleApi';
import { accessOf } from '../work/teams/PersonDialogs';
import { sheetApi } from '../work/timesheets/api';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PHOTO_MAX = 5 * 1024 * 1024;

const card = 'rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6';
const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/15';
const hours = (seconds: number) => {
  const h = seconds / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
};
const longDate = (iso: string | null, withYear = true) => (iso
  ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) })
  : null);

/** One read-only line of the profile. */
const Row: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
  <div className="flex items-start gap-3 py-2.5">
    <span className="mt-0.5 shrink-0 text-gray-400">{icon}</span>
    <span className="w-36 shrink-0 text-sm text-gray-500">{label}</span>
    <span className="min-w-0 flex-1 text-sm text-gray-900">{children || <span className="text-gray-400">Not set</span>}</span>
  </div>
);

const SetByAdmin: React.FC = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
    <Lock size={11} /> Set by your admin
  </span>
);

// --- the profile --------------------------------------------------------------------------------

const ProfileTab: React.FC = () => {
  const { workspace, me, teams, allMembers, refresh } = useWork();
  const isAdmin = useIsAdmin();
  const ws = workspace?.id;
  const [person, setPerson] = useState<Person | null>(null);
  const [capacity, setCapacity] = useState<{ capacity_seconds: number[]; is_custom: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', location: '', address: '' });
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!ws || !me) return;
    try {
      const [p, c] = await Promise.all([peopleApi.get(ws, me), sheetApi.capacity(ws, me)]);
      setPerson(p);
      setCapacity(c);
    } catch (e) { setError((e as Error).message); }
  }, [ws, me]);
  useEffect(() => { load(); }, [load]);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNote(null);
    try {
      await work();
      await load();
      setNote(done);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const upload = (f: File | undefined) => {
    if (!f || !ws || !me) return;
    if (!PHOTO_TYPES.includes(f.type)) { setError('Use a PNG, JPG, WebP or GIF image.'); return; }
    if (f.size > PHOTO_MAX) { setError('That image is over 5 MB. Pick a smaller one.'); return; }
    // The header, the People pages and every task show this photo, so the shared copy of
    // everyone's details is reloaded too -- otherwise the old initials stay up until a refresh.
    act(async () => { await peopleApi.setAvatar(ws, me, f); await refresh(); }, 'Photo updated.');
  };
  const removePhoto = async () => {
    if (!ws || !me || !(await ask.confirm('Remove your profile photo? Your initials are shown instead.'))) return;
    act(async () => { await peopleApi.removeAvatar(ws, me); await refresh(); }, 'Photo removed.');
  };

  const startEdit = () => {
    if (!person) return;
    setForm({ name: person.user.display_name ?? '', phone: person.phone ?? '', location: person.location ?? '', address: person.address ?? '' });
    setEditing(true);
  };
  const saveDetails = () => ws && me && act(async () => {
    await peopleApi.update(ws, me, form);
    await refresh();
    setEditing(false);
  }, 'Your details are saved.');

  if (error && !person) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!person || !capacity) {
    return (
      <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading your profile">
        <div className="h-32 rounded-2xl bg-gray-100" />
        <div className="h-72 rounded-2xl bg-gray-100" />
      </div>
    );
  }

  const manager = allMembers.find((m) => m.user.id === person.manager_id);
  const myTeams = teams.filter((t) => person.team_ids.includes(t.id));
  const week = capacity.capacity_seconds;
  const workDays = DAYS.filter((_, i) => week[i] > 0);
  const weekly = week.reduce((a, b) => a + b, 0);
  const daily = workDays.length ? weekly / workDays.length : 0;

  return (
    <div className="space-y-5">
      {(note || error) && (
        <p role="status" className={`rounded-lg px-4 py-2.5 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{error ?? note}</p>
      )}

      {/* Who you are, and your photo. */}
      <section className={`${card} flex flex-col items-center gap-5 sm:flex-row sm:items-center`}>
        <div className="relative shrink-0">
          <div className="overflow-hidden rounded-full ring-4 ring-blue-50">
            <Avatar user={person.user} size={96} />
          </div>
          <button
            type="button" onClick={() => file.current?.click()} disabled={busy} aria-label="Upload a new photo"
            className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-blue-600 text-white shadow hover:bg-blue-700 disabled:opacity-60"
          >
            <Camera size={15} />
          </button>
          <input ref={file} type="file" accept={PHOTO_TYPES.join(',')} className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h2 className="truncate text-xl font-semibold text-gray-900">{personName(person)}</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            {[person.designation, person.level ? `Level ${person.level}` : null].filter(Boolean).join(' · ') || 'No designation yet'}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">{accessOf(person.role, person.user.id, teams)}</span>
            <span className="truncate text-xs text-gray-500">{person.user.email}</span>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 sm:justify-start">
            <span className="text-xs text-gray-500">Status</span>
            <StatusSelector align="left" />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => file.current?.click()} disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
            {person.user.avatar ? 'Change photo' : 'Upload photo'}
          </button>
          {person.user.avatar && (
            <button type="button" onClick={removePhoto} disabled={busy} aria-label="Remove photo"
              className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-60">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </section>

      {/* Personal information. The contact details are theirs to keep current; the rest is HR's. */}
      <section className={card}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900"><User size={17} className="text-blue-600" /> Personal information</h3>
          {!editing && (
            <button type="button" onClick={startEdit} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50">
              <Pencil size={14} /> Edit contact details
            </button>
          )}
        </div>

        {editing ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-gray-600">Name
              <input className={`${input} mt-1`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="text-xs font-medium text-gray-600">Phone
              <input className={`${input} mt-1`} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <div className="text-xs font-medium text-gray-600 sm:col-span-2">Address
              <div className="mt-1">
                <AddressField value={form.address} onChange={(address, city) => setForm((f) => ({ ...f, address, location: city }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button type="button" onClick={saveDetails} disabled={busy || !form.name.trim()}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">Save</button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            <Row icon={<User size={15} />} label="Name">{personName(person)}</Row>
            <Row icon={<Mail size={15} />} label="Email">{person.user.email}</Row>
            <Row icon={<Phone size={15} />} label="Phone">{person.phone}</Row>
            <Row icon={<MapPin size={15} />} label="Address">{person.address && <span className="whitespace-pre-line">{person.address}</span>}</Row>
          </div>
        )}

        <h4 className="mt-5 flex items-center gap-2 border-t border-gray-100 pt-4 text-sm font-semibold text-gray-900">
          Employment <SetByAdmin />
        </h4>
        <div className="divide-y divide-gray-100">
          <Row icon={<Briefcase size={15} />} label="Designation">{person.designation}</Row>
          <Row icon={<Sparkles size={15} />} label="Level">{person.level ? `Level ${person.level}` : null}</Row>
          <Row icon={<Building2 size={15} />} label="Department">{person.department}</Row>
          <Row icon={<Hash size={15} />} label="Employee code">{person.employee_code}</Row>
          <Row icon={<Users size={15} />} label="Reports to">{manager ? personName(manager) : null}</Row>
          <Row icon={<Users size={15} />} label="Teams">{myTeams.length ? myTeams.map((t) => t.name).join(', ') : null}</Row>
          <Row icon={<Calendar size={15} />} label="Date of joining">{longDate(person.date_of_joining)}</Row>
          <Row icon={<Cake size={15} />} label="Birthday">{longDate(person.date_of_birth, false)}</Row>
        </div>
      </section>

      {/* The week they are measured against. */}
      <section className={card}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-900"><Clock size={17} className="text-blue-600" /> Working hours</h3>
          {/* Read-only here for everyone, admins included: hours are set for people, in Admin ->
              Working hours, where an admin sees the whole company and its Teams at once. */}
          <SetByAdmin />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-blue-50/60 p-3">
            <p className="text-xs text-gray-500">Daily capacity</p>
            <p className="mt-0.5 text-lg font-semibold text-gray-900">{hours(daily)}</p>
          </div>
          <div className="rounded-xl bg-blue-50/60 p-3">
            <p className="text-xs text-gray-500">Weekly target</p>
            <p className="mt-0.5 text-lg font-semibold text-gray-900">{hours(weekly)}</p>
          </div>
          <div className="rounded-xl bg-blue-50/60 p-3">
            <p className="text-xs text-gray-500">Work days</p>
            <p className="mt-0.5 text-lg font-semibold text-gray-900">{workDays.length} a week</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {DAYS.map((d, i) => (
            <div key={d} className={`rounded-lg border px-1 py-2 text-center ${week[i] > 0 ? 'border-blue-100 bg-white' : 'border-gray-100 bg-gray-50'}`}>
              <p className="text-[11px] font-medium text-gray-500">{d.slice(0, 3)}</p>
              <p className={`mt-0.5 text-sm font-semibold ${week[i] > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{week[i] > 0 ? hours(week[i]) : 'Off'}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {capacity.is_custom ? 'Your own schedule.' : 'Your Team’s or the company’s standard week.'}{' '}
          {isAdmin ? 'Change anyone’s hours, or a whole Team’s, in Admin → Working hours.' : 'Ask an admin if this is not right.'}
        </p>
      </section>
    </div>
  );
};

// --- the page -----------------------------------------------------------------------------------

// Who people are, and who may do what, live in Admin (/admin). This page is only your own profile.
export const Settings: React.FC = () => (
  <div className="mx-auto max-w-3xl pb-10">
    <h1 className="mb-6 text-xl font-semibold text-gray-900">Settings</h1>
    <ProfileTab />
  </div>
);
