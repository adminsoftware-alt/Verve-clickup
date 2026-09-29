import React, { useEffect, useState } from 'react';
import { timeService, type TimeEntry } from '../services/timeService';
import { taskService, type Task } from '../services/taskService';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar as CalendarIcon, Clock, TrendingUp, Target, Zap, Download, Plus, Edit2, Trash2, Play, Square } from 'lucide-react';
import { useTimer } from '../context/TimerContext';
import { Link } from 'react-router-dom';
import { CustomSelect } from '../components/CustomSelect';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ask } from '../components/ask';

export const TimeEntries: React.FC = () => {
  const { timers, stopTimer, getLiveElapsedSeconds } = useTimer();
  const runningTimers = Object.entries(timers).filter(([_, t]) => t.startTime !== null);
  const primaryRunningTimer = runningTimers.length > 0 ? runningTimers[0] : null;
  const primaryTaskId = primaryRunningTimer ? primaryRunningTimer[0] : null;
  const primaryLiveSeconds = primaryTaskId ? getLiveElapsedSeconds(primaryTaskId) : 0;
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [tasks, setTasks] = useState<Record<string, Task>>({});
  const [loading, setLoading] = useState(true);
  
  const [taskFilter, setTaskFilter] = useState<string>('All');
  const [tagFilter, setTagFilter] = useState<string>('All');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 20;

  const fetchData = async () => {
    try {
      setLoading(true);
      const [entriesData, tasksData] = await Promise.all([
        timeService.getAllTimeEntries(),
        taskService.getTasks()
      ]);
      
      const sortedEntries = entriesData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setEntries(sortedEntries);
      
      const tasksMap: Record<string, Task> = {};
      tasksData.forEach(task => { tasksMap[task.id] = task; });
      setTasks(tasksMap);
    } catch (err) {
      console.error('Failed to load time entries', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const totalHours = entries.reduce((sum, e) => sum + e.hours_worked, 0);
  const dailyAverage = totalHours > 0 ? (totalHours / 7).toFixed(1) : '0';
  
  // Calculate real weekly data from entries (last 7 days)
  const today = new Date();
  const weekDataMap: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    weekDataMap[dayStr] = 0;
  }
  
  entries.forEach(e => {
    const d = new Date(e.date);
    const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
    if (weekDataMap[dayStr] !== undefined) {
      weekDataMap[dayStr] += e.hours_worked;
    }
  });

  const realWeeklyData = Object.keys(weekDataMap).map(day => ({
    day,
    hours: Number(weekDataMap[day].toFixed(1))
  }));

  const getTagColor = (title: string) => {
    if (title.toLowerCase().includes('design')) return { bg: '#F3E8FF', text: '#7E22CE', label: 'Design' };
    if (title.toLowerCase().includes('auth') || title.toLowerCase().includes('backend')) return { bg: '#D1FAE5', text: '#059669', label: 'Backend' };
    if (title.toLowerCase().includes('report') || title.toLowerCase().includes('analytics')) return { bg: '#FEF3C7', text: '#D97706', label: 'Data' };
    if (title.toLowerCase().includes('bug')) return { bg: '#DBEAFE', text: '#2563EB', label: 'Bug' };
    return { bg: '#F3F4F6', text: '#374151', label: 'General' };
  };

  const uniqueTaskIds = Array.from(new Set(entries.map(e => e.task_id)));
  const uniqueTags = Array.from(new Set(entries.map(e => getTagColor(tasks[e.task_id]?.title || '').label)));

  const filteredEntries = entries.filter(e => {
    const task = tasks[e.task_id];
    const taskTitle = task?.title || 'Unknown Task';
    const tagLabel = getTagColor(taskTitle).label;

    if (taskFilter !== 'All' && e.task_id !== taskFilter) return false;
    if (tagFilter !== 'All' && tagLabel !== tagFilter) return false;
    return true;
  });

  const paginatedEntries = filteredEntries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalPages = Math.ceil(filteredEntries.length / pageSize);

  const handleExportCSV = () => {
    if (filteredEntries.length === 0) return;
    const headers = ['Task', 'Description', 'Date', 'Start Time', 'End Time', 'Duration', 'Tag', 'Notes'];
    const rows = filteredEntries.map(entry => {
      const task = tasks[entry.task_id];
      const taskTitle = task?.title || 'Unknown Task';
      const description = task?.description || '';
      return [
        taskTitle,
        description,
        new Date(entry.date).toLocaleDateString(),
        '--:--',
        '--:--',
        `${entry.hours_worked}h`,
        getTagColor(taskTitle).label,
        entry.notes || ''
      ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
    });
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "time_entries.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  };

  const handleExportPDF = () => {
    if (filteredEntries.length === 0) return;
    const doc = new jsPDF();
    doc.text("Time Entries Report", 14, 15);
    const tableColumn = ["Task", "Date", "Duration", "Tag", "Notes"];
    const tableRows: string[][] = [];
    filteredEntries.forEach(entry => {
      const task = tasks[entry.task_id];
      const taskTitle = task?.title || 'Unknown Task';
      tableRows.push([
        taskTitle,
        new Date(entry.date).toLocaleDateString(),
        `${entry.hours_worked}h`,
        getTagColor(taskTitle).label,
        entry.notes || '-'
      ]);
    });
    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20
    });
    doc.save("time_entries.pdf");
    setShowExportMenu(false);
  };

  const filterSelectStyle = {
    padding: '6px 12px',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    backgroundColor: '#FFFFFF',
    fontSize: '0.8125rem',
    color: '#374151',
    fontWeight: 500,
    outline: 'none',
    cursor: 'pointer'
  };

  // Compute "Last 7 Days" string dynamically
  const endDateStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 6);
  const startDateStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const dateRangeString = `${startDateStr} - ${endDateStr}`;

  if (loading) return <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280' }}>Loading time entries...</div>;

  return (
    <div style={{ display: 'flex', gap: '24px', maxWidth: '1600px', margin: '0 auto' }}>
      
      {/* Left Main Column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 4px 0', color: '#111827' }}>Time Tracking</h1>
            <p style={{ color: '#6B7280', fontSize: '0.8125rem', margin: 0 }}>Analyze your productivity and logged hours.</p>
          </div>
          <Link to="/tasks" style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#4F46E5', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '0.8125rem', fontWeight: 500, color: '#FFFFFF', cursor: 'pointer', textDecoration: 'none' }}>
            <Play size={14} /> Start Timer
          </Link>
        </div>

        {/* Filter Bar */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#FFFFFF', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', gap: '8px' }}>
            <CalendarIcon size={14} color="#6B7280" />
            <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#374151' }}>{dateRangeString}</span>
          </div>
          
          <CustomSelect 
            value={taskFilter} 
            onChange={setTaskFilter} 
            options={[
              {value: 'All', label: 'All Tasks'},
              ...uniqueTaskIds.map(tid => ({ value: tid, label: tasks[tid]?.title || 'Unknown Task' }))
            ]} 
            buttonStyle={filterSelectStyle} 
          />
          
          <CustomSelect 
            value={tagFilter} 
            onChange={setTagFilter} 
            options={[
              {value: 'All', label: 'All Tags'},
              ...uniqueTags.map(tag => ({ value: tag, label: tag }))
            ]} 
            buttonStyle={filterSelectStyle} 
          />
          
          {(taskFilter !== 'All' || tagFilter !== 'All') && (
            <button 
              onClick={() => { setTaskFilter('All'); setTagFilter('All'); }}
              style={{ display: 'flex', alignItems: 'center', backgroundColor: '#FFFFFF', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--color-border)', cursor: 'pointer', gap: '6px', color: '#DC2626', fontSize: '0.8125rem', fontWeight: 500 }}
            >
              Clear Filters
            </button>
          )}
        </div>

        {/* Stat Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ backgroundColor: '#EEF2FF', padding: '6px', borderRadius: '6px', color: '#4F46E5' }}><Clock size={16} /></div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Total Logged</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>{totalHours.toFixed(1)}h</div>
              </div>
            </div>
          </div>
          
          <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ backgroundColor: '#ECFDF5', padding: '6px', borderRadius: '6px', color: '#059669' }}><CalendarIcon size={16} /></div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Daily Average</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>{dailyAverage}h</div>
              </div>
            </div>
          </div>
          
          <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ backgroundColor: '#FFFBEB', padding: '6px', borderRadius: '6px', color: '#D97706' }}><Target size={16} /></div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Goal Progress</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>80%</div>
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <div style={{ backgroundColor: '#FEF2F2', padding: '6px', borderRadius: '6px', color: '#DC2626' }}><Zap size={16} /></div>
              <div>
                <div style={{ fontSize: '0.65rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Longest Streak</div>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>12 days</div>
              </div>
            </div>
          </div>
        </div>

        {/* Entries Table */}
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827' }}>Time Entries</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ position: 'relative' }}>
                <button 
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#FFFFFF', border: '1px solid var(--color-border)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.75rem', fontWeight: 500, color: '#374151', cursor: 'pointer' }}
                >
                  <Download size={14} /> Export
                </button>
                {showExportMenu && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '4px', backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: '6px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', zIndex: 10 }}>
                    <button onClick={handleExportCSV} style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', border: 'none', background: 'none', fontSize: '0.875rem', color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Export as CSV
                    </button>
                    <button onClick={handleExportPDF} style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', border: 'none', background: 'none', fontSize: '0.875rem', color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Export as PDF
                    </button>
                  </div>
                )}
              </div>
              <Link to="/tasks" style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: '#4F46E5', border: 'none', borderRadius: '6px', padding: '4px 8px', fontSize: '0.75rem', fontWeight: 500, color: '#FFFFFF', cursor: 'pointer', textDecoration: 'none' }}>
                <Plus size={14} /> Add Time
              </Link>
            </div>
          </div>
          
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Task / Description</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Start Time</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>End Time</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Duration</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Tag</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Notes</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedEntries.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>No time entries found.</td></tr>
                ) : paginatedEntries.map(entry => {
                  const task = tasks[entry.task_id];
                  const taskTitle = task?.title || 'Unknown Task';
                  const tColor = getTagColor(taskTitle);
                  
                  return (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: tColor.text, marginTop: '6px' }}></div>
                          <div>
                            <div style={{ fontWeight: 600, color: '#111827', marginBottom: '2px', fontSize: '0.8125rem' }}>{taskTitle}</div>
                            <div style={{ fontSize: '0.7rem', color: '#6B7280' }}>{task?.description || 'Worked on task'}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#4B5563', fontSize: '0.8125rem' }}>{entry.date}</td>
                      <td style={{ padding: '8px 12px', color: '#4B5563', fontSize: '0.8125rem' }}>09:00 AM</td>
                      <td style={{ padding: '8px 12px', color: '#4B5563', fontSize: '0.8125rem' }}>
                        {(() => {
                          const startHour = 9;
                          const startMinutes = 0;
                          const totalMinutes = Math.round(entry.hours_worked * 60);
                          const endHourRaw = startHour + Math.floor((startMinutes + totalMinutes) / 60);
                          const endMins = (startMinutes + totalMinutes) % 60;
                          const endAmPm = endHourRaw >= 12 ? 'PM' : 'AM';
                          const endHour = endHourRaw > 12 ? endHourRaw - 12 : endHourRaw === 0 ? 12 : endHourRaw;
                          return `${endHour}:${endMins.toString().padStart(2, '0')} ${endAmPm}`;
                        })()}
                      </td>
                      <td style={{ padding: '8px 12px', color: '#111827', fontWeight: 600, fontSize: '0.8125rem' }}>
                        {Math.floor(entry.hours_worked)}h {Math.round((entry.hours_worked % 1) * 60)}m
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{ backgroundColor: tColor.bg, color: tColor.text, padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase' }}>
                          {tColor.label}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', color: '#6B7280', fontSize: '0.75rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.notes || '-'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                          <Edit2 size={14} color="#6B7280" style={{ cursor: 'pointer' }} />
                          <Trash2 size={14} color="#EF4444" style={{ cursor: 'pointer' }} onClick={async () => {
                            if(await ask.confirm({ danger: true, title: 'Delete entry?' })) {
                              await timeService.deleteTimeEntry(entry.id);
                              setEntries(prev => prev.filter(e => e.id !== entry.id));
                            }
                          }}/>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.8125rem', color: '#6B7280' }}>
              Showing {filteredEntries.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, filteredEntries.length)} of {filteredEntries.length} entries
            </div>
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--color-border)', backgroundColor: '#FFFFFF', color: '#6B7280', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>&lt;</button>
                <button style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: 'none', backgroundColor: '#4F46E5', color: '#FFFFFF', fontWeight: 600 }}>{currentPage}</button>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '4px', border: '1px solid var(--color-border)', backgroundColor: '#FFFFFF', color: '#6B7280', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>&gt;</button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Right Sidebar Column */}
      <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '24px', flexShrink: 0 }}>
        
        {/* Active Time Tracker */}
        <div style={{ backgroundColor: '#FFFFFF', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827' }}>Time Tracker</h3>
            {primaryTaskId ? (
              <span style={{ backgroundColor: '#ECFDF5', color: '#059669', padding: '2px 6px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                <div style={{ width: '6px', height: '6px', backgroundColor: '#059669', borderRadius: '50%', animation: 'pulse 2s infinite' }}></div> Running
              </span>
            ) : (
              <span style={{ backgroundColor: '#F3F4F6', color: '#6B7280', padding: '2px 6px', borderRadius: '12px', fontSize: '0.65rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase' }}>
                <div style={{ width: '6px', height: '6px', backgroundColor: '#9CA3AF', borderRadius: '50%' }}></div> Idle
              </span>
            )}
          </div>
          
          {primaryTaskId ? (
            <>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827', marginBottom: '2px' }}>{tasks[primaryTaskId]?.title || 'Unknown Task'}</div>
                <div style={{ fontSize: '0.7rem', color: '#6B7280' }}>{tasks[primaryTaskId]?.description || 'Working on this task'}</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', lineHeight: 1 }}>
                    {String(Math.floor(primaryLiveSeconds / 3600)).padStart(2, '0')}:
                    {String(Math.floor((primaryLiveSeconds % 3600) / 60)).padStart(2, '0')}:
                    {String(primaryLiveSeconds % 60).padStart(2, '0')}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '6px' }}>Tracking time...</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => stopTimer(primaryTaskId)} style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#FEF2F2', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', cursor: 'pointer' }}>
                    <Square size={14} fill="currentColor" />
                  </button>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link to="/tasks" style={{ fontSize: '0.75rem', color: '#4F46E5', fontWeight: 500, cursor: 'pointer', textDecoration: 'none' }}>View Task Board</Link>
                <span style={{ color: '#4F46E5' }}>→</span>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: '0.8125rem', color: '#6B7280', marginBottom: '12px' }}>No active timer running.</div>
              <Link to="/tasks" style={{ display: 'inline-block', backgroundColor: '#EEF2FF', color: '#4F46E5', padding: '6px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none' }}>
                Go to Tasks to Start
              </Link>
            </div>
          )}
        </div>

        {/* Weekly Overview Chart */}
        <div style={{ backgroundColor: '#FFFFFF', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827' }}>Weekly Overview</h3>
            <span style={{ fontSize: '0.75rem', color: '#6B7280', cursor: 'pointer' }}>Last 7 Days ▼</span>
          </div>
          <div style={{ height: '140px', width: '100%', marginBottom: '12px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={realWeeklyData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                <Tooltip cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                <Bar dataKey="hours" fill="#4F46E5" radius={[4, 4, 4, 4]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.75rem', color: '#4B5563' }}>
            <div style={{ width: '8px', height: '8px', backgroundColor: '#4F46E5', borderRadius: '2px' }}></div> Logged Hours
          </div>
        </div>

        {/* Time Summary */}
        <div style={{ backgroundColor: '#FFFFFF', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827' }}>Time Summary</h3>
            <span style={{ fontSize: '0.75rem', color: '#6B7280', cursor: 'pointer' }}>All Time ▼</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ backgroundColor: '#EEF2FF', padding: '6px', borderRadius: '6px', color: '#4F46E5' }}><Clock size={14} /></div>
                <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>Total Logged Hours</span>
              </div>
              <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 600 }}>{totalHours.toFixed(1)}h</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ backgroundColor: '#ECFDF5', padding: '6px', borderRadius: '6px', color: '#059669' }}><CalendarIcon size={14} /></div>
                <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>Focused Work</span>
              </div>
              <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 600 }}>{(totalHours * 0.6).toFixed(1)}h</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ backgroundColor: '#FFFBEB', padding: '6px', borderRadius: '6px', color: '#D97706' }}><Target size={14} /></div>
                <span style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500 }}>Meetings & Admin</span>
              </div>
              <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 600 }}>{(totalHours * 0.4).toFixed(1)}h</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ backgroundColor: '#EEF2FF', padding: '4px', borderRadius: '4px', color: '#4F46E5' }}><TrendingUp size={12} /></div>
                <span style={{ fontSize: '0.8125rem', color: '#374151', fontWeight: 500 }}>Daily Average</span>
              </div>
              <span style={{ fontSize: '0.875rem', color: '#111827', fontWeight: 600 }}>{dailyAverage}h</span>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div style={{ backgroundColor: '#FFFFFF', padding: '16px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827' }}>Recent Activity</h3>
            <span style={{ fontSize: '0.75rem', color: '#4F46E5', fontWeight: 500, cursor: 'pointer' }}>View All</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#ECFDF5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Play size={12} fill="currentColor" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>Started tracking time</div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>Implement Authentication</div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>01:00 PM</div>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#FEF2F2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Square size={12} fill="currentColor" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>Stopped tracking time</div>
                <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>Design Dashboard UI</div>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>12:00 PM</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
