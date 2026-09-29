// The strip above a sprint List: progress in points, a burndown chart, velocity, and "Complete sprint".
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Flag, TrendingDown } from 'lucide-react';
import { spacesApi, type SprintReport } from '../spacesApi';
import { ask } from '../../components/ask';

export const SprintBar: React.FC<{ listId: string; canManage: boolean; refreshKey: number; onChanged: () => void }> = ({ listId, canManage, refreshKey, onChanged }) => {
  const [report, setReport] = useState<SprintReport | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const load = useCallback(() => { spacesApi.sprintReport(listId).then(setReport).catch(() => setReport(null)); }, [listId]);
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!report) return null;
  const s = report.sprint;
  const unit = report.unit === 'points' ? 'pts' : 'tasks';
  const done = report.unit === 'points' ? s.done_points : s.done_count;
  const total = report.unit === 'points' ? s.total_points : s.task_count;
  const complete = async () => {
    if (!(await ask.confirm(`Complete ${s.name}? Unfinished tasks move to the next sprint.`))) return;
    try {
      const out = await spacesApi.completeSprint(listId);
      setMessage(`${out.moved} unfinished task${out.moved === 1 ? '' : 's'} moved to the next sprint.`);
      onChanged();
      load();
      if (out.next_list_id && out.moved) navigate(`/l/${out.next_list_id}`);
    } catch (e) { setMessage((e as Error).message); }
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '…');
  return (
    <div className="border-b border-gray-100 bg-brand-50/40 px-6 py-2" aria-label="Sprint">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-brand-900"><Flag size={14} /> {s.completed_at ? 'Completed sprint' : s.current ? 'Current sprint' : 'Sprint'}</span>
        <span className="text-gray-600">{fmt(s.start_date)} → {fmt(s.due_date)}</span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-40 overflow-hidden rounded-full bg-white">
            <span className="block h-full bg-brand-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
          </span>
          <span className="text-xs text-gray-600" role="status">{done} of {total} {unit} done</span>
        </span>
        {report.average_velocity > 0 && <span className="text-xs text-gray-500">Velocity {report.average_velocity} pts/sprint</span>}
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 rounded border border-brand-200 bg-white px-2 py-0.5 text-xs text-brand-700 hover:bg-brand-50">
          <TrendingDown size={12} /> Burndown
        </button>
        {canManage && !s.completed_at && (
          <button type="button" onClick={complete} className="ml-auto rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">Complete sprint</button>
        )}
      </div>
      {message && <p className="mt-1 text-xs text-brand-800">{message}</p>}
      {open && (
        <div className="mt-2 h-56 rounded-lg bg-white p-2" aria-label="Burndown chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={report.burndown.map((d) => ({ ...d, label: new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2ff" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line type="linear" dataKey="ideal" name="Ideal" stroke="#a5b4fc" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              <Line type="stepAfter" dataKey="remaining" name={`Remaining (${unit})`} stroke="#4f46e5" strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
