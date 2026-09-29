import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardService, type DashboardMetrics } from '../services/dashboardService';
import { taskService, type Task } from '../services/taskService';
import { timeService, type TimeEntry } from '../services/timeService';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Sector, BarChart, Bar, XAxis, ComposedChart, Line, YAxis, CartesianGrid, Legend } from 'recharts';
import { ClipboardList, Clock, Activity, Users, Shield, Briefcase, AlertTriangle, CheckCircle2, TrendingUp, BellRing, ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import { adminService } from '../services/adminService';
import { TimesheetGrid } from '../components/TimesheetGrid';
import { useAuth } from '../components/AuthContext';

export const Dashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePieIndex, setActivePieIndex] = useState<number | undefined>(undefined);
  const [weekOffset, setWeekOffset] = useState(0);
  const [overduePage, setOverduePage] = useState(1);
  const [overallPage, setOverallPage] = useState(1);
  const [kpiTimeframe, setKpiTimeframe] = useState('Current Week');
  const navigate = useNavigate();
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole(['Admin']);
  const isManager = hasRole(['Manager']);

  useEffect(() => {
    let isFetching = false;
    const fetchData = async (silent = false) => {
      if (isFetching) return;
      isFetching = true;
      try {
        const [dashboardData, tasksData, entriesData] = await Promise.all([
          dashboardService.getMetrics(),
          taskService.getTasks(),
          timeService.getAllTimeEntries()
        ]);
        setMetrics(dashboardData);
        setTasks(tasksData);
        setTimeEntries(entriesData);
      } catch (err) {
        if (!silent) setError("Failed to connect to the backend server.");
      } finally {
        if (!silent) setLoading(false);
        isFetching = false;
      }
    };
    fetchData();
    const handleTimeEntryAdded = () => fetchData(false);
    window.addEventListener('timeEntryAdded', handleTimeEntryAdded);
    
    // Background polling for real-time manager updates
    const interval = setInterval(() => {
      fetchData(true);
    }, 10000);

    return () => {
      window.removeEventListener('timeEntryAdded', handleTimeEntryAdded);
      clearInterval(interval);
    };
  }, []);

  const [nagging, setNagging] = useState(false);
  const handleNag = async () => {
    setNagging(true);
    try {
      const res = await adminService.nagTimesheets();
      alert(`Successfully nagged ${res.nagged_users_count || 0} users!`);
    } catch (e: any) {
      alert(e.message || "Failed to trigger nagging");
    } finally {
      setNagging(false);
    }
  };

  if (loading) return <div style={{ padding: 'var(--spacing-8)' }}>Loading your dashboard...</div>;
  if (error || !metrics) return <div style={{ padding: 'var(--spacing-8)', color: 'var(--color-error)' }}>{error || 'Failed to load'}</div>;

  // Filter for KPI cards
  const now = new Date();
  let kpiStartDate = new Date(0);
  let kpiEndDate = new Date('9999-12-31');

  if (kpiTimeframe === 'Current Week') {
    const currentDay = now.getDay() || 7;
    kpiStartDate = new Date(now);
    kpiStartDate.setDate(now.getDate() - currentDay + 1);
    kpiStartDate.setHours(0,0,0,0);
    kpiEndDate = new Date(kpiStartDate);
    kpiEndDate.setDate(kpiStartDate.getDate() + 6);
    kpiEndDate.setHours(23,59,59,999);
  } else if (kpiTimeframe === 'Last Week') {
    const currentDay = now.getDay() || 7;
    kpiStartDate = new Date(now);
    kpiStartDate.setDate(now.getDate() - currentDay - 6);
    kpiStartDate.setHours(0,0,0,0);
    kpiEndDate = new Date(kpiStartDate);
    kpiEndDate.setDate(kpiStartDate.getDate() + 6);
    kpiEndDate.setHours(23,59,59,999);
  } else if (kpiTimeframe === 'This Month') {
    kpiStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    kpiEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  const filteredKpiTasks = tasks.filter(t => {
    if (kpiTimeframe === 'All Time') return true;
    if (!t.dueDate) return false;
    const d = new Date(t.dueDate);
    return d >= kpiStartDate && d <= kpiEndDate;
  });

  const filteredKpiEntries = timeEntries.filter(e => {
    if (kpiTimeframe === 'All Time') return true;
    const d = new Date(e.date);
    return d >= kpiStartDate && d <= kpiEndDate;
  });

  const totalTasks = filteredKpiTasks.length;
  const plannedHoursTotal = filteredKpiTasks.reduce((acc, t) => acc + (Number(t.estimatedHours) || 0), 0);
  const plannedHours = parseFloat(plannedHoursTotal.toFixed(2));
  
  const loggedHoursTotal = filteredKpiEntries.reduce((acc, e) => acc + (Number(e.hours_worked) || 0), 0);
  const loggedHours = parseFloat(loggedHoursTotal.toFixed(2));
  
  let capacityBase = Number(metrics.weekly_capacity) || 40;
  if (kpiTimeframe === 'This Month') capacityBase = capacityBase * 4;
  
  const remainingCapacity = kpiTimeframe === 'All Time' ? 0 : parseFloat(Math.max(capacityBase - loggedHoursTotal, 0).toFixed(2));
  


  // Banner Styles
  const bannerStyle = { backgroundColor: '#FEF3C7', padding: '16px', borderRadius: '8px', border: '1px solid #FDE68A', marginBottom: '24px', color: '#92400E', fontSize: '0.875rem', fontWeight: 500 };
  const cardStyle = { backgroundColor: 'var(--color-surface)', padding: 'var(--spacing-5)', borderRadius: 'var(--radius-xl)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' as const };
  const headerStyle = { fontSize: '0.875rem', fontWeight: 600, borderBottom: '1px solid var(--color-border)', paddingBottom: '12px', marginBottom: '16px' };
  
  // Data calculations
  const todayStr = new Date().toISOString().split('T')[0];
  const overdueTasks = tasks.filter(t => t.status !== 'Completed' && t.dueDate && t.dueDate < todayStr);
  const unassignedTasks = tasks.filter(t => !t.projectId); // Mocking unassigned as no project for now
  
  const statusCounts = { 'Todo': 0, 'In Progress': 0, 'Review': 0, 'Completed': 0 };
  tasks.forEach(t => { if (t.status in statusCounts) statusCounts[t.status as keyof typeof statusCounts]++; });
  const pieData = Object.entries(statusCounts)
    .filter(([_,v]) => v>0)
    .map(([name, value]) => {
      let displayName = name.toUpperCase();
      if (name === 'Review') displayName = 'PENDING FROM REVIEWER';
      if (name === 'Todo') displayName = 'TO DO';
      return { name: displayName, value };
    });
    
  const getStatusChartColor = (name: string) => {
    switch(name) {
      case 'IN PROGRESS': return '#6366f1';
      case 'TO DO': return '#8c92a1';
      case 'PENDING FROM REVIEWER': return '#a78bfa';
      case 'COMPLETED': return '#10b981';
      default: return '#9ca3af';
    }
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'Completed': return '#10B981';
      case 'In Progress': return '#3B82F6';
      case 'Review': return '#8B5CF6';
      default: return '#9CA3AF';
    }
  };

  const EmptyState = ({ message = "No Results" }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-secondary)', fontSize: '0.875rem', padding: '24px 0' }}>{message}</div>
  );

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
    return (
      <g>
        <Sector
          cx={cx}
          cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 10}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    );
  };

  const renderCustomizedLabel = (props: any) => {
    const { cx, cy, midAngle, outerRadius, value, name } = props;
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 20;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    
    // Draw a line from the pie to the label
    const lineX = cx + (outerRadius + 10) * Math.cos(-midAngle * RADIAN);
    const lineY = cy + (outerRadius + 10) * Math.sin(-midAngle * RADIAN);
    
    return (
      <g>
        <polyline points={`${cx + outerRadius * Math.cos(-midAngle * RADIAN)},${cy + outerRadius * Math.sin(-midAngle * RADIAN)} ${lineX},${lineY} ${x},${lineY}`} stroke="#9ca3af" fill="none" />
        <text 
          x={x + (x > cx ? 5 : -5)} 
          y={lineY} 
          fill="#374151" 
          textAnchor={x > cx ? 'start' : 'end'} 
          dominantBaseline="central"
          fontSize="10px"
          fontWeight="700"
        >
          {name} <span style={{ fontWeight: 'normal' }}>{value}</span>
        </text>
      </g>
    );
  };

  // Priority breakdown for charts
  const priorityCounts = { 'Low': 0, 'Medium': 0, 'High': 0, 'Critical': 0 };
  tasks.forEach(t => { if (t.priority in priorityCounts) priorityCounts[t.priority as keyof typeof priorityCounts]++; });
  const priorityData = Object.entries(priorityCounts).filter(([_,v]) => v > 0).map(([name, value]) => ({ name, value }));
  const priorityColors: Record<string, string> = { Low: '#6B7280', Medium: '#3B82F6', High: '#F59E0B', Critical: '#EF4444' };

  // Weekly completion data
  const weekDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  
  const today = new Date();
  today.setHours(0,0,0,0);
  const currentDay = today.getDay() || 7;
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - currentDay + 1 + (weekOffset * 7));
  
  const weeklyCompletionData = weekDays.map((day, index) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + index);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${dayOfMonth}`;
    
    const added = tasks.filter(t => (t.startDate === dateStr) || (!t.startDate && t.dueDate === dateStr)).length;
    const completed = tasks.filter(t => t.status === 'Completed' && (t.completedDate === dateStr || (!t.completedDate && t.dueDate === dateStr))).length;
    
    const completionRate = added > 0 ? Math.round((completed / added) * 100) : 0;
    
    return {
      day,
      date: dateStr,
      added,
      completed,
      completionRate
    };
  });

  const completedTasks = tasks.filter(t => t.status === 'Completed').length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const todayTasks = tasks.filter(t => t.dueDate === todayStr);
  const inProgressTasks = tasks.filter(t => t.status === 'In Progress');

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const roleLabel = isAdmin ? 'Administrator' : isManager ? 'Manager' : 'Employee';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}>
      
      {/* Role-Aware Greeting Banner */}
      <div style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', borderRadius: '16px', padding: '24px 28px', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 700, margin: 0 }}>{greeting}, {displayName}! 👋</h1>
            <p style={{ fontSize: '0.875rem', opacity: 0.85, marginTop: '4px' }}>
              {isAdmin ? 'Organization-wide overview of all teams and projects' :
               isManager ? 'Your team performance and project status' :
               'Your personal tasks, deadlines, and productivity'}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {(isAdmin || isManager) && (
              <button 
                onClick={handleNag}
                disabled={nagging}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.9)', color: '#4F46E5', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
              >
                <BellRing size={14} />
                {nagging ? 'Triggering...' : 'Trigger Daily Nag'}
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: '8px', backdropFilter: 'blur(10px)' }}>
              <Shield size={14} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{roleLabel}</span>
            </div>
          </div>
        </div>

        {/* Quick Stats Row inside banner */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '20px' }}>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: '0.7rem', opacity: 0.8, fontWeight: 600, textTransform: 'uppercase' }}>Total Tasks</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px' }}>{totalTasks}</div>
          </div>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: '0.7rem', opacity: 0.8, fontWeight: 600, textTransform: 'uppercase' }}>Completion Rate</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px' }}>{completionRate}%</div>
          </div>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: '0.7rem', opacity: 0.8, fontWeight: 600, textTransform: 'uppercase' }}>Overdue</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px', color: overdueTasks.length > 0 ? '#FCA5A5' : 'inherit' }}>{overdueTasks.length}</div>
          </div>
          <div style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: '10px', padding: '14px', backdropFilter: 'blur(10px)' }}>
            <div style={{ fontSize: '0.7rem', opacity: 0.8, fontWeight: 600, textTransform: 'uppercase' }}>Logged Hours</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '4px' }}>{loggedHours}h</div>
          </div>
        </div>
      </div>

      {/* Role-Specific Quick Insights */}
      {(isAdmin || isManager) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ backgroundColor: '#EEF2FF', padding: '10px', borderRadius: '10px' }}><Users size={20} color="#4F46E5" /></div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>{isAdmin ? 'Active Teams' : 'My Team Members'}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{isAdmin ? '2' : '16'}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Managed from the Teams page</p>
          </div>

          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ backgroundColor: '#ECFDF5', padding: '10px', borderRadius: '10px' }}><Briefcase size={20} color="#059669" /></div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>In Progress</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{inProgressTasks.length}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Tasks currently being worked on</p>
          </div>

          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ backgroundColor: '#FEF3C7', padding: '10px', borderRadius: '10px' }}><AlertTriangle size={20} color="#D97706" /></div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase' }}>Due Today</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{todayTasks.length}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Tasks with today's deadline</p>
          </div>
        </div>
      )}

      {/* Priority Breakdown + Weekly Chart Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <TrendingUp size={16} color="#4F46E5" /> Priority Breakdown
          </div>
          <div style={{ height: '180px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {priorityData.map((entry, i) => <Cell key={i} fill={priorityColors[entry.name] || '#9CA3AF'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={16} color="#059669" /> Weekly Task Progress
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}><ChevronLeft size={16} /></button>
              <span style={{ fontSize: '0.75rem', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Calendar size={14} />
                {weekOffset === 0 ? 'Current Week' : weekOffset === -1 ? 'Previous Week' : weekOffset === 1 ? 'Next Week' : `${Math.abs(weekOffset)} Weeks ${weekOffset < 0 ? 'Ago' : 'Ahead'}`}
              </span>
              <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}><ChevronRight size={16} /></button>
            </div>
          </div>
          <div style={{ height: '180px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weeklyCompletionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(val) => `${val}%`} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', padding: '6px 10px', fontSize: '0.75rem' }} itemStyle={{ padding: '2px 0' }} labelStyle={{ marginBottom: '4px', fontWeight: 600, color: '#374151' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Bar yAxisId="left" dataKey="added" name="Added Tasks" fill="#9CA3AF" radius={[4, 4, 0, 0]} barSize={20} />
                <Bar yAxisId="left" dataKey="completed" name="Completed Tasks" fill="#10B981" radius={[4, 4, 0, 0]} barSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="completionRate" name="Completion Rate (%)" stroke="#4F46E5" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      {/* Timeframe selector and Top Cards */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Workload Metrics</h2>
          <select 
            value={kpiTimeframe} 
            onChange={(e) => setKpiTimeframe(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', outline: 'none', backgroundColor: 'white' }}
          >
            <option value="Current Week">Current Week</option>
            <option value="Last Week">Last Week</option>
            <option value="This Month">This Month</option>
            <option value="All Time">All Time</option>
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--spacing-4)' }}>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: 'var(--color-primary-light)', padding: '10px', borderRadius: '12px' }}><ClipboardList size={20} color="var(--color-primary)" /></div>
            <div><div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Total Tasks</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{totalTasks}</div></div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#D1FAE5', padding: '10px', borderRadius: '12px' }}><Clock size={20} color="#10B981" /></div>
            <div><div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Planned Hours</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{plannedHours}h</div></div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#FEF3C7', padding: '10px', borderRadius: '12px' }}><Clock size={20} color="#F59E0B" /></div>
            <div><div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Logged Hours</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{loggedHours}h</div></div>
          </div>
        </div>
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ backgroundColor: '#F3E8FF', padding: '10px', borderRadius: '12px' }}><Activity size={20} color="#9333EA" /></div>
            <div><div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Remaining Capacity</div><div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{remainingCapacity}h</div></div>
          </div>
        </div>
        </div>
      </div>

      {/* General Overview Banner */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 8px 0' }}>General Overview</h2>
        <div style={bannerStyle}>👋 This will help to understand the totality of the work that a person has</div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.5fr', gap: 'var(--spacing-4)' }}>
          {/* Total Tasks Box */}
          <div style={{ ...cardStyle, justifyContent: 'center', alignItems: 'center' }}>
            <div style={{...headerStyle, width: '100%'}}>Total Tasks</div>
            {/* The count of everything, to match the list of everything beside it. It used to
                show the KPI figure, which is narrowed to the chosen timeframe -- so this box
                read 0 while Overall Tasks listed five tasks, which is not a number anyone can
                make sense of. The timeframe figure is still on the KPI row above. */}
            <div style={{ fontSize: '5rem', fontWeight: 400, color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{tasks.length}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textAlign: 'center', paddingBottom: '8px' }}>
              {completedTasks} completed · {tasks.length - completedTasks} open
            </div>
          </div>
          
          {/* Overall Tasks List */}
          <div style={cardStyle}>
            <div style={{ ...headerStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>✅ Overall Tasks</span>
              {tasks.length > 5 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    onClick={() => setOverallPage(p => Math.max(1, p - 1))}
                    disabled={overallPage === 1}
                    style={{ background: 'none', border: 'none', cursor: overallPage === 1 ? 'not-allowed' : 'pointer', color: overallPage === 1 ? '#D1D5DB' : '#6B7280', display: 'flex', padding: 0 }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 'normal' }}>
                    {overallPage} / {Math.ceil(tasks.length / 5)}
                  </span>
                  <button 
                    onClick={() => setOverallPage(p => Math.min(Math.ceil(tasks.length / 5), p + 1))}
                    disabled={overallPage === Math.ceil(tasks.length / 5)}
                    style={{ background: 'none', border: 'none', cursor: overallPage === Math.ceil(tasks.length / 5) ? 'not-allowed' : 'pointer', color: overallPage === Math.ceil(tasks.length / 5) ? '#D1D5DB' : '#6B7280', display: 'flex', padding: 0 }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            {tasks.length === 0 ? <EmptyState /> : tasks.slice((overallPage - 1) * 5, overallPage * 5).map(t => (
              <div 
                key={t.id} 
                onClick={() => navigate(`/tasks?taskId=${t.id}`)}
                style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '12px 0', fontSize: '0.75rem', cursor: 'pointer', transition: 'background-color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F3F4F6')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ fontWeight: 500 }}>{t.title}</span>
                <span style={{ color: getStatusColor(t.status), fontWeight: 600, backgroundColor: 'var(--color-background)', padding: '2px 8px', borderRadius: '4px' }}>{t.status}</span>
                <span>{t.dueDate || '-'}</span>
              </div>
            ))}
          </div>

          {/* Workload by Status Pie */}
          <div style={cardStyle}>
            <div style={headerStyle}>Workload by Status</div>
            <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={pieData} 
                    cx="50%" 
                    cy="50%" 
                    innerRadius={0} 
                    outerRadius={65} 
                    paddingAngle={0} 
                    dataKey="value" 
                    stroke="#ffffff"
                    strokeWidth={2}
                    activeIndex={activePieIndex}
                    activeShape={renderActiveShape}
                    onMouseEnter={(_, index) => setActivePieIndex(index)}
                    onMouseLeave={() => setActivePieIndex(undefined)}
                    label={renderCustomizedLabel}
                    labelLine={false}
                  >
                    {pieData.map((entry, i) => <Cell key={i} fill={getStatusChartColor(entry.name)} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Overview Banner */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 8px 0', marginTop: '16px' }}>Daily Overview</h2>
        <div style={{ ...bannerStyle, backgroundColor: '#F9FAFB', color: '#374151', border: '1px solid #E5E7EB' }}>This will help to understand the totality of the work that a person has TODAY.</div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div style={cardStyle}>
            <div style={headerStyle}>Work Done today</div>
            {timeEntries.filter(e => e.date === todayStr).length === 0 ? <EmptyState message="No time logged today yet" /> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {timeEntries.filter(e => e.date === todayStr).map(entry => {
                  const task = tasks.find(t => t.id === entry.task_id);
                  return (
                    <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '8px', backgroundColor: '#F9FAFB' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{task?.title || 'Unknown Task'}</div>
                        {entry.notes && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>{entry.notes}</div>}
                      </div>
                      <div style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{entry.hours_worked}h</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ padding: '24px 0' }}>
            <TimesheetGrid />
          </div>
        </div>
      </div>

      {/* Status Wise Task Overview */}
      <div>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 8px 0', marginTop: '16px' }}>Status Wise Task Overview</h2>
        <div style={{ ...bannerStyle, backgroundColor: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA' }}>👍 This will help to understand the different status of the overall work.</div>
        


        {/* Overdue */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 3.5fr', gap: 'var(--spacing-4)', marginBottom: 'var(--spacing-4)' }}>
          <div style={{ ...cardStyle, justifyContent: 'center', alignItems: 'center' }}>
            <div style={{...headerStyle, width: '100%'}}>Overdue Tasks</div>
            <div style={{ fontSize: '5rem', fontWeight: 400, color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{overdueTasks.length}</div>
          </div>
          <div style={cardStyle}>
            <div style={{ ...headerStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Overdue Tasks</span>
              {overdueTasks.length > 5 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button 
                    onClick={() => setOverduePage(p => Math.max(1, p - 1))}
                    disabled={overduePage === 1}
                    style={{ background: 'none', border: 'none', cursor: overduePage === 1 ? 'not-allowed' : 'pointer', color: overduePage === 1 ? '#D1D5DB' : '#6B7280', display: 'flex', padding: 0 }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 'normal' }}>
                    {overduePage} / {Math.ceil(overdueTasks.length / 5)}
                  </span>
                  <button 
                    onClick={() => setOverduePage(p => Math.min(Math.ceil(overdueTasks.length / 5), p + 1))}
                    disabled={overduePage === Math.ceil(overdueTasks.length / 5)}
                    style={{ background: 'none', border: 'none', cursor: overduePage === Math.ceil(overdueTasks.length / 5) ? 'not-allowed' : 'pointer', color: overduePage === Math.ceil(overdueTasks.length / 5) ? '#D1D5DB' : '#6B7280', display: 'flex', padding: 0 }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
            {overdueTasks.length === 0 ? <EmptyState /> : overdueTasks.slice((overduePage - 1) * 5, overduePage * 5).map(t => (
              <div 
                key={t.id} 
                onClick={() => navigate(`/tasks?taskId=${t.id}`)}
                style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '12px 0', fontSize: '0.75rem', cursor: 'pointer', transition: 'background-color 0.2s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F3F4F6')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ fontWeight: 500, flex: 2 }}>{t.title}</span>
                <span style={{ flex: 1, color: getStatusColor(t.status), fontWeight: 600, backgroundColor: 'var(--color-background)', padding: '2px 8px', borderRadius: '4px' }}>{t.status}</span>
                <span style={{ flex: 1, color: 'var(--color-error)' }}>{t.dueDate}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Unassigned */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 3.5fr', gap: 'var(--spacing-4)', marginBottom: 'var(--spacing-4)' }}>
          <div style={{ ...cardStyle, justifyContent: 'center', alignItems: 'center' }}>
            <div style={{...headerStyle, width: '100%'}}>Unassigned Tasks</div>
            <div style={{ fontSize: '5rem', fontWeight: 400, color: '#111827', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{unassignedTasks.length}</div>
          </div>
          <div style={cardStyle}>
            <div style={headerStyle}>Unassigned Tasks</div>
            {unassignedTasks.length === 0 ? <EmptyState /> : unassignedTasks.map(t => (
               <div 
                 key={t.id} 
                 onClick={() => navigate(`/tasks?taskId=${t.id}`)}
                 style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', padding: '12px 0', fontSize: '0.75rem', cursor: 'pointer', transition: 'background-color 0.2s' }}
                 onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#F3F4F6')}
                 onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
               >
                 <span style={{ fontWeight: 500, flex: 2 }}>{t.title}</span>
                 <span style={{ flex: 1 }}>{t.dueDate || '-'}</span>
               </div>
            ))}
          </div>
        </div>


      </div>

    </div>
  );
};
