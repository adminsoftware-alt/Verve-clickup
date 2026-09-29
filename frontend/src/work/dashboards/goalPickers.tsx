// Pickers for the Goals and Sprint cards.
import React, { useEffect, useMemo, useState } from 'react';
import { useWork } from '../WorkContext';
import type { FolderNode } from '../api';
import { goalsApi, type Goal } from '../goals/goalsApi';

export const GoalPicker: React.FC<{ value: string[]; onChange: (v: string[]) => void }> = ({ value, onChange }) => {
  const { workspace } = useWork();
  const [goals, setGoals] = useState<Goal[]>([]);
  useEffect(() => { if (workspace) goalsApi.list(workspace.id).then(setGoals).catch(() => undefined); }, [workspace]);
  if (!goals.length) return <p className="text-sm text-gray-500">No goals yet — create them on the Goals page.</p>;
  return (
    <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-gray-200 p-2" aria-label="Goals to show">
      {goals.map((g) => (
        <li key={g.id}>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={value.includes(g.id)} onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))} />
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: g.color }} /> {g.name}
            {g.team && <span className="text-xs text-gray-400">· {g.team.name}</span>}
          </label>
        </li>
      ))}
    </ul>
  );
};

export const SprintFolderPicker: React.FC<{ value: string | null; onChange: (v: string | null) => void }> = ({ value, onChange }) => {
  const { hierarchy } = useWork();
  const folders = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const walk = (f: FolderNode, path: string) => {
      if (f.is_sprint) out.push({ id: f.id, label: `${path} / ${f.name}` });
      f.folders.forEach((x) => walk(x, `${path} / ${f.name}`));
    };
    hierarchy?.spaces.forEach((sp) => sp.folders.forEach((f) => walk(f, sp.name)));
    return out;
  }, [hierarchy]);
  if (!folders.length) return <p className="text-sm text-gray-500">No Sprint Folders yet — use “Make it a Sprint Folder” on a Folder.</p>;
  return (
    <select aria-label="Sprint Folder" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
      <option value="">Choose…</option>
      {folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select>
  );
};
