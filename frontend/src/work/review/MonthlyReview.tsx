// The monthly review: everyone fills it in on the firm's PMS, then marks it done here, so their
// Manager and the admins can see who has finished.
//
// A month's review opens on its 25th and is due on the 5th of the next. The card sits under the
// greeting on the Dashboard from the 25th, stays -- late, if need be -- until it is marked done,
// and then goes until the next month's opens. (In the band, in Highlights and in the sidebar were
// tried and left out on 2026-10-29.)
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check, ClipboardCheck } from 'lucide-react';
import { ask } from '../../components/ask';
import { notify } from '../../components/notify';
import { request } from '../api';
import { useWork } from '../WorkContext';

export const PMS_URL = 'https://pms.verveadvisory.com/';
/** The day of the next month a review is due by. */
const DUE_DAY = 5;

export const reviewApi = {
  /** The months open for marking, each with when it was marked done (or null). */
  mine: (ws: string) => request<{ months: Record<string, string | null> }>('GET', `/workspaces/${ws}/reviews/mine`),
  mark: (ws: string, month: string, done = true, userId?: string) =>
    request<{ month: string; completed_at: string | null }>('POST', `/workspaces/${ws}/reviews`, { month, done, user_id: userId }),
  /** Who has finished one month's review: a Manager's people, or everyone for an admin. */
  team: (ws: string, month: string) =>
    request<{ user_id: string; completed_at: string | null; marked_by: string | null }[]>('GET', `/workspaces/${ws}/reviews`, undefined, { month }),
};

/** "2026-10" for the review open now: this month from the 25th, last month before it. */
export const currentReviewMonth = (today = new Date()) => {
  const m = today.getDate() >= 25 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
};

export const reviewMonthName = (month: string) => new Date(`${month}-01T00:00`).toLocaleDateString(undefined, { month: 'long' });
const dueOf = (month: string) => { const d = new Date(`${month}-01T00:00`); return new Date(d.getFullYear(), d.getMonth() + 1, DUE_DAY); };

export const ReviewBar: React.FC = () => {
  const { workspace } = useWork();
  // The oldest open month not yet done: last month's while it is still outstanding, else this one's.
  const [pending, setPending] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!workspace) return;
    reviewApi.mine(workspace.id)
      .then(({ months }) => setPending(Object.keys(months).sort().find((m) => !months[m]) ?? null))
      .catch(() => setPending(null));
  }, [workspace]);
  useEffect(() => { load(); }, [load]);

  if (!workspace || !pending) return null;
  const name = reviewMonthName(pending);
  const due = dueOf(pending);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  const dueText = due.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const when = daysLeft < 0 ? `Was due ${dueText}` : `Due ${dueText}${daysLeft <= 7 ? ` · ${daysLeft === 0 ? 'today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}` : ''}`;

  const markDone = async () => {
    if (!await ask.confirm({ title: `Did you submit your ${name} review on the PMS?`, confirmLabel: 'Yes, mark it done' })) return;
    try {
      await reviewApi.mark(workspace.id, pending);
      notify.ok(`${name} review marked completed`);
      load();
    } catch (e) { notify.error(e); }
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold no-underline transition-colors';
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[#E4E8F0] bg-white px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2F8] text-[#234788]"><ClipboardCheck size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold text-[#142B57]">{name} review</p>
        <p className="text-[12.5px]">
          <span className={daysLeft < 0 ? 'font-semibold text-amber-700' : 'text-gray-500'}>{when}</span>
          <span className="text-gray-500"> · Fill it in on the PMS, then mark it done here.</span>
        </p>
      </div>
      <a href={PMS_URL} target="_blank" rel="noreferrer" className={`${btn} border-[#C9D3E6] bg-white text-[#234788] hover:bg-[#EEF2F8]`}>Open PMS <ArrowUpRight size={14} /></a>
      <button type="button" onClick={markDone} className={`${btn} border-[#234788] bg-[#234788] text-white hover:bg-[#1B3A72]`}><Check size={14} /> Mark as completed</button>
    </div>
  );
};
