// Your profile: who you are here, how to reach you, and the working week you are measured against.
//
// It used to be capacity inputs anybody could change, a Pomodoro length, and a "My Team" tab,
// all saved to the old store or the browser. Two of those were wrong in kind, not just in place:
// working hours are what capacity, workload and every "over or under" figure divide by, so they
// are set for people by an admin -- the server refuses anything else -- and a page that offered
// the inputs anyway only invited a save that would fail. The team is on the People pages.
//
// Two columns on a wide screen: you on the left (photo, status, what is left to fill in), and on
// the right the details, in tabs -- Profile and Notifications.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import {
  Bell, Briefcase, Building2, Cake, Calendar, Camera, CheckCircle2, Clock, Hash, Lock, Mail, MapPin, Pencil, Phone,
  PhoneCall, Sparkles, Trash2, User, UserRound, Users,
} from 'lucide-react';

import { ask } from '../components/ask';
import { StatusSelector } from '../components/StatusSelector';
import { SELF_COLOR } from '../components/HeaderBits';
import { useTopBarSlot } from '../components/topBarSlot';
import { AddressField } from '../work/teams/AddressField';
import { useIsAdmin, useWork } from '../work/WorkContext';
import { Avatar } from '../work/ui';
import { peopleApi, personName, type Person } from '../work/teams/peopleApi';
import { accessOf } from '../work/teams/PersonDialogs';
import { sheetApi } from '../work/timesheets/api';
import { BellIcon, NotificationSettingsPanel } from '../work/InboxPages';
import { BELL_STYLES, setBellStyle, useBellStyle } from '../components/bellStyle';

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

