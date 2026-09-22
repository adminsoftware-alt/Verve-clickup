// Card export, as in ClickUp: the numbers behind a card as CSV, and charts as PNG images.
import type { UserRef } from '../api';
import type { Card, CardData } from './api';

type Row = Record<string, string | number>;

const person = (u: UserRef | null | undefined) => (u ? u.display_name || u.email : 'Unassigned');
const hours = (seconds: number | null | undefined) => (seconds ? Math.round((seconds / 3600) * 100) / 100 : 0);
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'card';

/** The rows behind a card, ready for a spreadsheet. Empty when the card has no data to export. */
export function cardRows(card: Card, data: CardData | undefined): Row[] {
  if (!data || data.no_access || data.error) return [];
  const d = data.data;
  const duration = d.format === 'duration';
  switch (card.type) {
    case 'calculation':
      return [{ [card.title]: duration ? hours(d.value) : d.value ?? '', ...(duration ? { Unit: 'hours' } : {}) }];
    case 'pie':
    case 'bar':
    case 'line':
      return (d.segments ?? []).map((sg: { label: string; value: number }) => ({ [card.config.group_by.replace('_', ' ')]: sg.label, [duration ? 'Hours' : 'Tasks']: duration ? hours(sg.value) : sg.value }));
    case 'task_list':
      return (d.tasks ?? []).map((t: { name: string; custom_id?: string | null; due_date: string | null; priority: number | null; assignees: UserRef[] }) => ({
        ID: t.custom_id ?? '', Task: t.name, Assignees: (t.assignees ?? []).map(person).join(', '),
        Due: t.due_date ? t.due_date.slice(0, 10) : '', Priority: t.priority ?? '',
      }));
    case 'time_report':
      return (d.rows ?? []).flatMap((r: { label: string; seconds: number; estimate_seconds?: number; children: { label: string; seconds: number }[] }) => [
        { Name: r.label, Detail: '', Hours: hours(r.seconds), ...(card.config.show_estimates ? { 'Estimate hours': hours(r.estimate_seconds) } : {}) },
        ...r.children.map((c) => ({ Name: r.label, Detail: c.label, Hours: hours(c.seconds) })),
      ]);
    case 'timesheet':
      return (d.rows ?? []).map((r: { user: UserRef; seconds_per_day: number[]; total: number }) => ({
        Person: person(r.user), ...Object.fromEntries((d.days as string[]).map((day, i) => [day, hours(r.seconds_per_day[i])])), Total: hours(r.total),
      }));
    case 'portfolio':
      return (d.rows ?? []).map((r: { path: string; name: string; total: number; open: number; done: number; overdue: number; progress: number; estimate_seconds: number; tracked_seconds: number }) => ({
        List: r.path ? `${r.path} / ${r.name}` : r.name, Tasks: r.total, Open: r.open, Done: r.done, Overdue: r.overdue,
        'Progress %': r.progress, 'Estimated hours': hours(r.estimate_seconds), 'Tracked hours': hours(r.tracked_seconds),
      }));
    case 'behind':
      return (d.rows ?? []).map((r: { user: UserRef | null; overdue: number; oldest_days: number }) => ({ Person: person(r.user), Overdue: r.overdue, 'Oldest (days late)': r.oldest_days }));
    case 'completed':
      return (d.rows ?? []).map((r: { user: UserRef | null; done: number; late: number }) => ({ Person: person(r.user), Done: r.done, 'Done late': r.late }));
    default:
      return [];
  }
}

const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function exportCardCsv(card: Card, rows: Row[]) {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c] ?? '')).join(','))];
  // The BOM lets Excel read names with accents correctly.
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${safeName(card.title)}.csv`);
}

/** The chart drawn inside a card, or null for cards that aren't charts. */
export const chartIn = (cardEl: Element | null) => cardEl?.querySelector<SVGSVGElement>('svg.recharts-surface') ?? null;

export async function exportCardPng(card: Card, svg: SVGSVGElement) {
  const { width, height } = svg.getBoundingClientRect();
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(width));
  copy.setAttribute('height', String(height));
  copy.style.fontFamily = getComputedStyle(svg).fontFamily;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Could not draw the chart')); img.src = url; });
    const scale = 2; // sharp on high-density screens and in slides
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) download(blob, `${safeName(card.title)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
