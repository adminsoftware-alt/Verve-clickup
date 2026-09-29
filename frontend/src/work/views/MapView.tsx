// Map view, as in ClickUp: tasks placed on a map by a Location custom field. Click a pin to open its task.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import type { CustomField, Task } from '../api';

export interface Place { address: string; lat: number; lng: number }
export const isPlace = (v: unknown): v is Place =>
  !!v && typeof v === 'object' && typeof (v as Place).lat === 'number' && typeof (v as Place).lng === 'number';

export const MapView: React.FC<{ tasks: Task[]; fields: CustomField[]; onOpenTask: (id: string) => void; onAddField: () => void }> = ({ tasks, fields, onOpenTask, onAddField }) => {
  const locationFields = fields.filter((f) => f.type === 'location');
  const [fieldId, setFieldId] = useState<string>(locationFields[0]?.id ?? '');
  useEffect(() => { if (!locationFields.some((f) => f.id === fieldId)) setFieldId(locationFields[0]?.id ?? ''); }, [locationFields, fieldId]);
  const pinned = useMemo(
    () => tasks.map((t) => ({ task: t, place: t.custom_fields?.[fieldId] })).filter((x): x is { task: Task; place: Place } => isPlace(x.place)),
    [tasks, fieldId],
  );
  const unpinned = tasks.filter((t) => !t.parent_id && !pinned.some((p) => p.task.id === t.id));
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!box.current || map.current || !fieldId) return;
    map.current = L.map(box.current, { zoomControl: true }).setView([20.59, 78.96], 5); // India
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; layer.current = null; };
  }, [fieldId]);

  useEffect(() => {
    const m = map.current, group = layer.current;
    if (!m || !group) return;
    group.clearLayers();
    pinned.forEach(({ task, place }) => {
      const marker = L.circleMarker([place.lat, place.lng], { radius: 9, color: '#ffffff', weight: 2, fillColor: task.status.color, fillOpacity: 1 })
        .bindTooltip(`${task.name}${place.address ? ` — ${place.address}` : ''}`)
        .on('click', () => onOpenTask(task.id));
      marker.addTo(group);
    });
    if (pinned.length) m.fitBounds(L.latLngBounds(pinned.map((p) => [p.place.lat, p.place.lng] as [number, number])).pad(0.3), { maxZoom: 13 });
  }, [pinned, onOpenTask]);

  if (!locationFields.length) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <MapPin size={32} className="mx-auto text-gray-300" />
        <h3 className="mt-3 text-base font-semibold text-gray-800">Add a Location field to put tasks on the map</h3>
        <p className="mt-1 text-sm text-gray-500">Client offices, site visits, audits on location — give tasks a place and see them here.</p>
        <button type="button" onClick={onAddField} className="mt-4 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Add a Location field</button>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0">
      <div ref={box} className="min-h-0 flex-1" aria-label="Map" role="region" data-pins={pinned.length} />
      <aside className="w-64 shrink-0 overflow-auto border-l border-gray-100 p-3 text-sm">
        {locationFields.length > 1 && (
          <select aria-label="Location field" value={fieldId} onChange={(e) => setFieldId(e.target.value)} className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm">
            {locationFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
        <h4 className="text-xs font-semibold uppercase text-gray-400">On the map · {pinned.length}</h4>
        <ul aria-label="Pinned tasks" className="mt-1 space-y-0.5">
          {pinned.map(({ task, place }) => (
            <li key={task.id}>
              <button type="button" onClick={() => { map.current?.setView([place.lat, place.lng], 14); onOpenTask(task.id); }} className="w-full truncate rounded px-1 py-0.5 text-left hover:bg-gray-50">
                <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: task.status.color }} />{task.name}
                <span className="block truncate pl-3 text-[11px] text-gray-400">{place.address}</span>
              </button>
            </li>
          ))}
        </ul>
        {unpinned.length > 0 && (
          <>
            <h4 className="mt-3 text-xs font-semibold uppercase text-gray-400">No location · {unpinned.length}</h4>
            <ul className="mt-1 space-y-0.5">
              {unpinned.slice(0, 50).map((t) => (
                <li key={t.id}><button type="button" onClick={() => onOpenTask(t.id)} className="w-full truncate rounded px-1 py-0.5 text-left text-gray-600 hover:bg-gray-50">{t.name}</button></li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
};
