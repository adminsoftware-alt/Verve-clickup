import React, { useEffect, useState } from 'react';
import { settingsService } from '../services/settingsService';
import { Sparkles, CheckCircle2, ShieldAlert, Trash2, Users, User, UserSquare } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { UserManagementTab } from '../components/settings/UserManagementTab';
import { MyTeamTab } from '../components/settings/MyTeamTab';

export const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState('profile');
  const { hasRole } = useAuth();
  const isAdmin = hasRole(['Admin']);

  const [dailyCapacity, setDailyCapacity] = useState<number>(8);
  const [weeklyGoal, setWeeklyGoal] = useState<number>(40);
  const [focusDuration, setFocusDuration] = useState<number>(25);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await settingsService.getSettings();
        setDailyCapacity(data.daily_capacity);
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      } finally {
        // Load custom local settings
        setWeeklyGoal(Number(localStorage.getItem('timetriq_weekly_goal') || '40'));
        setFocusDuration(Number(localStorage.getItem('timetriq_focus_duration') || '25'));
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);
      
      // Save backend capacity setting
      await settingsService.updateSettings({
        daily_capacity: dailyCapacity,
        working_days: [0, 1, 2, 3, 4] // Fixed Mon-Fri schedule
      });

      // Save custom client-side settings
      localStorage.setItem('timetriq_weekly_goal', weeklyGoal.toString());
      localStorage.setItem('timetriq_focus_duration', focusDuration.toString());

      setMessage({ type: 'success', text: 'Settings saved successfully!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetLocalData = () => {
    if (window.confirm("Are you sure you want to clear all tasks, timer history, and reset to defaults? This action cannot be undone.")) {
      localStorage.clear();
      setMessage({ type: 'success', text: 'All local data has been successfully reset! Please refresh the page.' });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  };

  const handleLoadDemoData = () => {
    if (window.confirm("This will clear your current local data and load sample spaces, folders, tasks, and time entries for presentation. Continue?")) {
      localStorage.clear();
      const uid = 'guest'; // or from auth, assuming guest for demo if no backend
      
      // Hierarchy
      const demoSpaces = [
        { id: 'space-1', name: 'Engineering', folders: [
          { id: 'folder-1', name: 'Frontend', lists: [{ id: 'list-1', name: 'Sprint 42' }, { id: 'list-2', name: 'Backlog' }] },
          { id: 'folder-2', name: 'Backend', lists: [{ id: 'list-3', name: 'API v2' }] }
        ]},
        { id: 'space-2', name: 'Marketing', folders: [
          { id: 'folder-3', name: 'Campaigns', lists: [{ id: 'list-4', name: 'Q3 Launch' }] }
        ]}
      ];
      localStorage.setItem(`timetriq_spaces_${uid}`, JSON.stringify(demoSpaces));
      // In the new API structure it might just be the direct response. If they use local storage for hierarchy, let's also store it globally:
      localStorage.setItem('timetriq_hierarchy', JSON.stringify(demoSpaces));

      // Tasks
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      
      const demoTasks = [
        { id: 'task-1', title: 'Design new dashboard layout', projectId: 'list-1', assignedUserId: uid, priority: 'High', estimatedHours: 8, actualHours: 4, startDate: today, dueDate: tomorrow, status: 'In Progress', assignees: [uid, 'harsh'], assignedBy: 'Manager' },
        { id: 'task-2', title: 'Implement RBAC middleware', projectId: 'list-3', assignedUserId: uid, priority: 'Critical', estimatedHours: 5, actualHours: 5, startDate: today, dueDate: today, status: 'Completed', assignees: [uid], assignedBy: 'Self' },
        { id: 'task-3', title: 'Prepare Q3 presentation', projectId: 'list-4', assignedUserId: uid, priority: 'Medium', estimatedHours: 3, actualHours: 0, startDate: today, dueDate: tomorrow, status: 'Todo', assignees: ['vishaka'], assignedBy: 'Self' },
      ];
      localStorage.setItem(`timetriq_tasks_${uid}`, JSON.stringify(demoTasks));
      localStorage.setItem('timetriq_shared_tasks', JSON.stringify(demoTasks)); // so they show up everywhere

      // Time Entries
      const demoTimeEntries = [
        { id: 'time-1', task_id: 'task-1', date: today, start_time: `${today}T09:00:00`, end_time: `${today}T11:00:00`, hours_worked: 2, notes: 'Initial wireframing' },
        { id: 'time-2', task_id: 'task-1', date: today, start_time: `${today}T13:00:00`, end_time: `${today}T15:00:00`, hours_worked: 2, notes: 'High-fidelity mockups' },
        { id: 'time-3', task_id: 'task-2', date: today, start_time: `${today}T15:30:00`, end_time: `${today}T20:30:00`, hours_worked: 5, notes: 'Completed middleware implementation and testing' }
      ];
      localStorage.setItem(`timetriq_time_entries_${uid}`, JSON.stringify(demoTimeEntries));

      setMessage({ type: 'success', text: 'Demo data loaded successfully! Refreshing...' });
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    }
  };

  if (loading) return <div style={{ padding: 'var(--spacing-8)' }}>Loading settings...</div>;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '40px' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', color: '#111827' }}>Settings</h1>
      
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '16px', borderBottom: '1px solid #E5E7EB', marginBottom: '24px' }}>
        <button
          onClick={() => setActiveTab('profile')}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'profile' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === 'profile' ? 'var(--color-primary)' : '#6B7280',
            fontWeight: activeTab === 'profile' ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <User size={16} /> My Profile
        </button>
        
        <button
          onClick={() => setActiveTab('my-team')}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'my-team' ? '2px solid var(--color-primary)' : '2px solid transparent',
            color: activeTab === 'my-team' ? 'var(--color-primary)' : '#6B7280',
            fontWeight: activeTab === 'my-team' ? 600 : 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <UserSquare size={16} /> My Team
        </button>

        {isAdmin && (
          <button
            onClick={() => setActiveTab('users')}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'users' ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === 'users' ? 'var(--color-primary)' : '#6B7280',
              fontWeight: activeTab === 'users' ? 600 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <Users size={16} /> User Management
          </button>
        )}
      </div>

      {activeTab === 'users' && isAdmin ? (
        <UserManagementTab />
      ) : activeTab === 'my-team' ? (
        <MyTeamTab />
      ) : (
        <div>
          {message && (
            <div style={{ 
              padding: '12px 16px', 
              marginBottom: '20px', 
              borderRadius: '8px',
              backgroundColor: message.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              color: message.type === 'success' ? '#10B981' : '#EF4444',
              border: `1px solid ${message.type === 'success' ? '#A7F3D0' : '#FCA5A5'}`,
              fontSize: '0.875rem',
              fontWeight: 500
            }}>
              {message.text}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Core Availability Settings */}
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={18} color="#4F46E5" /> Capacity & Availability
          </h2>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: '6px' }}>Daily Capacity (Hours)</label>
            <input 
              type="number" 
              min="1" max="24" step="0.5"
              value={dailyCapacity}
              onChange={(e) => setDailyCapacity(parseFloat(e.target.value))}
              style={{ width: '100%', padding: '10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.875rem', outline: 'none' }}
            />
            <p style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '4px' }}>
              The total number of hours you are available to work per day.
            </p>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: '6px' }}>Weekly Time Target (Hours)</label>
            <input 
              type="number" 
              min="1" max="168"
              value={weeklyGoal}
              onChange={(e) => setWeeklyGoal(parseInt(e.target.value, 10))}
              style={{ width: '100%', padding: '10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.875rem', outline: 'none' }}
            />
            <p style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '4px' }}>
              Your weekly target of logged productive hours shown on the dashboard.
            </p>
          </div>

          <div style={{ padding: '10px 14px', backgroundColor: '#F3F4F6', borderRadius: '6px', border: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: '#4B5563', fontWeight: 600 }}>Fixed Work Schedule:</span>
            <span style={{ fontSize: '0.75rem', color: '#111827', fontWeight: 700, textTransform: 'uppercase', backgroundColor: '#E5E7EB', padding: '2px 8px', borderRadius: '4px' }}>Monday - Friday</span>
          </div>
        </div>

        {/* Productivity Timers */}
        <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '16px', color: '#111827', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={18} color="#10B981" /> Pomodoro Timer
          </h2>
          
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#6B7280', marginBottom: '6px' }}>Default Focus Interval (Minutes)</label>
            <input 
              type="number" 
              min="5" max="180" step="5"
              value={focusDuration}
              onChange={(e) => setFocusDuration(parseInt(e.target.value, 10))}
              style={{ width: '100%', padding: '10px', border: '1px solid var(--color-border)', borderRadius: '6px', fontSize: '0.875rem', outline: 'none' }}
            />
            <p style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: '4px' }}>
              Your default sprint time for concentrated work blocks.
            </p>
          </div>
        </div>

        {/* Reset & Maintenance */}
        <div style={{ backgroundColor: '#FFF5F5', padding: '24px', borderRadius: '12px', border: '1px solid #FEE2E2' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px', color: '#991B1B', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} /> Danger Zone
          </h2>
          <p style={{ fontSize: '0.75rem', color: '#7F1D1D', marginBottom: '16px', lineHeight: 1.4 }}>
            Clearing local data resets all customized settings, offline tasks, logged hours history, and active timers to defaults.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button 
              onClick={handleResetLocalData}
              className="premium-btn premium-btn-danger"
              style={{ flex: 1 }}
            >
              <Trash2 size={14} /> Clear All Local Data
            </button>
            <button 
              onClick={handleLoadDemoData}
              className="premium-btn"
              style={{ flex: 1, backgroundColor: '#3B82F6', color: 'white', border: 'none' }}
            >
              <Sparkles size={14} /> Load Demo Data
            </button>
          </div>
        </div>

        {/* Save button block */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="premium-btn premium-btn-primary"
            style={{ padding: '10px 24px' }}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </div>
        </div>
      )}
    </div>
  );
};