/** One read-only detail: the label over its value, two to a row on a wide screen. */
const Field: React.FC<{ icon: React.ReactNode; label: string; children: React.ReactNode; wide?: boolean }> = ({ icon, label, children, wide }) => (
  <div className={`border-b border-gray-100 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
    <p className="flex items-center gap-1.5 text-xs text-gray-500"><span className="text-gray-400">{icon}</span>{label}</p>
    <div className="mt-1 min-h-[1.25rem] text-sm text-gray-900">{children || <span className="text-gray-400">Not set</span>}</div>
  </div>
);

const SetByAdmin: React.FC = () => (
  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
    <Lock size={11} /> Set by your admin
  </span>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="flex items-center gap-2.5 text-base font-semibold text-[#1B2A4A]">
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEF2F8] text-[#234788]">{icon}</span>
    {children}
  </h3>
);

/** The look of the bell in the top bar: each choice drawn as it will look, and the bar's own bell
 *  changes the moment one is picked. Pointing at a choice rings its bell. */
const BellStylePicker: React.FC = () => {
  const current = useBellStyle();
  return (
    <section className={card}>
      <div className="mb-1"><SectionTitle icon={<Bell size={15} />}>Bell style</SectionTitle></div>
      <p className="mb-4 text-sm text-gray-500">How the bell in the top bar looks. It rings when a new notification arrives.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5" role="radiogroup" aria-label="Bell style">
        {BELL_STYLES.map((b) => {
          const on = b.key === current;
          return (
            <button key={b.key} type="button" role="radio" aria-checked={on} onClick={() => setBellStyle(b.key)}
              className={`bell-pick flex flex-col items-center gap-2 rounded-xl border px-3 pb-3 pt-4 text-center transition-colors ${on ? 'border-[#234788] bg-[#F8FAFD] shadow-[0_0_0_3px_rgba(35,71,136,0.10)]' : 'border-gray-200 hover:border-[#B3C3DF]'}`}>
              <span className={`header-bell bell-${b.key}`}>
                <BellIcon />
                <span className="bell-count">3</span>
              </span>
              <span className="text-sm font-medium text-[#1B2A4A]">{b.name}</span>
              <span className="text-[11px] leading-tight text-gray-500">{b.note}</span>
              <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 ${on ? 'border-[#234788] bg-[#234788]' : 'border-gray-300'}`}>
                {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

// --- the profile --------------------------------------------------------------------------------

const ProfilePage: React.FC = () => {
  const { workspace, me, teams, allMembers, refresh } = useWork();
  const isAdmin = useIsAdmin();
  const ws = workspace?.id;
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'notifications' ? 'notifications' : 'profile';
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
    setParams({});
  };
  const saveDetails = () => ws && me && act(async () => {
    await peopleApi.update(ws, me, form);
    await refresh();
    setEditing(false);
  }, 'Your details are saved.');

  if (error && !person) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!person || !capacity) {
    return (
      <div className="grid animate-pulse gap-6 lg:grid-cols-[300px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading your profile">
        <div className="h-96 rounded-2xl bg-gray-100" />
        <div className="h-[32rem] rounded-2xl bg-gray-100" />
      </div>
    );
  }

  const manager = allMembers.find((m) => m.user.id === person.manager_id);
  const myTeams = teams.filter((t) => person.team_ids.includes(t.id));
  const week7 = capacity.capacity_seconds;
  const workDays = DAYS.filter((_, i) => week7[i] > 0);
  const weekly = week7.reduce((a, b) => a + b, 0);
  const daily = workDays.length ? weekly / workDays.length : 0;
  // What is yours to fill in, and is not yet.
  const todo = [
    { label: 'Add a photo', done: !!person.user.avatar, act: () => file.current?.click() },
    { label: 'Add your phone', done: !!person.phone, act: startEdit },
    { label: 'Add your address', done: !!person.address, act: startEdit },
  ];
  const doneCount = todo.filter((t) => t.done).length;

  const tabCls = (on: boolean) => `-mb-px flex items-center gap-2 border-b-2 px-1 py-3 text-sm ${on ? 'border-[#234788] font-medium text-[#1B2A4A]' : 'border-transparent text-gray-500 hover:text-gray-800'}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* --- You --- */}
      <aside className="grid gap-4 md:grid-cols-2 lg:sticky lg:top-0 lg:block lg:space-y-4">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:row-span-2">
          <div className="h-20 bg-gradient-to-b from-[#E3EAF6] to-[#F3F6FC]" />
          <div className="-mt-12 flex flex-col items-center px-5 pb-5 text-center">
            {/* The photo is its own button: click it, or the camera, to change it. */}
            <button type="button" onClick={() => file.current?.click()} disabled={busy} aria-label="Change your photo" className="group relative rounded-full disabled:opacity-60">
              <span className="block overflow-hidden rounded-full ring-4 ring-white">
                <Avatar user={person.user} size={96} color={SELF_COLOR} />
              </span>
              <span className="absolute bottom-0.5 right-0.5 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#234788] text-white shadow group-hover:bg-[#1C3A70]">
                <Camera size={15} />
              </span>
            </button>
            <input ref={file} type="file" accept={PHOTO_TYPES.join(',')} className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <h2 className="mt-3 max-w-full truncate text-lg font-semibold text-[#1B2A4A]">{personName(person)}</h2>
            <p className="text-sm text-gray-500">
              {[person.designation, person.level ? `Level ${person.level}` : null].filter(Boolean).join(' · ') || 'No designation yet'}
            </p>
            <span className="mt-2 rounded-full bg-[#EEF2F8] px-2.5 py-0.5 text-xs font-medium text-[#234788]">{accessOf(person.role, person.user.id, teams)}</span>
            <p className="mt-2 max-w-full truncate text-xs text-gray-500">{person.user.email}</p>
            <div className="mt-4 flex items-center gap-2">
              <span className="text-xs text-gray-500">Status</span>
              <StatusSelector align="left" />
            </div>
            {person.user.avatar && (
              <button type="button" onClick={removePhoto} disabled={busy}
                className="mt-3 flex items-center gap-1 text-xs text-gray-400 hover:text-red-600 disabled:opacity-60">
                <Trash2 size={12} /> Remove photo
              </button>
            )}
          </div>
        </section>

        {/* What is left to fill in -- gone once it is all done. */}
        <section className={`${card} !p-4`}>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-[#1B2A4A]">Your profile</span>
            <span className="text-xs text-gray-500">{doneCount} of {todo.length} done</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E3E8F0]">
            <div className="h-full rounded-full bg-[#234788] transition-[width] duration-500" style={{ width: `${(doneCount / todo.length) * 100}%` }} />
          </div>
          <ul className="mt-3 space-y-1">
            {todo.map((t) => (
              <li key={t.label}>
                {t.done ? (
                  <span className="flex items-center gap-2 px-1 py-1 text-sm text-gray-400 line-through"><CheckCircle2 size={15} className="text-[#234788] no-underline" /> {t.label}</span>
                ) : (
                  <button type="button" onClick={t.act} className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-gray-700 hover:bg-[#F3F6FC]">
                    <span className="h-[15px] w-[15px] rounded-full border-2 border-gray-300" /> {t.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

      </aside>

      {/* --- The details, in tabs --- */}
      <div className="min-w-0 space-y-5">
        <nav className="flex gap-6 border-b border-gray-200" aria-label="Settings sections">
          <button type="button" onClick={() => setParams({})} className={tabCls(tab === 'profile')}><UserRound size={15} /> Profile</button>
          <button type="button" onClick={() => setParams({ tab: 'notifications' })} className={tabCls(tab === 'notifications')}><Bell size={15} /> Notifications</button>
        </nav>

        {(note || error) && (
          <p role="status" className={`rounded-lg px-4 py-2.5 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-[#EEF2F8] text-[#1B2A4A]'}`}>{error ?? note}</p>
        )}

        {tab === 'notifications' ? (<>
          <BellStylePicker />
          <section className={card}>
            <div className="mb-4"><SectionTitle icon={<Bell size={15} />}>Notifications</SectionTitle></div>
            <NotificationSettingsPanel />
          </section>
        </>) : (<>
          {/* Personal information. The contact details are theirs to keep current; the rest is HR's. */}
          <section className={card}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <SectionTitle icon={<User size={15} />}>Personal information</SectionTitle>
              {!editing && (
                <button type="button" onClick={startEdit} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-[#234788] hover:border-[#B3C3DF] hover:bg-[#F8FAFD]">
                  <Pencil size={14} /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                    className="rounded-lg bg-[#234788] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#1C3A70] disabled:opacity-60">Save</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-x-8 sm:grid-cols-2">
                <Field icon={<User size={13} />} label="Name">{personName(person)}</Field>
                <Field icon={<Mail size={13} />} label="Email">{person.user.email}</Field>
                <Field icon={<Phone size={13} />} label="Phone">{person.phone}</Field>
                <Field icon={<MapPin size={13} />} label="Address">{person.address && <span className="whitespace-pre-line">{person.address}</span>}</Field>
              </div>
            )}
          </section>

          <section className={card}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle icon={<Briefcase size={15} />}>Employment</SectionTitle>
              <SetByAdmin />
            </div>
            <div className="grid gap-x-8 sm:grid-cols-2">
              <Field icon={<Briefcase size={13} />} label="Designation">{person.designation}</Field>
              <Field icon={<Sparkles size={13} />} label="Level">{person.level ? `Level ${person.level}` : null}</Field>
              <Field icon={<Building2 size={13} />} label="Department">{person.department}</Field>
              <Field icon={<Hash size={13} />} label="Employee code">{person.employee_code}</Field>
              <Field icon={<Users size={13} />} label="Reports to">
                {manager && <span className="flex items-center gap-2"><Avatar user={manager.user} size={22} /> {personName(manager)}</span>}
              </Field>
              <Field icon={<Users size={13} />} label="Teams">
                {myTeams.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {myTeams.map((t) => <span key={t.id} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">{t.name}</span>)}
                  </span>
                )}
              </Field>
              <Field icon={<Briefcase size={13} />} label="Employment type">{person.employment_type}</Field>
              <Field icon={<Calendar size={13} />} label="Date of joining">{longDate(person.date_of_joining)}</Field>
              <Field icon={<Cake size={13} />} label="Birthday">{longDate(person.date_of_birth, false)}</Field>
              <Field icon={<PhoneCall size={13} />} label="Emergency contact">
                {(person.emergency_contact_name || person.emergency_contact_phone) &&
                  [person.emergency_contact_name, person.emergency_contact_phone].filter(Boolean).join(' · ')}
              </Field>
            </div>
          </section>

          {/* The week they are measured against. */}
          <section className={card}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle icon={<Clock size={15} />}>Working hours</SectionTitle>
              {/* Read-only here for everyone, admins included: hours are set for people, in Admin ->
                  Working hours, where an admin sees the whole company and its Teams at once. */}
              <SetByAdmin />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[['Daily capacity', hours(daily)], ['Weekly target', hours(weekly)], ['Work days', `${workDays.length} a week`]].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[#E3E8F0] bg-[#F8FAFD] p-3">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="mt-0.5 text-lg font-semibold text-[#1B2A4A]">{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1.5">
              {DAYS.map((d, i) => (
                <div key={d} className={`rounded-lg border px-1 py-2 text-center ${week7[i] > 0 ? 'border-[#D9E1EF] bg-white' : 'border-gray-100 bg-gray-50'}`}>
                  <p className="text-[11px] font-medium text-gray-500">{d.slice(0, 3)}</p>
                  <p className={`mt-0.5 text-sm font-semibold ${week7[i] > 0 ? 'text-[#1B2A4A]' : 'text-gray-400'}`}>{week7[i] > 0 ? hours(week7[i]) : 'Off'}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-gray-500">
              {capacity.is_custom ? 'Your own schedule.' : 'Your Team’s or the company’s standard week.'}{' '}
              {isAdmin ? 'Change anyone’s hours, or a whole Team’s, in Admin → Working hours.' : 'Ask an admin if this is not right.'}
            </p>
          </section>
        </>)}
      </div>
    </div>
  );
};

// --- the page -----------------------------------------------------------------------------------

// Who people are, and who may do what, live in Admin (/admin). This page is only your own profile.
// Its title goes up into the top bar, as other pages' do; on a phone it stays on the page.
export const Settings: React.FC = () => {
  const topBarSlot = useTopBarSlot();
  const title = <h1 className="text-xl font-semibold text-gray-900">Settings</h1>;
  return (
    <div className="ui-clean mx-auto max-w-6xl pb-10">
      {topBarSlot ? createPortal(title, topBarSlot) : <div className="mb-6">{title}</div>}
      <ProfilePage />
    </div>
  );
};
