import React, { useState, useRef, useEffect } from 'react';
import { taskService, type TaskCreate, type Task } from '../services/taskService';
import { useAuth } from './AuthContext';
import { User, ChevronDown, X, Check, Paperclip, Trash2 } from 'lucide-react';
import { TaskChecklist } from './task/TaskChecklist';
import { TaskAttachments } from './task/TaskAttachments';
import { attachmentService } from '../services/attachmentService';
import { parseEstimatedTime, formatHours } from '../lib/utils';
import { RichTextEditor } from './RichTextEditor';
import { CustomSelect } from './CustomSelect';

interface TaskFormProps {
  initialTask?: Task;
  onSuccess: () => void;
  onCancel: () => void;
}

export const TaskForm: React.FC<TaskFormProps> = ({ initialTask, onSuccess, onCancel }) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const depDropdownRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [depDropdownOpen, setDepDropdownOpen] = useState(false);

  useEffect(() => {
    // Mock users as requested
    const MOCK_USERS = [
      { id: 'harsh', name: 'Harsh (Manager)', initials: 'HA', color: '#4F46E5', role: 'Manager' },
      { id: 'sathyam', name: 'Sathyam (Manager)', initials: 'SA', color: '#059669', role: 'Manager' },
      { id: 'vishaka', name: 'Vishaka (HR)', initials: 'VI', color: '#D97706', role: 'HR' },
      { id: 'sakshi', name: 'Sakshi (HR)', initials: 'SA', color: '#DC2626', role: 'HR' },
      { id: 'pradeep', name: 'Pradeep (Member)', initials: 'PR', color: '#7C3AED', role: 'Team Member' },
      { id: 'ramu', name: 'Ramu (Member)', initials: 'RA', color: '#2563EB', role: 'Team Member' },
      { id: 'rahul', name: 'Rahul (Member)', initials: 'RA', color: '#0891B2', role: 'Team Member' },
      { id: 'dev', name: 'Dev (Member)', initials: 'DE', color: '#16A34A', role: 'Team Member' },
    ];
    setTeamMembers(MOCK_USERS);
    taskService.getTasks().then(setAllTasks).catch(console.error);
  }, []);

  const currentUserDisplayName = user?.displayName || user?.email || 'Unknown';

  const processedTeamMembers = [
    { id: 'myself', name: 'Me', initials: 'ME', color: '#4F46E5', role: 'Self' },
    ...teamMembers.filter(m => m.id !== 'harish_kandi' && !m.name.includes(currentUserDisplayName))
  ];

  const [form, setForm] = useState<TaskCreate>({
    title: initialTask?.title || '',
    projectId: initialTask?.projectId || 'default',
    assignedUserId: initialTask?.assignedUserId || '',
    assignees: initialTask?.assignees || [],
    assignedBy: initialTask?.assignedBy || currentUserDisplayName,
    assignedByUid: initialTask?.assignedByUid || user?.uid || '',
    priority: initialTask?.priority || '',
    estimatedHours: initialTask?.estimatedHours || ('' as any),
    startDate: initialTask?.startDate || new Date().toISOString().split('T')[0],
    dueDate: initialTask?.dueDate || new Date().toISOString().split('T')[0],
    description: initialTask?.description || '',
    status: initialTask?.status || 'Todo',
    actualHours: initialTask?.actualHours || 0,
    dependencies: initialTask?.dependencies || [],
  });

  const [estTimeInput, setEstTimeInput] = useState(
    initialTask?.estimatedHours ? formatHours(initialTask.estimatedHours) : ''
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (depDropdownRef.current && !depDropdownRef.current.contains(e.target as Node)) {
        setDepDropdownOpen(false);
      }
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        // Optional: only close if not clicking a portal element like a date picker
        const target = e.target as HTMLElement;
        if (!target.closest('.flatpickr-calendar') && !target.closest('.toast')) {
          onCancel();
        }
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [onCancel]);

  const toggleAssignee = (memberId: string) => {
    const current = form.assignees || [];
    if (current.includes(memberId)) {
      setForm({ ...form, assignees: current.filter(a => a !== memberId) });
    } else {
      setForm({ ...form, assignees: [...current, memberId] });
    }
  };

  const removeAssignee = (memberId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setForm({ ...form, assignees: (form.assignees || []).filter(a => a !== memberId) });
  };

  const selectedMembers = processedTeamMembers.filter(m => (form.assignees || []).includes(m.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowValidation(true);
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!form.priority) {
      setError('Priority is required');
      return;
    }
    if (!form.estimatedHours || form.estimatedHours <= 0) {
      setError('Estimated hours are required');
      return;
    }
    if (!form.startDate || !form.dueDate) {
      setError('Start Date and Due Date are required');
      return;
    }
    if ((!form.assignees || form.assignees.length === 0) && !form.assignedUserId) {
      setError('Assignee is required');
      return;
    }
    if (form.status === 'Completed' && (!initialTask?.actualHours || initialTask.actualHours <= 0)) {
      setError('Cannot mark task as Completed without logging hours first!');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let newTaskId = initialTask?.id;
      if (initialTask && initialTask.id) {
        await taskService.updateTask(initialTask.id, form);
      } else {
        const createdTask = await taskService.createTask(form);
        newTaskId = createdTask.id;
      }
      
      if (pendingFiles.length > 0 && newTaskId) {
        // Fire and forget to prevent blocking the UI if Firebase Storage hangs
        pendingFiles.forEach(file => {
          attachmentService.uploadAttachment(newTaskId!, file).catch(e => {
            console.error("Failed to upload pending attachment:", e);
          });
        });
      }
      
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save task');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '6px',
    border: '1px solid #D1D5DB',
    fontSize: '0.875rem',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: '#FFFFFF',
    transition: 'all 0.15s ease',
    boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#374151',
    marginBottom: '6px',
    letterSpacing: '0.01em',
  };

  const mandatoryStar = <span style={{ color: '#EF4444' }}>*</span>;

  const getValidationStyle = (isValid: boolean) => ({
    ...inputStyle,
    borderColor: showValidation && !isValid ? '#EF4444' : '#D1D5DB',
    backgroundColor: showValidation && !isValid ? '#FEF2F2' : '#FFFFFF',
  });

  return (
    <div ref={formRef} style={{
      backgroundColor: 'white',
      borderRadius: '14px',
      padding: '28px',
      boxShadow: '0 20px 60px -10px rgba(0,0,0,0.15)',
      maxHeight: '90vh',
      overflowY: 'auto',
      width: '100%',
      maxWidth: '520px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>
            {initialTask && initialTask.id ? 'Edit Task' : 'New Task'}
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: '0.8rem', color: '#6B7280' }}>
            Assigned by: <strong>{form.assignedBy === currentUserDisplayName ? 'You' : form.assignedBy}</strong>
          </p>
        </div>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', padding: '4px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}
        >
          <X size={20} />
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: '#FEF2F2', color: '#B91C1C', padding: '10px 14px', borderRadius: '8px', fontSize: '0.8125rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚠️ {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Title */}
        <div>
          <label style={labelStyle}>Task Title {mandatoryStar}</label>
          <input
            style={getValidationStyle(!!form.title.trim())}
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder="What needs to be done?"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <RichTextEditor 
            value={form.description || ''} 
            onChange={value => setForm({ ...form, description: value })} 
            placeholder="Add more details about this task..."
          />
        </div>

        {/* Assignees Dropdown */}
        <div>
          <label style={labelStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <User size={13} /> Assignees {mandatoryStar}
            </span>
          </label>

          {/* Selected assignee chips shown above dropdown trigger */}
          {selectedMembers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {selectedMembers.map(member => (
                <span
                  key={member.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 8px 3px 4px',
                    borderRadius: '20px',
                    backgroundColor: member.color + '18',
                    border: `1.5px solid ${member.color}50`,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: member.color,
                  }}
                >
                  <span style={{
                    width: '18px', height: '18px', borderRadius: '50%',
                    backgroundColor: member.color, color: 'white',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.55rem', fontWeight: 800, flexShrink: 0,
                  }}>
                    {member.initials}
                  </span>
                  {member.name}
                  <button
                    type="button"
                    onClick={(e) => removeAssignee(member.id, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', color: member.color, opacity: 0.7 }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Dropdown trigger */}
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDropdownOpen(!dropdownOpen)}
              style={{
                ...getValidationStyle((form.assignees && form.assignees.length > 0) || !!form.assignedUserId),
                padding: '10px 14px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: selectedMembers.length === 0 ? '#9CA3AF' : '#374151',
                boxShadow: dropdownOpen ? '0 0 0 3px rgba(79,70,229,0.1)' : '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {selectedMembers.length === 0 ? (
                  <>
                    <User size={14} color="#9CA3AF" />
                    Add assignees...
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '-4px' }}>
                      {selectedMembers.slice(0, 3).map((m, i) => (
                        <span key={m.id} style={{
                          width: '22px', height: '22px', borderRadius: '50%',
                          backgroundColor: m.color, color: 'white',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.55rem', fontWeight: 800,
                          marginLeft: i === 0 ? 0 : '-6px',
                          border: '2px solid white',
                          zIndex: 3 - i,
                          position: 'relative',
                        }}>
                          {m.initials}
                        </span>
                      ))}
                    </div>
                    <span style={{ color: '#374151' }}>
                      {selectedMembers.length === 1
                        ? selectedMembers[0].name
                        : `${selectedMembers.length} assignees`}
                    </span>
                  </>
                )}
              </span>
              <ChevronDown
                size={15}
                style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#6B7280' }}
              />
            </button>

            {/* Dropdown panel */}
            {dropdownOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                backgroundColor: 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '10px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 50,
                overflow: 'hidden',
              }}>
                <div style={{ padding: '8px', borderBottom: '1px solid #F3F4F6', fontSize: '0.7rem', color: '#9CA3AF', textAlign: 'center' }}>
                  Click to select / deselect
                </div>
                {processedTeamMembers.map(member => {
                  const isSelected = (form.assignees || []).includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleAssignee(member.id)}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        border: 'none',
                        backgroundColor: isSelected ? member.color + '0D' : 'white',
                        cursor: 'pointer',
                        transition: 'background 0.12s',
                        borderBottom: '1px solid #F9FAFB',
                      }}
                      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F9FAFB'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isSelected ? member.color + '0D' : 'white'; }}
                    >
                      {/* Avatar */}
                      <span style={{
                        width: '32px', height: '32px', borderRadius: '50%',
                        backgroundColor: member.color, color: 'white',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 800, flexShrink: 0,
                      }}>
                        {member.initials}
                      </span>
                      {/* Name */}
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>{member.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>
                          {member.id === 'myself' ? 'Assign to yourself' : 'Team member'}
                        </div>
                      </div>
                      {/* Checkmark */}
                      {isSelected && (
                        <span style={{
                          width: '20px', height: '20px', borderRadius: '50%',
                          backgroundColor: member.color, color: 'white',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <Check size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Dependencies */}
        <div>
          <label style={labelStyle}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Check size={13} /> Dependencies
            </span>
          </label>

          {/* Selected dependencies chips */}
          {(form.dependencies || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {(form.dependencies || []).map(depId => {
                const t = allTasks.find(x => x.id === depId);
                if (!t) return null;
                return (
                  <span
                    key={depId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '3px 8px 3px 8px',
                      borderRadius: '20px',
                      backgroundColor: '#F3F4F6',
                      border: `1.5px solid #E5E7EB`,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#4B5563',
                    }}
                  >
                    {t.title}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setForm({ ...form, dependencies: (form.dependencies || []).filter(id => id !== depId) }); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', alignItems: 'center', color: '#9CA3AF' }}
                    >
                      <X size={11} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* Dropdown trigger */}
          <div ref={depDropdownRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setDepDropdownOpen(!depDropdownOpen)}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: (form.dependencies || []).length === 0 ? '#9CA3AF' : '#374151',
                boxShadow: depDropdownOpen ? '0 0 0 3px rgba(79,70,229,0.1)' : '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {(form.dependencies || []).length === 0 ? 'Select dependencies...' : `${(form.dependencies || []).length} tasks selected`}
              </span>
              <ChevronDown size={15} style={{ transform: depDropdownOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: '#6B7280' }} />
            </button>

            {depDropdownOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                backgroundColor: 'white', border: '1px solid #E5E7EB',
                borderRadius: '8px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                zIndex: 50, maxHeight: '250px', overflowY: 'auto', padding: '8px',
              }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 8px 8px' }}>Tasks</div>
                {allTasks.filter(t => t.id !== initialTask?.id).map(t => {
                  const isSelected = (form.dependencies || []).includes(t.id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => {
                        const current = form.dependencies || [];
                        if (isSelected) {
                          setForm({ ...form, dependencies: current.filter(id => id !== t.id) });
                        } else {
                          setForm({ ...form, dependencies: [...current, t.id] });
                        }
                      }}
                      style={{
                        padding: '8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '10px',
                        cursor: 'pointer', backgroundColor: isSelected ? '#EEF2FF' : 'transparent', transition: 'background-color 0.15s'
                      }}
                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'; }}
                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      <div style={{
                        width: '18px', height: '18px', borderRadius: '4px', border: `1.5px solid ${isSelected ? '#4F46E5' : '#D1D5DB'}`,
                        backgroundColor: isSelected ? '#4F46E5' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        {isSelected && <Check size={12} color="white" strokeWidth={3} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 500, color: isSelected ? '#3730A3' : '#374151' }}>{t.title}</div>
                      </div>
                    </div>
                  );
                })}
                {allTasks.filter(t => t.id !== initialTask?.id).length === 0 && (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#6B7280', fontSize: '0.8125rem' }}>No other tasks available.</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div>
            <label style={labelStyle}>Status {mandatoryStar}</label>
            <CustomSelect
              value={form.status || 'Todo'}
              onChange={val => setForm({ ...form, status: val })}
              options={[
                { value: 'Todo', label: 'Todo' },
                { value: 'In Progress', label: 'In Progress' },
                { value: 'Review', label: 'Review' },
                { value: 'Blocked', label: 'Blocked' },
                { value: 'Completed', label: 'Completed' },
              ]}
              buttonStyle={getValidationStyle(!!form.status)}
            />
          </div>
          <div>
            <label style={labelStyle}>Priority {mandatoryStar}</label>
            <CustomSelect
              value={form.priority}
              onChange={val => setForm({ ...form, priority: val })}
              placeholder="Select Priority..."
              options={[
                { value: 'Low', label: '🟢  Low' },
                { value: 'Medium', label: '🟡  Medium' },
                { value: 'High', label: '🔴  High' },
                { value: 'Critical', label: '🚨  Critical' },
              ]}
              buttonStyle={getValidationStyle(!!form.priority)}
            />
          </div>
        </div>

        {/* Hours */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Estimated Time {mandatoryStar}</label>
            <input
              type="text"
              style={getValidationStyle(!!form.estimatedHours && form.estimatedHours > 0)}
              value={estTimeInput}
              onChange={e => {
                const val = e.target.value;
                setEstTimeInput(val);
                const { hours } = parseEstimatedTime(val);
                setForm({ ...form, estimatedHours: hours });
              }}
              onBlur={() => {
                const { hours } = parseEstimatedTime(estTimeInput);
                setEstTimeInput(hours > 0 ? formatHours(hours) : '');
              }}
              placeholder="e.g. 1h 40m or 1.5"
            />
          </div>
          <div>
            <label style={labelStyle}>Logged Hours</label>
            <input
              type="number"
              min="0"
              step="0.25"
              style={inputStyle}
              value={form.actualHours}
              onChange={e => setForm({ ...form, actualHours: parseFloat(e.target.value) || 0 })}
              placeholder="e.g., 1.5"
            />
          </div>
        </div>

        {/* Dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Start Date {mandatoryStar}</label>
            <input
              type="date"
              style={getValidationStyle(!!form.startDate)}
              value={form.startDate}
              onChange={e => {
                setForm({ ...form, startDate: e.target.value });
                if (e.target.value && dueDateRef.current) {
                  dueDateRef.current.focus();
                }
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Due Date {mandatoryStar}</label>
            <input
              ref={dueDateRef}
              type="date"
              style={getValidationStyle(!!form.dueDate)}
              value={form.dueDate}
              onChange={e => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid #F3F4F6', marginTop: '4px' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '9px 18px', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', color: '#374151', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '9px 22px',
              background: loading ? '#A5B4FC' : 'linear-gradient(135deg, #4F46E5, #7C3AED)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 2px 8px rgba(79,70,229,0.35)',
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Saving…' : (initialTask && initialTask.id) ? '✓ Update Task' : '+ Create Task'}
          </button>
        </div>
      </form>

      {/* Checklist and Attachments (Only in Edit Mode) */}
      {initialTask && initialTask.id ? (
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '2px dashed #E5E7EB' }}>
          <TaskChecklist taskId={initialTask.id} />
          <TaskAttachments taskId={initialTask.id} />
        </div>
      ) : (
        <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '2px dashed #E5E7EB' }}>
          <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Paperclip size={16} color="#374151" /> 
            <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#374151' }}>Attachments</span>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            {pendingFiles.map((file, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '6px' }}>
                <span style={{ fontSize: '0.875rem', color: '#374151', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {file.name}
                </span>
                <button type="button" onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            width: '100%', padding: '12px', border: '2px dashed #D1D5DB', borderRadius: '8px',
            backgroundColor: '#F9FAFB', color: '#6B7280', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer'
          }}>
            <Paperclip size={18} />
            Add Attachments
            <input 
              type="file" 
              multiple 
              onChange={(e) => {
                if (e.target.files) {
                  setPendingFiles(prev => [...prev, ...Array.from(e.target.files as FileList)]);
                }
                e.target.value = '';
              }} 
              style={{ display: 'none' }} 
            />
          </label>
        </div>
      )}
    </div>
  );
};
