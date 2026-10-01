import React, { useEffect, useState, useRef } from 'react';
import { taskService, type Task, SAMPLE_TEAM_MEMBERS } from '../services/taskService';
import { timeService, type TimeEntry } from '../services/timeService';
import { TaskForm } from '../components/TaskForm';
import { TaskChecklist } from '../components/task/TaskChecklist';
import { TaskAttachments } from '../components/task/TaskAttachments';
import { Tag as TagIcon, GripVertical, Search, CheckCircle2, Circle, Clock, Calendar as CalendarIcon, X, Plus, Trash2, Check, Play, Pause, XCircle, Target } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { CustomSelect } from '../components/CustomSelect';
import { formatHoursCompact, parseEstimatedTime, formatHours } from '../lib/utils';
import { RichTextEditor } from '../components/RichTextEditor';
import { KanbanBoard } from '../components/KanbanBoard';
import { ask } from '../components/ask';

interface SortableRowProps {
  task: Task;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onLogTime: (id: string) => void;
  onDelete: (id: string) => void;
  onViewDetails: (task: Task) => void;
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
  onTimeLogged: () => void;
  isOverdue: boolean;
  onStartFocus: (task: Task) => void;
  onToggleStar: (id: string) => void;
}

const SortableRow: React.FC<SortableRowProps> = ({ task, isSelected, onToggleSelect, onLogTime, onDelete, onViewDetails, onStatusChange, onTimeLogged, isOverdue, onStartFocus, onToggleStar }) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  
  const { timers, startTimer, pauseTimer, stopTimer, cancelTimer, getLiveElapsedSeconds } = useTimer();
  const taskTimer = timers[task.id];
  const isRunning = taskTimer && taskTimer.startTime !== null;
  const isPaused = taskTimer && taskTimer.startTime === null;
  const elapsed = getLiveElapsedSeconds(task.id);

  const formatTimerDisplay = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    }
    if (m > 0) {
      return `${m}m ${s}s`;
    }
    return `${s}s`;
  };
  
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    backgroundColor: isSelected ? '#F3F4F6' : 'white',
    borderBottom: '1px solid #F3F4F6'
  };

  const actualHours = task.actualHours || 0;
  const progress = task.estimatedHours > 0 ? Math.min(Math.round((actualHours / task.estimatedHours) * 100), 100) : 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Todo': return { bg: '#F3F4F6', text: '#374151' };
      case 'In Progress': return { bg: '#DBEAFE', text: '#2563EB' };
      case 'Review': return { bg: '#FEF3C7', text: '#D97706' };
      case 'Completed': return { bg: '#D1FAE5', text: '#059669' };
      case 'Blocked': return { bg: '#FEE2E2', text: '#DC2626' };
      default: return { bg: '#F3F4F6', text: '#374151' };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Low': return { bg: '#D1FAE5', text: '#059669' };
      case 'Medium': return { bg: '#FEF3C7', text: '#D97706' };
      case 'High': return { bg: '#FEE2E2', text: '#DC2626' };
      case 'Critical': return { bg: '#FECACA', text: '#991B1B' };
      default: return { bg: '#F3F4F6', text: '#374151' };
    }
  };

  const statusColors = getStatusColor(task.status);
  const prioColors = getPriorityColor(task.priority);
  const progColor = task.status === 'Completed' ? '#059669' : (task.status === 'In Progress' ? '#2563EB' : '#D1D5DB');

  return (
    <tr ref={setNodeRef} style={style} {...attributes}>
      <td style={{ padding: '8px 0', borderLeft: isSelected ? '2px solid #4F46E5' : '2px solid transparent' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <div {...listeners} style={{ marginTop: '2px', cursor: 'grab', color: '#9CA3AF', padding: '2px', touchAction: 'none' }} className="drag-handle">
            <GripVertical size={14} />
          </div>
          <input 
            type="checkbox" 
            checked={isSelected}
            onChange={() => onToggleSelect(task.id)}
            onClick={e => e.stopPropagation()}
            style={{ marginTop: '2px', cursor: 'pointer' }}
          />
          <div onClick={() => onViewDetails(task)} style={{ cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.8125rem', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {task.title}
            </div>
            {task.description && <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{task.description.replace(/<[^>]*>?/gm, '')}</div>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(task.id); }}
            title={task.isStarred ? 'Remove from starred' : 'Add to starred'}
            style={{ background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer', lineHeight: 1, flexShrink: 0, color: task.isStarred ? '#F59E0B' : '#C4C9D4', fontSize: '14px', transition: 'color 0.15s', marginTop: '1px' }}
          >{task.isStarred ? '★' : '☆'}</button>
        </div>
      </td>
      <td style={{ padding: '8px 0' }}>
        <span style={{ backgroundColor: prioColors.bg, color: prioColors.text, padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          {task.priority}
        </span>
      </td>
      <td style={{ padding: '8px 0' }}>
        <div onClick={(e) => e.stopPropagation()}>
          <CustomSelect
            value={task.status}
            onChange={(val: string) => onStatusChange(task.id, val)}
            options={[
              { value: 'Todo', label: 'Todo', color: '#6B7280' },
              { value: 'In Progress', label: 'In Progress', color: '#2563EB' },
              { value: 'Review', label: 'Review', color: '#D97706' },
              { value: 'Completed', label: 'Completed', color: '#059669' },
              { value: 'Blocked', label: 'Blocked', color: '#DC2626' }
            ]}
            buttonStyle={{
              backgroundColor: statusColors.bg,
              color: statusColors.text,
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              border: '1px solid transparent',
              width: 'auto',
              minWidth: 'unset',
              whiteSpace: 'nowrap'
            }}
          />
        </div>
      </td>
      <td style={{ padding: '8px 0' }}>
        {/* Stacked overlapping assignee circles */}
        {(() => {
          const MAX_SHOW = 3;
          const assigneeIds: string[] = (task.assignees && task.assignees.length > 0)
            ? task.assignees
            : task.assignedUserId ? [task.assignedUserId] : [];
          if (assigneeIds.length === 0) {
            return (
              <div title="Unassigned" style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid #E5E7EB' }}>?</div>
            );
          }
          const visible = assigneeIds.slice(0, MAX_SHOW);
          const extra = assigneeIds.length - MAX_SHOW;
          
          let extraNames = "";
          if (extra > 0) {
            extraNames = assigneeIds.slice(MAX_SHOW).map(aid => {
              const m = SAMPLE_TEAM_MEMBERS.find(mem => mem.id === aid);
              return m ? m.name : aid;
            }).join(', ');
          }

          return (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {visible.map((aid, i) => {
                const m = SAMPLE_TEAM_MEMBERS.find(m => m.id === aid) || { initials: aid.substring(0,2).toUpperCase(), color: '#6B7280', name: aid };
                return (
                  <div key={aid} title={m.name} style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: m.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, border: '2px solid white', marginLeft: i === 0 ? '0' : '-14px', zIndex: MAX_SHOW - i, position: 'relative', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', flexShrink: 0 }}>{m.initials}</div>
                );
              })}
              {extra > 0 && (
                <div title={`+${extra} more: ${extraNames}`} style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid white', marginLeft: '-14px', zIndex: 0, position: 'relative', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>+{extra}</div>
              )}
            </div>
          );
        })()}
      </td>
      <td style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, height: '4px', backgroundColor: '#F3F4F6', borderRadius: '2px', minWidth: '40px' }}>
            <div style={{ width: `${progress}%`, height: '100%', backgroundColor: progColor, borderRadius: '2px' }}></div>
          </div>
          <span style={{ fontSize: '0.7rem', color: '#6B7280', minWidth: '24px' }}>{progress}%</span>
        </div>
      </td>
      <td style={{ padding: '8px 0', color: isOverdue ? '#DC2626' : '#4B5563', fontSize: '0.8125rem' }}>
        {task.dueDate}
      </td>
      <td style={{ padding: '8px 0', color: '#6B7280', fontSize: '0.8125rem' }}>
        {task.startDate || '—'}
      </td>
      <td style={{ padding: '8px 0' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start' }}>
          {/* Active / Paused Ticker */}
          {(isRunning || isPaused) && (
            <span style={{ 
              fontSize: '0.65rem', 
              fontFamily: 'monospace', 
              fontWeight: 700, 
              color: isRunning ? '#DC2626' : '#4B5563',
              backgroundColor: isRunning ? '#FEF2F2' : '#F3F4F6',
              padding: '2px 6px',
              borderRadius: '4px',
              border: isRunning ? '1px solid #FECACA' : '1px solid #E5E7EB',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {isRunning && <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#DC2626', animation: 'pulse 1.5s infinite' }}></span>}
              {formatTimerDisplay(elapsed)}
            </span>
          )}

          {/* Timer controls */}
          {!taskTimer && (
            <button 
              onClick={() => startTimer(task.id, task.title)} 
              title="Start Timer" 
              className="premium-icon-btn"
            >
              <Play size={12} color="#4F46E5" />
            </button>
          )}

          {isRunning && (
            <button 
              onClick={() => pauseTimer(task.id)} 
              title="Pause Timer" 
              className="premium-icon-btn"
            >
              <Pause size={12} color="#D97706" />
            </button>
          )}

          {isPaused && (
            <button 
              onClick={() => startTimer(task.id, task.title)} 
              title="Resume Timer" 
              className="premium-icon-btn"
            >
              <Play size={12} color="#10B981" />
            </button>
          )}

          {(isRunning || isPaused) && (
            <>
              <button 
                onClick={async () => {
                  await stopTimer(task.id);
                  onTimeLogged();
                }} 
                title="Save & Log Time" 
                className="premium-icon-btn"
              >
                <CheckCircle2 size={12} color="#10B981" />
              </button>
              <button 
                onClick={() => cancelTimer(task.id)} 
                title="Cancel Timer" 
                className="premium-icon-btn"
              >
                <XCircle size={12} color="#EF4444" />
              </button>
            </>
          )}

          {/* Log Manual Time */}
          <button 
            onClick={() => onLogTime(task.id)} 
            title="Log Time Manually" 
            className="premium-icon-btn"
          >
            <Plus size={12} color="#4B5563" />
          </button>

          {/* Target Focus */}
          <button 
            onClick={() => onStartFocus(task)} 
            title="Start Focus Sprint" 
            className="premium-icon-btn"
          >
            <Target size={12} color="#DC2626" />
          </button>

          {/* Delete Task */}
          <button 
            onClick={() => onDelete(task.id)} 
            title="Delete Task" 
            className="premium-icon-btn"
          >
            <Trash2 size={12} color="#EF4444" />
          </button>
        </div>
      </td>
    </tr>
  );
};

const StaticRow: React.FC<SortableRowProps> = ({ task, isSelected, onToggleSelect, onLogTime, onDelete, onViewDetails, onStatusChange, onTimeLogged, isOverdue, onStartFocus, onToggleStar }) => {
  const { timers, startTimer, pauseTimer, stopTimer, cancelTimer, getLiveElapsedSeconds } = useTimer();
  const taskTimer = timers[task.id];
  const isRunning = taskTimer && taskTimer.startTime !== null;
  const isPaused = taskTimer && taskTimer.startTime === null;
  const elapsed = getLiveElapsedSeconds(task.id);

  const formatTimerDisplay = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  
  const style = {
    backgroundColor: isSelected ? '#F3F4F6' : 'white',
    borderBottom: '1px solid #F3F4F6'
  };

  const actualHours = task.actualHours || 0;
  const progress = task.estimatedHours > 0 ? Math.min(Math.round((actualHours / task.estimatedHours) * 100), 100) : 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Todo': return { bg: '#F3F4F6', text: '#374151' };
      case 'In Progress': return { bg: '#DBEAFE', text: '#2563EB' };
      case 'Review': return { bg: '#FEF3C7', text: '#D97706' };
      case 'Completed': return { bg: '#D1FAE5', text: '#059669' };
      case 'Blocked': return { bg: '#FEE2E2', text: '#DC2626' };
      default: return { bg: '#F3F4F6', text: '#374151' };
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'Low': return { bg: '#D1FAE5', text: '#059669' };
      case 'Medium': return { bg: '#FEF3C7', text: '#D97706' };
      case 'High': return { bg: '#FEE2E2', text: '#DC2626' };
      case 'Critical': return { bg: '#FECACA', text: '#991B1B' };
      default: return { bg: '#F3F4F6', text: '#374151' };
    }
  };

  const statusColors = getStatusColor(task.status);
  const prioColors = getPriorityColor(task.priority);
  const progColor = task.status === 'Completed' ? '#059669' : (task.status === 'In Progress' ? '#2563EB' : '#D1D5DB');

  return (
    <tr style={style}>
      <td style={{ padding: '8px 0', width: '25%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ width: '14px', marginTop: '2px' }}></div>
          <input 
            type="checkbox" 
            checked={isSelected}
            onChange={() => onToggleSelect(task.id)}
            onClick={e => e.stopPropagation()}
            style={{ marginTop: '2px', cursor: 'pointer' }}
          />
          <div onClick={() => onViewDetails(task)} style={{ cursor: 'pointer' }}>
            <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.8125rem', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {task.title}
            </div>
            {task.description && <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{task.description.replace(/<[^>]*>?/gm, '')}</div>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(task.id); }}
            title={task.isStarred ? 'Remove from starred' : 'Add to starred'}
            style={{ background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer', lineHeight: 1, flexShrink: 0, color: task.isStarred ? '#F59E0B' : '#C4C9D4', fontSize: '14px', transition: 'color 0.15s', marginTop: '1px' }}
          >{task.isStarred ? '★' : '☆'}</button>
        </div>
      </td>
      <td style={{ padding: '8px 0' }}>
        <span style={{ backgroundColor: prioColors.bg, color: prioColors.text, padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
          {task.priority}
        </span>
      </td>
      <td style={{ padding: '8px 0' }}>
        <div onClick={(e) => e.stopPropagation()}>
          <CustomSelect
            value={task.status}
            onChange={(val: string) => onStatusChange(task.id, val)}
            options={[
              { value: 'Todo', label: 'Todo', color: '#6B7280' },
              { value: 'In Progress', label: 'In Progress', color: '#2563EB' },
              { value: 'Review', label: 'Review', color: '#D97706' },
              { value: 'Completed', label: 'Completed', color: '#059669' },
              { value: 'Blocked', label: 'Blocked', color: '#DC2626' }
            ]}
            buttonStyle={{
              backgroundColor: statusColors.bg,
              color: statusColors.text,
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              border: '1px solid transparent',
              minWidth: '105px'
            }}
          />
        </div>
      </td>
      <td style={{ padding: '8px 0' }}>
        {/* Stacked overlapping assignee circles */}
        {(() => {
          const MAX_SHOW = 3;
          const assigneeIds: string[] = (task.assignees && task.assignees.length > 0)
            ? task.assignees
            : task.assignedUserId ? [task.assignedUserId] : [];
          if (assigneeIds.length === 0) {
            return (
              <div title="Unassigned" style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid #E5E7EB' }}>?</div>
            );
          }
          const visible = assigneeIds.slice(0, MAX_SHOW);
          const extra = assigneeIds.length - MAX_SHOW;
          
          let extraNames = "";
          if (extra > 0) {
            extraNames = assigneeIds.slice(MAX_SHOW).map(aid => {
              const m = SAMPLE_TEAM_MEMBERS.find(mem => mem.id === aid);
              return m ? m.name : aid;
            }).join(', ');
          }

          return (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {visible.map((aid, i) => {
                const m = SAMPLE_TEAM_MEMBERS.find(m => m.id === aid) || { initials: aid.substring(0,2).toUpperCase(), color: '#6B7280', name: aid };
                return (
                  <div key={aid} title={m.name} style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: m.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, border: '2px solid white', marginLeft: i === 0 ? '0' : '-14px', zIndex: MAX_SHOW - i, position: 'relative', boxShadow: '0 1px 3px rgba(0,0,0,0.15)', flexShrink: 0 }}>{m.initials}</div>
                );
              })}
              {extra > 0 && (
                <div title={`+${extra} more: ${extraNames}`} style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#F3F4F6', color: '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid white', marginLeft: '-14px', zIndex: 0, position: 'relative', flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>+{extra}</div>
              )}
            </div>
          );
        })()}
      </td>
      <td style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ flex: 1, height: '4px', backgroundColor: '#F3F4F6', borderRadius: '2px', minWidth: '40px' }}>
            <div style={{ width: `${progress}%`, height: '100%', backgroundColor: progColor, borderRadius: '2px' }}></div>
          </div>
          <span style={{ fontSize: '0.7rem', color: '#6B7280', minWidth: '24px' }}>{progress}%</span>
        </div>
      </td>
      <td style={{ padding: '8px 0', color: isOverdue ? '#DC2626' : '#4B5563', fontSize: '0.8125rem' }}>
        {task.dueDate}
      </td>
      <td style={{ padding: '8px 0', color: '#6B7280', fontSize: '0.8125rem' }}>
        {task.startDate || '—'}
      </td>
      <td style={{ padding: '8px 0' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-start' }}>
          {/* Active / Paused Ticker */}
          {(isRunning || isPaused) && (
            <span style={{ 
              fontSize: '0.65rem', 
              fontFamily: 'monospace', 
              fontWeight: 700, 
              color: isRunning ? '#DC2626' : '#4B5563',
              backgroundColor: isRunning ? '#FEF2F2' : '#F3F4F6',
              padding: '2px 6px',
              borderRadius: '4px',
              border: isRunning ? '1px solid #FECACA' : '1px solid #E5E7EB',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}>
              {isRunning && <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#DC2626', animation: 'pulse 1.5s infinite' }}></span>}
              {formatTimerDisplay(elapsed)}
            </span>
          )}

          {/* Timer controls */}
          {!taskTimer && (
            <button 
              onClick={() => startTimer(task.id, task.title)} 
              title="Start Timer" 
              className="premium-icon-btn"
            >
              <Play size={12} color="#4F46E5" />
            </button>
          )}

          {isRunning && (
            <button 
              onClick={() => pauseTimer(task.id)} 
              title="Pause Timer" 
              className="premium-icon-btn"
            >
              <Pause size={12} color="#D97706" />
            </button>
          )}

          {isPaused && (
            <button 
              onClick={() => startTimer(task.id, task.title)} 
              title="Resume Timer" 
              className="premium-icon-btn"
            >
              <Play size={12} color="#10B981" />
            </button>
          )}

          {(isRunning || isPaused) && (
            <>
              <button 
                onClick={async () => {
                  await stopTimer(task.id);
                  onTimeLogged();
                }} 
                title="Save & Log Time" 
                className="premium-icon-btn"
              >
                <CheckCircle2 size={12} color="#10B981" />
              </button>
              <button 
                onClick={() => cancelTimer(task.id)} 
                title="Cancel Timer" 
                className="premium-icon-btn"
              >
                <XCircle size={12} color="#EF4444" />
              </button>
            </>
          )}

          {/* Log Manual Time */}
          <button 
            onClick={() => onLogTime(task.id)} 
            title="Log Time Manually" 
            className="premium-icon-btn"
          >
            <Plus size={12} color="#4B5563" />
          </button>

          {/* Target Focus */}
          <button 
            onClick={() => onStartFocus(task)} 
            title="Start Focus Sprint" 
            className="premium-icon-btn"
          >
            <Target size={12} color="#DC2626" />
          </button>

          {/* Delete Task */}
          <button 
            onClick={() => onDelete(task.id)} 
            title="Delete Task" 
            className="premium-icon-btn"
          >
            <Trash2 size={12} color="#EF4444" />
          </button>
        </div>
      </td>
    </tr>
  );
};

const Pagination = ({ currentPage, totalItems, pageSize, onPageChange }: any) => {
  const totalPages = Math.ceil(totalItems / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '12px 24px', borderTop: '1px solid var(--color-border)', backgroundColor: '#F9FAFB' }}>
      <button onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #E5E7EB', backgroundColor: currentPage === 1 ? '#F3F4F6' : '#FFFFFF', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
      <span style={{ fontSize: '0.875rem', color: '#6B7280' }}>Page {currentPage} of {totalPages}</span>
      <button onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #E5E7EB', backgroundColor: currentPage === totalPages ? '#F3F4F6' : '#FFFFFF', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
    </div>
  );
};

// ─── Premium Filter Dropdown ──────────────────────────────────────────────────
const DateFilterSelect = ({ value, onChange, options, label, accentColor = '#4F46E5', accentBg = '#EEF2FF' }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  accentColor?: string;
  accentBg?: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);
  const isActive = value !== options[0]?.value;

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '6px 11px', borderRadius: '6px',
          border: `1px solid ${isActive ? accentColor + '55' : '#E5E7EB'}`,
          backgroundColor: isActive ? accentBg : '#FFFFFF',
          color: isActive ? accentColor : '#374151',
          fontSize: '0.8125rem', fontWeight: isActive ? 600 : 500,
          cursor: 'pointer', whiteSpace: 'nowrap',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          transition: 'all 0.15s'
        }}
      >
        {label && <span style={{ color: '#9CA3AF', fontWeight: 400, marginRight: '1px' }}>{label}</span>}
        {selected?.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: '2px', flexShrink: 0, opacity: 0.5, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 9999,
          backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB',
          borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          minWidth: '140px', padding: '4px', overflow: 'hidden'
        }}>
          {options.map(opt => {
            const isSel = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '7px 10px', borderRadius: '5px', border: 'none',
                  backgroundColor: isSel ? accentBg : 'transparent',
                  color: isSel ? accentColor : '#374151',
                  fontSize: '0.8125rem', fontWeight: isSel ? 600 : 400,
                  cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
                  transition: 'background-color 0.1s'
                }}
                onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'; }}
                onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                {opt.label}
                {isSel && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: '8px', flexShrink: 0 }}>
                    <path d="M2 6L5 9L10 3" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────

// ─── Premium Multi-Assignee Select for Quick Add ──────────────────────────────
const QuickAddAssigneeSelect = ({ selectedIds, onChange, options }: {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  options: { id: string; name: string; initials: string; color: string }[];
}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, []);

  const toggleSelection = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(v => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedMembers = selectedIds.map(id => options.find(o => o.id === id)).filter(Boolean);

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '4px 10px', borderRadius: '6px',
          border: '1px dashed #D1D5DB', backgroundColor: '#F9FAFB',
          cursor: 'pointer', minHeight: '30px', minWidth: '120px'
        }}
      >
        {selectedIds.length === 0 ? (
          <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>Assignees...</span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {selectedMembers.slice(0, 3).map((m, i) => (
              <div key={m?.id} style={{
                width: '22px', height: '22px', borderRadius: '50%',
                backgroundColor: m?.color || '#9CA3AF', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.65rem', fontWeight: 600, border: '2px solid white',
                marginLeft: i > 0 ? '-8px' : 0, zIndex: 10 - i
              }}>
                {m?.initials}
              </div>
            ))}
            {selectedIds.length > 3 && (
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%',
                backgroundColor: '#F3F4F6', color: '#4B5563',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.65rem', fontWeight: 600, border: '2px solid white',
                marginLeft: '-8px', zIndex: 0
              }}>
                +{selectedIds.length - 3}
              </div>
            )}
          </div>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 5px)', left: 0, zIndex: 9999,
          backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB',
          borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
          minWidth: '200px', padding: '6px', maxHeight: '250px', overflowY: 'auto'
        }}>
          {options.map(opt => {
            const isSelected = selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleSelection(opt.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '6px 8px', borderRadius: '5px', border: 'none',
                  backgroundColor: isSelected ? '#EEF2FF' : 'transparent',
                  cursor: 'pointer', textAlign: 'left', transition: 'background-color 0.1s'
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    backgroundColor: opt.color, color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6rem', fontWeight: 600
                  }}>
                    {opt.initials}
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: isSelected ? '#4F46E5' : '#374151', fontWeight: isSelected ? 600 : 400 }}>
                    {opt.name}
                  </span>
                </div>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="#4F46E5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Tasks: React.FC = () => {
  const { focusSession, startFocus, pauseFocus, stopFocus, resetFocus } = useTimer();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [activePage, setActivePage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const pageSize = 20;         // active tasks
  const sectionPageSize = 5;   // overdue & completed
  const [showForm, setShowForm] = useState(false);
  const [activeDetailsTask, setActiveDetailsTask] = useState<Task | null>(null);
  
  // State for the editable modal to allow typing without instant API calls blocking
  const [modalDraft, setModalDraft] = useState<Task | null>(null);

  const [showStarredOnly, setShowStarredOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');

  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ 
    message: string; 
    onConfirm: () => void; 
    confirmText?: string;
    cancelText?: string;
  } | null>(null);
  const [logTimeTaskId, setLogTimeTaskId] = useState<string | null>(null);
  const [manualTimeInput, setManualTimeInput] = useState('');
  const [logTimeNotes, setLogTimeNotes] = useState('');
  const [logTimeTags, setLogTimeTags] = useState('');
  
  // Calculate local time for input default
  const getLocalDatetimeLocal = () => {
    const tzOffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    return localISOTime;
  };
  const [logTimeStartDate, setLogTimeStartDate] = useState(getLocalDatetimeLocal());
  const [logTimeEndDate, setLogTimeEndDate] = useState(getLocalDatetimeLocal());
  const [pastTimeEntries, setPastTimeEntries] = useState<TimeEntry[]>([]);


  useEffect(() => {
    setManualTimeInput('');
    setLogTimeNotes('');
    setLogTimeTags('');
    setLogTimeStartDate(getLocalDatetimeLocal());
    setLogTimeEndDate(getLocalDatetimeLocal());
    if (logTimeTaskId) {
      timeService.getTimeEntries(logTimeTaskId).then(setPastTimeEntries).catch(console.error);
    } else {
      setPastTimeEntries([]);
    }
  }, [logTimeTaskId]);

  const handleDeleteTimeEntry = async (entryId: string) => {
    if (await ask.confirm("Are you sure you want to delete this time entry?")) {
      try {
        await timeService.deleteTimeEntry(entryId);
        setPastTimeEntries(prev => prev.filter(e => e.id !== entryId));
        showToast("Time entry deleted", "success");
        fetchTasks();
      } catch (e: any) {
        showToast(e.message || "Failed to delete entry", "error");
      }
    }
  };


  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('new') === 'true') {
      setShowForm(true);
      // Clean up the URL so refreshing doesn't keep opening it
      navigate('/tasks', { replace: true });
    }
    
    const urlTaskId = params.get('taskId');
    if (urlTaskId && tasks.length > 0 && !activeDetailsTask) {
      const taskToOpen = tasks.find(t => t.id === urlTaskId);
      if (taskToOpen) {
        setActiveDetailsTask(taskToOpen);
        // Clean up the URL
        navigate('/tasks', { replace: true });
      }
    }
    const isStarred = params.get('starred') === 'true';
    if (isStarred) {
      setShowStarredOnly(true);
      navigate('/tasks', { replace: true });
    }
  }, [location.search, navigate, tasks, activeDetailsTask]);

  const [modalEstTimeInput, setModalEstTimeInput] = useState('');

  useEffect(() => {
    if (activeDetailsTask) {
      setModalDraft(activeDetailsTask);
      setModalEstTimeInput(activeDetailsTask.estimatedHours ? formatHours(activeDetailsTask.estimatedHours) : '');
    } else {
      setModalDraft(null);
      setModalEstTimeInput('');
    }
  }, [activeDetailsTask]);

  const handleModalEstTimeChange = (value: string) => {
    setModalEstTimeInput(value);
    const { hours } = parseEstimatedTime(value);
    if (modalDraft) {
      setModalDraft({ ...modalDraft, estimatedHours: hours });
    }
  };

  const handleModalEstTimeBlur = () => {
    const { hours } = parseEstimatedTime(modalEstTimeInput);
    setModalEstTimeInput(hours > 0 ? formatHours(hours) : '');
    handleModalSave('estimatedHours', hours);
  };

  const handleManualTimeChange = (value: string) => {
    setManualTimeInput(value);
  };

  const handleManualTimeBlur = () => {
    const { hours } = parseEstimatedTime(manualTimeInput);
    setManualTimeInput(hours > 0 ? formatHours(hours) : '');
    if (hours > 0 && logTimeStartDate) {
      const start = new Date(logTimeStartDate);
      const end = new Date(start.getTime() + hours * 3600000);
      const tzOffset = end.getTimezoneOffset() * 60000;
      const localEnd = (new Date(end.getTime() - tzOffset)).toISOString().slice(0, 16);
      setLogTimeEndDate(localEnd);
    }
  };
  
  const handleDateBoundsChange = (startStr: string, endStr: string) => {
    setLogTimeStartDate(startStr);
    setLogTimeEndDate(endStr);
    if (startStr && endStr) {
      const start = new Date(startStr);
      const end = new Date(endStr);
      const diffMs = end.getTime() - start.getTime();
      if (diffMs > 0) {
        const hours = diffMs / 3600000;
        setManualTimeInput(hours.toFixed(2) + 'h');
      } else {
        setManualTimeInput('');
      }
    }
  };

  const handleModalSave = async (field: keyof Task, value: any) => {
    if (!modalDraft) return;

    if (field === 'status' && value === 'Completed') {
      const actualHours = modalDraft.actualHours || 0;
      if (actualHours <= 0) {
        showToast("Cannot mark task as Completed without logging hours first!", 'error');
        // Revert status state in modalDraft
        setModalDraft(prev => prev ? { ...prev, status: activeDetailsTask?.status || 'Todo' } : null);
        return;
      }
    }

    const updated = { ...modalDraft, [field]: value };
    setModalDraft(updated);
    
    // Auto-save to backend
    try {
      const savedTask = await taskService.updateTask(updated.id, updated as any);
      setTasks(prev => prev.map(t => t.id === savedTask.id ? savedTask : t));
      // Update the underlying task so it stays in sync
      setActiveDetailsTask(savedTask);
    } catch(e: any) {
      showToast(e.message || "Auto-save failed", 'error');
      // Revert modalDraft
      setModalDraft(activeDetailsTask);
    }
  };

  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [inlineTaskTitle, setInlineTaskTitle] = useState('');
  const [inlinePriority, setInlinePriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [inlineEstTime, setInlineEstTime] = useState('');
  const [inlineDueDate, setInlineDueDate] = useState('');
  const [inlineAssignees, setInlineAssignees] = useState<string[]>([]);
  const inlineDateRef = useRef<HTMLInputElement>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  
  const [dateFilter, setDateFilter] = useState('All');
  const [overdueDateFilter, setOverdueDateFilter] = useState('All');
  const [completedDateFilter, setCompletedDateFilter] = useState('All');
  const [statsTimeFilter, setStatsTimeFilter] = useState('All');
  const showArchived = false;

  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [customDateTarget, setCustomDateTarget] = useState<'main' | 'overdue' | 'completed' | null>(null);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      let data = await taskService.getTasks();
      // Optional Auto-Archiving Logic for tasks completed > 14 days ago
      const now = Date.now();
      const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;
      let needsSave = false;
      
      data = data.map(t => {
        if (t.status === 'Completed' && t.completedDate && !t.isArchived) {
          const compDate = new Date(t.completedDate).getTime();
          if (now - compDate > FOURTEEN_DAYS) {
            needsSave = true;
            return { ...t, isArchived: true };
          }
        }
        return t;
      });

      if (needsSave) {
         // Optionally save auto-archived tasks to backend in background
         data.forEach(t => {
           if (t.isArchived) taskService.updateTask(t.id, { isArchived: true });
         });
      }

      data.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setTasks(data);
    } catch (err: any) {
      console.error('Failed to load tasks', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const handleTimeEntryAdded = () => {
      fetchTasks();
    };
    window.addEventListener('timeEntryAdded', handleTimeEntryAdded);
    return () => {
      window.removeEventListener('timeEntryAdded', handleTimeEntryAdded);
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (active.id !== over?.id) {
      const oldIndex = tasks.findIndex(t => t.id === active.id);
      const newIndex = tasks.findIndex(t => t.id === over?.id);
      
      const newTasks = arrayMove(tasks, oldIndex, newIndex);
      setTasks(newTasks);
      
      // Update orders in backend (simple implementation: just update the moved task)
      // For a robust system, you'd batch update, but we'll do a basic update for now
      try {
        const taskToUpdate = newTasks[newIndex];
        await taskService.updateTask(taskToUpdate.id, {
          title: taskToUpdate.title,
          projectId: taskToUpdate.projectId,
          assignedUserId: taskToUpdate.assignedUserId,
          priority: taskToUpdate.priority,
          estimatedHours: taskToUpdate.estimatedHours,
          startDate: taskToUpdate.startDate,
          dueDate: taskToUpdate.dueDate,
          status: taskToUpdate.status,
          order: newIndex // Use index as new order
        });
      } catch (e) {
        console.error("Failed to update order");
      }
    }
  };

  const addInlineTask = async () => {
    if (!inlineTaskTitle.trim() || !inlineEstTime.trim() || !inlineDueDate || inlineAssignees.length === 0) {
      showToast('Please fill out all mandatory fields (Title, Priority, Est Time, Date, Assignee)', 'error');
      return;
    }
    try {
      const { hours } = parseEstimatedTime(inlineEstTime);
      if (hours <= 0) {
        showToast('Invalid estimated time', 'error');
        return;
      }
      const newTask = await taskService.createTask({
        title: inlineTaskTitle.trim(),
        projectId: 'default',
        assignedUserId: inlineAssignees[0],
        assignees: inlineAssignees,
        priority: inlinePriority,
        estimatedHours: hours,
        startDate: inlineDueDate,
        dueDate: inlineDueDate,
        status: 'Todo',
        order: tasks.length
      });
      setTasks(prev => [...prev, newTask]);
      setInlineTaskTitle('');
      setInlinePriority('Medium');
      setInlineEstTime('');
      setInlineDueDate('');
      setInlineAssignees([]);
      showToast('Task added!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to add task', 'error');
    }
  };

  const handleInlineSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      addInlineTask();
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedTaskIds(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };
  
  const handleStatusChange = async (id: string, newStatus: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    if (newStatus === 'Completed' && (!task.actualHours || task.actualHours <= 0)) {
      showToast("Cannot mark task as Completed without logging hours first!", 'error');
      return;
    }

    try {
      const updatedTask = await taskService.updateTask(id, {
        ...task,
        status: newStatus
      });
      setTasks(prev => prev.map(t => t.id === id ? updatedTask : t));
      showToast("Status updated successfully", 'success');
    } catch (e: any) {
      showToast(e.message || "Failed to update status", 'error');
    }
  };

  const handleToggleStar = async (id: string) => {
    try {
      const updatedTask = await taskService.toggleTaskStar(id);
      // Merge the result — if the backend returned a partial stub, preserve existing task fields
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updatedTask } : t));
    } catch (e: any) {
      // toggleTaskStar no longer throws, but keep this as a safety net
      console.warn('Star toggle failed silently:', e?.message);
    }
  };
  
  const toggleSelectAll = () => {
    if (selectedTaskIds.length === baseFilteredTasks.length) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(baseFilteredTasks.map(t => t.id));
    }
  };

  const handleDelete = (id: string) => {
    setConfirmDialog({
      message: 'Are you sure you want to delete this task? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          await taskService.deleteTask(id);
          setTasks(prev => prev.filter(t => t.id !== id));
          showToast('Task deleted successfully', 'success');
        } catch (err) {
          showToast('Failed to delete task', 'error');
        }
      }
    });
  };

  const handleBulkComplete = async () => {
    const invalidTasks = selectedTaskIds
      .map(id => tasks.find(t => t.id === id))
      .filter(task => task && (!task.actualHours || task.actualHours <= 0));

    if (invalidTasks.length > 0) {
      showToast(`Cannot mark ${invalidTasks.length} task(s) as Completed because they have no logged hours. Please log hours first.`, 'error');
      return;
    }

    try {
      await Promise.all(selectedTaskIds.map(async id => {
        const task = tasks.find(t => t.id === id);
        if (task) {
          await taskService.updateTask(id, {
            ...task,
            status: 'Completed'
          });
        }
      }));
      setSelectedTaskIds([]);
      fetchTasks();
      showToast("Selected tasks marked as Completed", 'success');
    } catch (e: any) {
      showToast(e.message || "Bulk complete failed", 'error');
    }
  };

  const handleBulkDelete = () => {
    setConfirmDialog({
      message: `Are you sure you want to delete the ${selectedTaskIds.length} selected task(s)? This action cannot be undone.`,
      confirmText: 'Delete All',
      cancelText: 'Cancel',
      onConfirm: async () => {
        try {
          await Promise.all(selectedTaskIds.map(id => taskService.deleteTask(id)));
          setTasks(prev => prev.filter(t => !selectedTaskIds.includes(t.id)));
          setSelectedTaskIds([]);
          showToast('Selected tasks deleted successfully', 'success');
        } catch (e) {
          showToast('Failed to delete some tasks', 'error');
        }
      }
    });
  };

  const handleStartFocusSprint = (task: Task) => {
    const focusDuration = Number(localStorage.getItem('timetriq_focus_duration') || '25');
    startFocus(task.id, task.title, focusDuration);
    showToast(`Started Focus Sprint for "${task.title}"`, 'success');
  };

  const today = new Date().toISOString().split('T')[0];

  // Helper to filter a task by date
  const filterTaskByDate = (t: Task, filterVal: string) => {
    if (filterVal === 'All') return true;

    const todayObj = new Date();
    const todayStr = todayObj.toISOString().split('T')[0];

    const yesterday = new Date(todayObj);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Compute Monday (start) and Sunday (end) of the current calendar week
    const dow = todayObj.getDay(); // 0=Sun, 1=Mon … 6=Sat
    const diffToMon = dow === 0 ? -6 : 1 - dow; // days back to Monday
    const weekStart = new Date(todayObj);
    weekStart.setDate(todayObj.getDate() + diffToMon);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6); // Sunday
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr   = weekEnd.toISOString().split('T')[0];

    if (filterVal === 'Today') return t.dueDate === todayStr;
    if (filterVal === 'Yesterday') return t.dueDate === yesterdayStr;

    if (filterVal === 'This Week') return t.dueDate >= weekStartStr && t.dueDate <= weekEndStr;
    
    if (filterVal === 'This Month') {
      const monthStartStr = new Date(todayObj.getFullYear(), todayObj.getMonth(), 1).toISOString().split('T')[0];
      const monthEndStr = new Date(todayObj.getFullYear(), todayObj.getMonth() + 1, 0).toISOString().split('T')[0];
      return t.dueDate >= monthStartStr && t.dueDate <= monthEndStr;
    }
    if (filterVal === 'Last Month') {
      const monthStartStr = new Date(todayObj.getFullYear(), todayObj.getMonth() - 1, 1).toISOString().split('T')[0];
      const monthEndStr = new Date(todayObj.getFullYear(), todayObj.getMonth(), 0).toISOString().split('T')[0];
      return t.dueDate >= monthStartStr && t.dueDate <= monthEndStr;
    }

    if (filterVal === 'Custom Date' && (customStartDate || customEndDate)) {
      if (customStartDate && customEndDate) return t.dueDate >= customStartDate && t.dueDate <= customEndDate;
      if (customStartDate) return t.dueDate >= customStartDate;
      if (customEndDate) return t.dueDate <= customEndDate;
    }
    return true;
  };

  // Derived stats
  const statsTasks = tasks.filter(t => {
    if (!showArchived && t.isArchived) return false;
    return filterTaskByDate(t, statsTimeFilter);
  });

  const totalTasks = statsTasks.length;
  const inProgressCount = statsTasks.filter(t => t.status === 'In Progress').length;
  const todoCount = statsTasks.filter(t => t.status === 'Todo').length;
  const completedCount = statsTasks.filter(t => t.status === 'Completed').length;
  
  const overdueCount = statsTasks.filter(t => t.dueDate < today && t.status !== 'Completed').length;
  
  const totalEst = statsTasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0);
  const totalAct = statsTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

  // Base list applying search, priority, and status (status 'Completed' is excluded from main list, so we handle it)
  const baseFilteredTasks = tasks.filter(t => {
    if (!showArchived && t.isArchived) return false;
    if (showArchived && !t.isArchived) return false; // In archive view, ONLY show archived tasks (optional, maybe standard is fine)
    if (showStarredOnly && !t.isStarred) return false;
    const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesPriority = priorityFilter === 'All' || t.priority === priorityFilter;
    return matchesSearch && matchesPriority;
  });

  const activeTasks = baseFilteredTasks.filter(t => 
    t.status !== 'Completed' && 
    !(t.dueDate < today && t.status !== 'Completed') && 
    (statusFilter === 'All' || t.status === statusFilter) &&
    filterTaskByDate(t, dateFilter)
  );

  // Base lists (no date filter) — used to decide whether to show the section at all
  const overdueBase = baseFilteredTasks.filter(t =>
    t.dueDate < today && t.status !== 'Completed' &&
    (statusFilter === 'All' || t.status === statusFilter)
  );
  const completedBase = baseFilteredTasks.filter(t => t.status === 'Completed');

  // Date-filtered lists (used for actual display)
  const overdueTasksList = overdueBase.filter(t => filterTaskByDate(t, overdueDateFilter));
  const completedTasksList = completedBase.filter(t => filterTaskByDate(t, completedDateFilter));

  const paginatedActive = activeTasks.slice((activePage - 1) * pageSize, activePage * pageSize);
  const paginatedOverdue = overdueTasksList.slice((overduePage - 1) * sectionPageSize, overduePage * sectionPageSize);
  const paginatedCompleted = completedTasksList.slice((completedPage - 1) * sectionPageSize, completedPage * sectionPageSize);
  const overdueTotalPages = Math.ceil(overdueTasksList.length / sectionPageSize);
  const completedTotalPages = Math.ceil(completedTasksList.length / sectionPageSize);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setDateFilter('All');
    setOverdueDateFilter('All');
    setCompletedDateFilter('All');
    setCustomStartDate('');
    setCustomEndDate('');
  };



  const statCardStyle = { flex: 1, minWidth: '140px', backgroundColor: '#FFFFFF', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', gap: '8px', alignItems: 'center' };

  if (loading && tasks.length === 0) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280', fontSize: '0.875rem' }}>Loading tasks...</div>;
  }

  return (
    <div style={{ padding: '0', maxWidth: '1400px', margin: '0 auto', position: 'relative' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 4px 0', color: '#111827' }}>My Tasks</h1>
          <p style={{ color: '#6B7280', fontSize: '0.75rem', margin: 0 }}>Organize, plan, and track your work.</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <DateFilterSelect
            value={statsTimeFilter}
            onChange={setStatsTimeFilter}
            options={[
              { value: 'All', label: 'All Time' },
              { value: 'This Month', label: 'This Month' },
              { value: 'Last Month', label: 'Last Month' },
              { value: 'This Week', label: 'This Week' },
            ]}
            label="Stats:"
            accentColor="#4F46E5"
            accentBg="#EEF2FF"
          />
          <button 
            onClick={() => setShowForm(true)}
            className="premium-btn premium-btn-primary"
          >
            <Plus size={14} /> New Task
          </button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '12px', marginBottom: '16px' }}>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#EEF2FF', padding: '6px', borderRadius: '6px', color: '#4F46E5' }}><CheckCircle2 size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>Total Tasks</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{totalTasks}</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#EFF6FF', padding: '6px', borderRadius: '6px', color: '#3B82F6' }}><Circle size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>In Progress</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{inProgressCount}</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#FFFBEB', padding: '6px', borderRadius: '6px', color: '#D97706' }}><Clock size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>To Do</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{todoCount}</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#ECFDF5', padding: '6px', borderRadius: '6px', color: '#059669' }}><CheckCircle2 size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>Completed</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{completedCount}</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#FEF2F2', padding: '6px', borderRadius: '6px', color: '#DC2626' }}><CalendarIcon size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>Overdue</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{overdueCount}</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#F0FDF4', padding: '6px', borderRadius: '6px', color: '#0891B2' }}><Clock size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>Est. Hours</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{parseFloat(totalEst.toFixed(1))}H</div>
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={{ backgroundColor: '#FAF5FF', padding: '6px', borderRadius: '6px', color: '#9333EA' }}><Clock size={16} /></div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 500 }}>Log Hours</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827' }}>{parseFloat(totalAct.toFixed(1))}H</div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button 
            onClick={() => setShowStarredOnly(!showStarredOnly)}
            title={showStarredOnly ? 'Show all tasks' : 'Show starred only'}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '7px 12px', borderRadius: '7px',
              border: `1px solid ${showStarredOnly ? '#FCD34D' : 'var(--color-border)'}`,
              backgroundColor: showStarredOnly ? '#FFFBEB' : '#FFFFFF',
              color: showStarredOnly ? '#B45309' : '#6B7280',
              fontWeight: 500, fontSize: '0.8125rem', cursor: 'pointer',
              transition: 'all 0.15s', whiteSpace: 'nowrap'
            }}
          >
            <span style={{ fontSize: '15px', lineHeight: 1, color: showStarredOnly ? '#F59E0B' : '#D1D5DB' }}>
              {showStarredOnly ? '★' : '☆'}
            </span>
            Starred
          </button>
          
          {/* View Toggle */}
          <div style={{ display: 'flex', backgroundColor: '#F3F4F6', padding: '4px', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
            <button 
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 12px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600,
                backgroundColor: viewMode === 'list' ? 'white' : 'transparent',
                color: viewMode === 'list' ? '#111827' : '#6B7280',
                boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s'
              }}
            >
              List
            </button>
            <button 
              onClick={() => setViewMode('kanban')}
              style={{
                padding: '6px 12px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600,
                backgroundColor: viewMode === 'kanban' ? 'white' : 'transparent',
                color: viewMode === 'kanban' ? '#111827' : '#6B7280',
                boxShadow: viewMode === 'kanban' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s'
              }}
            >
              Kanban
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#FFFFFF', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', width: '250px' }}>
            <Search size={16} color="#9CA3AF" style={{ marginRight: '8px' }} />
            <input 
              type="text" 
              placeholder="Search tasks by title..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ border: 'none', outline: 'none', width: '100%', fontSize: '0.875rem' }} 
            />
          </div>
          
          <DateFilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            label="Status: "
            options={[
              { value: 'All', label: 'All' },
              { value: 'Todo', label: 'Todo' },
              { value: 'In Progress', label: 'In Progress' },
              { value: 'Review', label: 'Review' },
              { value: 'Blocked', label: 'Blocked' },
            ]}
          />

          <DateFilterSelect
            value={priorityFilter}
            onChange={setPriorityFilter}
            label="Priority: "
            options={[
              { value: 'All', label: 'All' },
              { value: 'Low', label: 'Low' },
              { value: 'Medium', label: 'Medium' },
              { value: 'High', label: 'High' },
              { value: 'Critical', label: 'Critical' },
            ]}
          />

          <DateFilterSelect
            value={dateFilter}
            onChange={(v) => { setDateFilter(v); if (v === 'Custom Date') setCustomDateTarget('main'); }}
            label="Timeframe: "
            options={[
              { value: 'All', label: 'All Time' },
              { value: 'Today', label: 'Today' },
              { value: 'Yesterday', label: 'Yesterday' },
              { value: 'This Week', label: 'This Week' },
              { value: 'Custom Date', label: 'Custom Date' },
            ]}
          />
          
          {dateFilter === 'Custom Date' && (
            <button 
              onClick={() => setCustomDateTarget('main')}
              style={{ display: 'flex', alignItems: 'center', backgroundColor: '#F3F4F6', padding: '8px 16px', borderRadius: '24px', border: '1px solid #E5E7EB', fontSize: '0.875rem', fontWeight: 500, color: '#374151', cursor: 'pointer' }}
            >
              <CalendarIcon size={14} style={{ marginRight: '8px', color: '#6B7280' }} />
              {customStartDate && customEndDate ? `${customStartDate} to ${customEndDate}` : (customStartDate || customEndDate || 'Select Range')}
            </button>
          )}

          {(searchTerm || statusFilter !== 'All' || priorityFilter !== 'All' || dateFilter !== 'All') && (
            <button onClick={clearFilters} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: '#6B7280', fontSize: '0.875rem', cursor: 'pointer' }}>
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Main Area */}
      {viewMode === 'kanban' ? (
        <KanbanBoard 
          tasks={activeTasks}
          onTaskStatusChange={handleStatusChange}
          onClickTask={setActiveDetailsTask}
          onToggleStar={handleToggleStar}
        />
      ) : (
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', paddingBottom: '60px' }}>
          <div style={{ overflowX: 'auto', padding: '0 24px' }}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '12px 0', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '14px' }}></div>
                      <input type="checkbox" checked={selectedTaskIds.length > 0 && selectedTaskIds.length === baseFilteredTasks.length} onChange={toggleSelectAll} style={{ cursor: 'pointer' }} />
                      Task Title
                    </th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Priority</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Assignee</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Progress</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Due Date</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}>Created</th>
                    <th style={{ padding: '12px 0', fontWeight: 600 }}></th>
                  </tr>
                </thead>
                <SortableContext items={activeTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {paginatedActive.length === 0 ? (
                      <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>No pending tasks found.</td></tr>
                    ) : paginatedActive.map(task => (
                      <SortableRow 
                        key={task.id} 
                        task={task} 
                        isSelected={selectedTaskIds.includes(task.id)}
                        onToggleSelect={toggleSelect}
                        onLogTime={setLogTimeTaskId}
                        onDelete={handleDelete}
                        onViewDetails={setActiveDetailsTask}
                        onStatusChange={handleStatusChange}
                        onTimeLogged={fetchTasks}
                        isOverdue={task.dueDate < today && task.status !== 'Completed'}
                        onStartFocus={handleStartFocusSprint}
                        onToggleStar={handleToggleStar}
                      />
                    ))}
                    
                    {/* Inline Creation Row */}
                    <tr style={{ backgroundColor: '#F9FAFB' }}>
                      <td style={{ padding: '12px 8px 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '14px' }}></div>
                        <input type="checkbox" disabled style={{ opacity: 0.5 }} />
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>+ Quick Add</span>
                      </td>
                      <td colSpan={9} style={{ padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          {/* Title Input */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', border: '1px solid #E5E7EB', borderRadius: '6px', padding: '4px 8px', backgroundColor: '#FFFFFF', flex: '1 1 200px', minWidth: '150px' }}>
                            <Plus size={14} color="#9CA3AF" />
                            <input
                              type="text"
                              placeholder="Task title… (Enter to add)"
                              value={inlineTaskTitle}
                              onChange={(e) => setInlineTaskTitle(e.target.value)}
                              onKeyDown={handleInlineSubmit}
                              style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.8125rem', color: '#111827', width: '100%' }}
                            />
                          </div>

                          {/* Priority Dropdown */}
                          <select
                            value={inlinePriority}
                            onChange={(e) => setInlinePriority(e.target.value as any)}
                            style={{
                              border: '1px solid #E5E7EB', borderRadius: '6px', padding: '5px 8px',
                              fontSize: '0.8125rem', backgroundColor: '#FFFFFF', color: '#374151',
                              outline: 'none', cursor: 'pointer', flexShrink: 0
                            }}
                          >
                            <option value="Low">🟢 Low</option>
                            <option value="Medium">🟡 Medium</option>
                            <option value="High">🔴 High</option>
                            <option value="Critical">⚠️ Critical</option>
                          </select>

                          {/* Est. Time Input */}
                          <input
                            type="text"
                            placeholder="Time (e.g. 2h, 3.4)"
                            value={inlineEstTime}
                            onChange={(e) => setInlineEstTime(e.target.value)}
                            onKeyDown={handleInlineSubmit}
                            style={{
                              border: '1px solid #E5E7EB', borderRadius: '6px', padding: '5px 8px',
                              fontSize: '0.8125rem', backgroundColor: '#FFFFFF', color: '#374151',
                              outline: 'none', width: '90px', flexShrink: 0
                            }}
                          />

                          {/* Styled Date Picker */}
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => (inlineDateRef.current as any)?.showPicker?.()}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                border: '1px solid #E5E7EB', borderRadius: '6px', padding: '5px 10px',
                                fontSize: '0.8125rem', backgroundColor: '#FFFFFF', color: inlineDueDate ? '#111827' : '#9CA3AF',
                                outline: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: inlineDueDate ? 500 : 400
                              }}
                            >
                              <CalendarIcon size={13} color={inlineDueDate ? '#4F46E5' : '#9CA3AF'} />
                              {inlineDueDate ? new Date(inlineDueDate + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Due date'}
                            </button>
                            <input
                              ref={inlineDateRef}
                              type="date"
                              value={inlineDueDate}
                              onChange={(e) => setInlineDueDate(e.target.value)}
                              style={{
                                position: 'absolute', opacity: 0, width: '1px', height: '1px',
                                top: 0, left: 0, pointerEvents: 'none'
                              }}
                            />
                          </div>

                          {/* Assignee Multi-Select Dropdown */}
                          <QuickAddAssigneeSelect 
                            selectedIds={inlineAssignees}
                            onChange={setInlineAssignees}
                            options={SAMPLE_TEAM_MEMBERS}
                          />

                          {/* Add Button */}
                          <button
                            onClick={addInlineTask}
                            disabled={!inlineTaskTitle.trim() || !inlineEstTime.trim() || !inlineDueDate || inlineAssignees.length === 0}
                            style={{
                              marginLeft: 'auto', padding: '6px 12px', borderRadius: '6px', border: 'none',
                              backgroundColor: (inlineTaskTitle.trim() && inlineEstTime.trim() && inlineDueDate && inlineAssignees.length > 0) ? '#4F46E5' : '#E5E7EB',
                              color: (inlineTaskTitle.trim() && inlineEstTime.trim() && inlineDueDate && inlineAssignees.length > 0) ? 'white' : '#9CA3AF',
                              fontSize: '0.8125rem', fontWeight: 600,
                              cursor: (inlineTaskTitle.trim() && inlineEstTime.trim() && inlineDueDate && inlineAssignees.length > 0) ? 'pointer' : 'not-allowed',
                              transition: 'all 0.15s ease', whiteSpace: 'nowrap', flexShrink: 0
                            }}
                          >
                            <Plus size={14} />
                            Add
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
            {viewMode === 'list' && (
              <Pagination currentPage={activePage} totalItems={activeTasks.length} pageSize={pageSize} onPageChange={setActivePage} />
            )}
          </div>
        </div>
      )}

      {/* Overdue Tasks Table — always visible when any overdue tasks exist */}
      {(overdueBase.length > 0 && viewMode === 'list') && (
        <div style={{ marginTop: '32px', backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
          <div style={{ padding: '14px 24px', backgroundColor: '#FEF2F2', borderBottom: '1px solid #FECACA', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#991B1B', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CalendarIcon size={16} /> Overdue Tasks
              <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#DC2626', backgroundColor: '#FEE2E2', padding: '1px 8px', borderRadius: '99px', marginLeft: '4px' }}>{overdueTasksList.length}</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Date filter */}
              <DateFilterSelect
                value={overdueDateFilter}
                onChange={(v) => { setOverdueDateFilter(v); if (v === 'Custom Date') setCustomDateTarget('overdue'); }}
                options={[
                  { value: 'All', label: 'All Time' },
                  { value: 'Today', label: 'Today' },
                  { value: 'Yesterday', label: 'Yesterday' },
                  { value: 'This Week', label: 'This Week' },
                  { value: 'Custom Date', label: 'Custom Date' },
                ]}
                accentColor="#991B1B"
                accentBg="#FEF2F2"
              />
              {/* Inline pagination arrows */}
              {overdueTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => setOverduePage(p => Math.max(1, p - 1))}
                    disabled={overduePage === 1}
                    style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px solid #FECACA', backgroundColor: overduePage === 1 ? '#FEF2F2' : '#FFFFFF', color: overduePage === 1 ? '#FCA5A5' : '#991B1B', cursor: overduePage === 1 ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 700, transition: 'all 0.15s' }}
                  >‹</button>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#991B1B', minWidth: '52px', textAlign: 'center' }}>{overduePage} / {overdueTotalPages}</span>
                  <button
                    onClick={() => setOverduePage(p => Math.min(overdueTotalPages, p + 1))}
                    disabled={overduePage === overdueTotalPages}
                    style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px solid #FECACA', backgroundColor: overduePage === overdueTotalPages ? '#FEF2F2' : '#FFFFFF', color: overduePage === overdueTotalPages ? '#FCA5A5' : '#991B1B', cursor: overduePage === overdueTotalPages ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 700, transition: 'all 0.15s' }}
                  >›</button>
                </div>
              )}
            </div>
          </div>
          <div style={{ overflowX: 'auto', padding: '0 24px 16px 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Task Title</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Assignee</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Progress</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Due Date</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Created</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {overdueTasksList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <CalendarIcon size={32} color="#FECACA" />
                        <p style={{ margin: 0, fontWeight: 600, color: '#991B1B', fontSize: '0.9rem' }}>No overdue tasks for this period</p>
                        <p style={{ margin: 0, color: '#B91C1C', fontSize: '0.8rem' }}>Try a different date filter or select "All Time"</p>
                        <button
                          onClick={() => { setOverdueDateFilter('All'); setOverduePage(1); }}
                          style={{ marginTop: '4px', padding: '6px 16px', borderRadius: '6px', border: '1px solid #FECACA', backgroundColor: '#FFFFFF', color: '#991B1B', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
                        >Clear Filter</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedOverdue.map(task => (
                    <StaticRow
                      key={task.id}
                      task={task}
                      isSelected={selectedTaskIds.includes(task.id)}
                      onToggleSelect={toggleSelect}
                      onLogTime={setLogTimeTaskId}
                      onDelete={handleDelete}
                      onViewDetails={setActiveDetailsTask}
                      onStatusChange={handleStatusChange}
                      onTimeLogged={fetchTasks}
                      isOverdue={true}
                      onStartFocus={handleStartFocusSprint}
                      onToggleStar={handleToggleStar}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Completed Tasks Table — always visible when any completed tasks exist */}
      {(completedBase.length > 0 && viewMode === 'list') && (
        <div style={{ marginTop: '32px', backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
          <div style={{ padding: '14px 24px', backgroundColor: '#F0FDF4', borderBottom: '1px solid #A7F3D0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0, color: '#065F46', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={16} /> Completed Tasks
              <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#059669', backgroundColor: '#D1FAE5', padding: '1px 8px', borderRadius: '99px', marginLeft: '4px' }}>{completedTasksList.length}</span>
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Date filter */}
              <DateFilterSelect
                value={completedDateFilter}
                onChange={(v) => { setCompletedDateFilter(v); if (v === 'Custom Date') setCustomDateTarget('completed'); }}
                options={[
                  { value: 'All', label: 'All Time' },
                  { value: 'Today', label: 'Today' },
                  { value: 'Yesterday', label: 'Yesterday' },
                  { value: 'This Week', label: 'This Week' },
                  { value: 'Custom Date', label: 'Custom Date' },
                ]}
                accentColor="#065F46"
                accentBg="#F0FDF4"
              />
              {/* Inline pagination arrows */}
              {completedTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    onClick={() => setCompletedPage(p => Math.max(1, p - 1))}
                    disabled={completedPage === 1}
                    style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px solid #A7F3D0', backgroundColor: completedPage === 1 ? '#F0FDF4' : '#FFFFFF', color: completedPage === 1 ? '#6EE7B7' : '#065F46', cursor: completedPage === 1 ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 700, transition: 'all 0.15s' }}
                  >‹</button>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#065F46', minWidth: '52px', textAlign: 'center' }}>{completedPage} / {completedTotalPages}</span>
                  <button
                    onClick={() => setCompletedPage(p => Math.min(completedTotalPages, p + 1))}
                    disabled={completedPage === completedTotalPages}
                    style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', border: '1px solid #A7F3D0', backgroundColor: completedPage === completedTotalPages ? '#F0FDF4' : '#FFFFFF', color: completedPage === completedTotalPages ? '#6EE7B7' : '#065F46', cursor: completedPage === completedTotalPages ? 'not-allowed' : 'pointer', fontSize: '0.875rem', fontWeight: 700, transition: 'all 0.15s' }}
                  >›</button>
                </div>
              )}
            </div>
          </div>
          <div style={{ overflowX: 'auto', padding: '0 24px 16px 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Task Title</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Assignee</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Progress</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Due Date</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}>Created</th>
                  <th style={{ padding: '12px 0', fontWeight: 600 }}></th>
                </tr>
              </thead>
              <tbody>
                {completedTasksList.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                        <CheckCircle2 size={32} color="#A7F3D0" />
                        <p style={{ margin: 0, fontWeight: 600, color: '#065F46', fontSize: '0.9rem' }}>No completed tasks for this period</p>
                        <p style={{ margin: 0, color: '#047857', fontSize: '0.8rem' }}>Try a different date filter or select "All Time"</p>
                        <button
                          onClick={() => { setCompletedDateFilter('All'); setCompletedPage(1); }}
                          style={{ marginTop: '4px', padding: '6px 16px', borderRadius: '6px', border: '1px solid #A7F3D0', backgroundColor: '#FFFFFF', color: '#065F46', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}
                        >Clear Filter</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedCompleted.map(task => (
                    <StaticRow
                      key={task.id}
                      task={task}
                      isSelected={selectedTaskIds.includes(task.id)}
                      onToggleSelect={toggleSelect}
                      onLogTime={setLogTimeTaskId}
                      onDelete={handleDelete}
                      onViewDetails={setActiveDetailsTask}
                      onStatusChange={handleStatusChange}
                      onTimeLogged={fetchTasks}
                      isOverdue={false}
                      onStartFocus={handleStartFocusSprint}
                      onToggleStar={handleToggleStar}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      {selectedTaskIds.length > 0 && (
        <div style={{ 
          position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)', 
          backgroundColor: '#111827', color: 'white', padding: '12px 24px', borderRadius: '100px',
          display: 'flex', alignItems: 'center', gap: '24px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', zIndex: 100 
        }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{selectedTaskIds.length} tasks selected</span>
          <div style={{ width: '1px', height: '24px', backgroundColor: '#374151' }}></div>
          <button onClick={handleBulkComplete} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: '#D1FAE5', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
            <Check size={16} /> Mark Completed
          </button>
          <button onClick={handleBulkDelete} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', color: '#FECACA', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={() => setSelectedTaskIds([])} style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', marginLeft: '12px' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Task Creation Modal */}
      {showForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%' }}>
            <TaskForm 
              onSuccess={() => { setShowForm(false); fetchTasks(); }} 
              onCancel={() => { setShowForm(false); }} 
            />
          </div>
        </div>
      )}

      {/* Task Auto-Save Modal */}
      {modalDraft && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', width: '550px', maxWidth: '90%', padding: '32px', position: 'relative', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', maxHeight: '90vh', overflowY: 'auto' }}>
            <button 
              onClick={() => setActiveDetailsTask(null)}
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}
            >
              <X size={20} />
            </button>
            
            <input 
              type="text" 
              value={modalDraft.title}
              onChange={(e) => setModalDraft({ ...modalDraft, title: e.target.value })}
              onBlur={(e) => handleModalSave('title', e.target.value)}
              style={{ width: '90%', margin: '0 0 16px 0', fontSize: '1.5rem', fontWeight: 700, color: '#111827', border: 'none', outline: 'none', background: 'transparent' }}
              placeholder="Task Title"
            />
            
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <select 
                value={modalDraft.status}
                onChange={(e) => handleModalSave('status', e.target.value)}
                style={{ backgroundColor: '#F3F4F6', color: '#374151', padding: '6px 12px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600, border: 'none', outline: 'none', cursor: 'pointer' }}
              >
                <option value="Todo">Todo</option>
                <option value="In Progress">In Progress</option>
                <option value="Review">Review</option>
                <option value="Completed">Completed</option>
                <option value="Blocked">Blocked</option>
              </select>

              <select 
                value={modalDraft.priority}
                onChange={(e) => handleModalSave('priority', e.target.value)}
                style={{ backgroundColor: '#F3F4F6', color: '#374151', padding: '6px 12px', borderRadius: '6px', fontSize: '0.8125rem', fontWeight: 600, border: 'none', outline: 'none', cursor: 'pointer' }}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '0.8125rem', color: '#6B7280', margin: '0 0 8px 0', fontWeight: 600 }}>Description</h3>
              <RichTextEditor 
                value={modalDraft.description || ''}
                onChange={(value) => setModalDraft({ ...modalDraft, description: value })}
                onBlur={() => handleModalSave('description', modalDraft.description || '')}
                placeholder="Add a detailed description..."
                minHeight="120px"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '32px' }}>
              <div style={{ position: 'relative' }}>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '4px', fontWeight: 600 }}>Est. Time</div>
                <input 
                  type="text"
                  placeholder="e.g. 4h 34m"
                  value={modalEstTimeInput}
                  onChange={(e) => handleModalEstTimeChange(e.target.value)}
                  onBlur={handleModalEstTimeBlur}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '0.875rem', outline: 'none' }}
                />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '4px', fontWeight: 600 }}>Logged Hours</div>
                <div style={{ fontWeight: 600, color: '#111827', padding: '8px 0' }}>{(modalDraft.actualHours || 0).toFixed(1)}h</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '4px', fontWeight: 600 }}>Start Date</div>
                <input 
                  type="date"
                  value={modalDraft.startDate}
                  onChange={(e) => handleModalSave('startDate', e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '0.875rem', outline: 'none' }}
                />
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '4px', fontWeight: 600 }}>Due Date</div>
                <input 
                  type="date"
                  value={modalDraft.dueDate}
                  onChange={(e) => handleModalSave('dueDate', e.target.value)}
                  style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #E5E7EB', fontSize: '0.875rem', outline: 'none' }}
                />
              </div>
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '2px dashed #E5E7EB', marginBottom: '24px' }}>
              <TaskChecklist taskId={modalDraft.id} />
              <TaskAttachments taskId={modalDraft.id} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={12} color="#10B981" /> All edits saved automatically
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Styles for slideIn Animation */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideIn {
          from {
            transform: translateY(-20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}} />

      {/* In-App Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          backgroundColor: toast.type === 'error' ? '#EF4444' : (toast.type === 'success' ? '#10B981' : '#3B82F6'),
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          animation: 'slideIn 0.3s ease-out',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}>
          <span>{toast.message}</span>
          <button 
            onClick={() => setToast(null)} 
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 0 }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Custom Confirmation Dialog */}
      {confirmDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '400px',
            maxWidth: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            border: '1px solid #E5E7EB',
          }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>Confirm Action</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: '0.875rem', color: '#4B5563', lineHeight: '1.5' }}>{confirmDialog.message}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#F3F4F6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                }}
              >
                {confirmDialog.cancelText || 'Cancel'}
              </button>
              <button 
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#DC2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontSize: '0.8125rem',
                }}
              >
                {confirmDialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {logTimeTaskId && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          backdropFilter: 'blur(2px)'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            width: '400px',
            maxWidth: '90%',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            border: '1px solid #E5E7EB'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', fontWeight: 600, color: '#111827' }}>Time on all tasks</h3>
                <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280' }}>
                  Logging time for: <strong>{tasks.find(t => t.id === logTimeTaskId)?.title}</strong>
                </p>
              </div>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const { hours } = parseEstimatedTime(manualTimeInput);
              if (hours <= 0) {
                // If it's empty, and the user just clicked Save to close, we should just close it without error
                if (!manualTimeInput.trim()) {
                  setLogTimeTaskId(null);
                  return;
                }
                showToast("Invalid time format (e.g. use 1.5, 2h, or 1h 30m).", "error");
                return;
              }
              
              try {
                // Ensure date formatting is correct for the backend
                const dateOnly = logTimeStartDate.split('T')[0];
                const startIso = logTimeStartDate ? new Date(logTimeStartDate).toISOString() : undefined;
                const endIso = logTimeEndDate ? new Date(logTimeEndDate).toISOString() : undefined;
                
                await timeService.createTimeEntry({
                  task_id: logTimeTaskId,
                  date: dateOnly,
                  start_time: startIso,
                  end_time: endIso,
                  hours_worked: hours,
                  notes: logTimeNotes || 'Logged manually',
                  tags: logTimeTags || undefined
                });
                showToast("Time logged successfully!", "success");
                
                // Check Auto-completion
                const task = tasks.find(t => t.id === logTimeTaskId);
                if (task) {
                  const newActualHours = (task.actualHours || 0) + hours;
                  
                  // Optimistically update the local task state so handleStatusChange sees it
                  const updatedTasks = tasks.map(t => t.id === logTimeTaskId ? { ...t, actualHours: newActualHours } : t);
                  setTasks(updatedTasks);
                  
                  if (task.estimatedHours > 0 && newActualHours >= task.estimatedHours && task.status !== 'Completed') {
                     // Pass the updated task directly if needed, but since we just set state,
                     // it might not be available in the closure yet. Let's fetch from backend just to be safe.
                     await fetchTasks();
                     
                     // Backend might have auto-completed it already! (time_service.py does this)
                     // So let's check if we still need to manually call handleStatusChange
                  } else {
                     fetchTasks();
                  }
                } else {
                  fetchTasks();
                }
                
                // Refresh list directly so user sees it instantly
                timeService.getTimeEntries(logTimeTaskId).then(setPastTimeEntries).catch(console.error);
                
                // Clear inputs
                setManualTimeInput('');
                setLogTimeNotes('');
                setLogTimeTags('');
              } catch (err: any) {
                let msg = err.message || "Failed to log time";
                if (Array.isArray(err.detail)) {
                  msg = err.detail.map((e: any) => e.msg).join(', ');
                }
                showToast(msg, "error");
              }
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                <div>
                  <input 
                    type="text" 
                    placeholder="Enter time (ex: 3h 20m) or start timer" 
                    value={manualTimeInput}
                    onChange={(e) => handleManualTimeChange(e.target.value)}
                    onBlur={handleManualTimeBlur}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.875rem', outline: 'none' }} 
                  />
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="datetime-local" 
                    value={logTimeStartDate}
                    onChange={e => handleDateBoundsChange(e.target.value, logTimeEndDate)}
                    style={{ padding: '6px 4px', borderRadius: '4px', border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none', flex: 1, minWidth: 0 }}
                  />
                  <span style={{ fontSize: '0.8125rem', color: '#6B7280', flexShrink: 0 }}>to</span>
                  <input 
                    type="datetime-local" 
                    value={logTimeEndDate}
                    onChange={e => handleDateBoundsChange(logTimeStartDate, e.target.value)}
                    style={{ padding: '6px 4px', borderRadius: '4px', border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none', flex: 1, minWidth: 0 }}
                  />
                </div>

                <div>
                  <textarea 
                    placeholder="Notes" 
                    value={logTimeNotes}
                    onChange={e => setLogTimeNotes(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.875rem', outline: 'none', resize: 'vertical', minHeight: '60px' }} 
                  />
                </div>
                
                <div>
                  <div style={{ position: 'relative' }}>
                    <TagIcon size={14} color="#9CA3AF" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
                    <input 
                      type="text" 
                      placeholder="Add tags" 
                      value={logTimeTags}
                      onChange={e => setLogTimeTags(e.target.value)}
                      style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '0.875rem', outline: 'none' }} 
                    />
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E5E7EB', paddingBottom: '20px', marginBottom: '20px' }}>
                <span style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
                  {(() => {
                    const totalHours = pastTimeEntries.reduce((acc, e) => acc + (e.hours_worked || 0), 0);
                    return `Total logged: ${formatHoursCompact(totalHours)}`;
                  })()}
                </span>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button type="button" onClick={() => setLogTimeTaskId(null)} className="premium-btn">Close</button>
                  <button type="submit" className="premium-btn premium-btn-primary">Save</button>
                </div>
              </div>
            </form>
            
            <div>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#374151', margin: '0 0 12px 0' }}>Time Entries</h4>
              {pastTimeEntries.length === 0 ? (
                <div style={{ fontSize: '0.8125rem', color: '#9CA3AF', textAlign: 'center', padding: '12px 0' }}>No time entries found for this task.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                  {pastTimeEntries.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(entry => (
                    <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', border: '1px solid #E5E7EB', borderRadius: '6px', backgroundColor: '#F9FAFB' }}>
                      <div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#111827', marginBottom: '4px' }}>
                           {new Date(entry.start_time || entry.date).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'})}
                           {entry.start_time && (
                             <span style={{ color: '#6B7280', marginLeft: '6px', fontWeight: 400 }}>
                               {new Date(entry.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                             </span>
                           )}
                        </div>
                        {entry.notes && <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>{entry.notes}</div>}
                        {entry.tags && <div style={{ fontSize: '0.7rem', color: '#4F46E5', marginTop: '4px' }}>#{entry.tags}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                         <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>{formatHoursCompact(entry.hours_worked)}</span>
                         <button onClick={() => handleDeleteTimeEntry(entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                           <Trash2 size={14} color="#EF4444" />
                         </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {focusSession && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: '#0F172A',
          color: '#F8FAFC',
          zIndex: 2000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}>
          <div style={{
            maxWidth: '500px',
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '24px'
          }}>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#38BDF8',
              backgroundColor: '#0369A1',
              padding: '4px 12px',
              borderRadius: '20px'
            }}>
              Focus Sprint Mode
            </span>
            
            <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, lineHeight: 1.3 }}>
              {focusSession.taskTitle}
            </h2>

            <div style={{
              width: '240px',
              height: '240px',
              borderRadius: '50%',
              border: '8px solid #1E293B',
              borderTopColor: '#38BDF8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3.5rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              position: 'relative',
              boxShadow: '0 0 40px rgba(56, 189, 248, 0.1)'
            }}>
              <div style={{
                position: 'absolute',
                fontSize: '3.5rem',
                fontWeight: 700,
                color: '#F8FAFC',
                transform: 'none'
              }}>
                {Math.floor(focusSession.timeLeft / 60)}:{(focusSession.timeLeft % 60).toString().padStart(2, '0')}
              </div>
            </div>

            {focusSession.timeLeft === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                <div style={{ fontSize: '1rem', color: '#34D399', fontWeight: 600 }}>🎉 Sprint Session Finished!</div>
                <button
                  onClick={() => {
                    const loggedTimeVal = (focusSession.duration / 3600).toFixed(2);
                    setManualTimeInput(`${loggedTimeVal} hours`);
                    setLogTimeTaskId(focusSession.taskId);
                    stopFocus();
                  }}
                  className="premium-btn premium-btn-primary"
                  style={{ width: '100%', fontSize: '0.875rem', padding: '12px' }}
                >
                  Log Sprint Time Now
                </button>
                <button
                  onClick={stopFocus}
                  style={{ background: 'none', border: 'none', color: '#94A3B8', fontSize: '0.8125rem', cursor: 'pointer' }}
                >
                  Close Focus Mode
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                {focusSession.isRunning ? (
                  <button
                    onClick={pauseFocus}
                    className="premium-btn"
                    style={{ padding: '10px 24px', backgroundColor: '#F59E0B', color: '#111827', border: 'none' }}
                  >
                    Pause
                  </button>
                ) : (
                  <button
                    onClick={resetFocus}
                    className="premium-btn premium-btn-primary"
                    style={{ padding: '10px 24px' }}
                  >
                    Resume
                  </button>
                )}
                
                <button
                  onClick={stopFocus}
                  className="premium-btn premium-btn-danger"
                  style={{ padding: '10px 24px' }}
                >
                  Quit Session
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Custom Date Modal */}
      {customDateTarget && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', padding: '24px', width: '400px', maxWidth: '90%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Select Date Range</h2>
              <button onClick={() => setCustomDateTarget(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} color="#6B7280" /></button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>Start Date</label>
                <input 
                  type="date" 
                  value={customStartDate} 
                  onChange={(e) => setCustomStartDate(e.target.value)} 
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.875rem' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>End Date</label>
                <input 
                  type="date" 
                  value={customEndDate} 
                  onChange={(e) => setCustomEndDate(e.target.value)} 
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #D1D5DB', fontSize: '0.875rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                <button 
                  onClick={() => {
                    setCustomStartDate('');
                    setCustomEndDate('');
                  }}
                  style={{ padding: '8px 16px', border: 'none', background: 'none', color: '#6B7280', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}
                >
                  Clear
                </button>
                <button 
                  onClick={() => setCustomDateTarget(null)}
                  style={{ padding: '8px 16px', backgroundColor: '#2563EB', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.875rem', cursor: 'pointer', fontWeight: 500 }}
                >
                  Apply Range
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
