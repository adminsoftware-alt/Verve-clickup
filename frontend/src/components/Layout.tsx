import React, { useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTimer } from '../context/TimerContext';
import { useNotifications } from '../context/NotificationContext';
import { 
  LayoutDashboard, CheckSquare, Calendar, Clock, 
  BarChart2, Settings as SettingsIcon,
  Bell, ChevronDown, MessageSquare,
  Activity, Briefcase, Plus, X, Users, Menu, Sparkles
} from 'lucide-react';
import { SpacesSidebar } from '../work/SpacesSidebar';
import { MyTasksNav } from '../work/MyTasksNav';
import { FavoritesNav } from '../work/Favorites';
import { GlobalSearch, SearchButton } from '../work/GlobalSearch';
import { QuickAdd } from '../work/assistant/QuickAdd';
import { RunningTimerChip } from '../work/RunningTimer';
import { StatusSelector } from './StatusSelector';
import { FEATURES } from '../config/features';
import { HeaderInboxBell } from '../work/InboxPages';
import { HelpMenu, ProfileChip, RecentMenu } from './HeaderBits';
import { useIsAdmin, useWork } from '../work/WorkContext';
import { presenceService, type UserPresence } from '../services/presenceService';
import { BottomNav } from './BottomNav';
import { usePhone } from '../work/useBreakpoint';

export const Layout: React.FC = () => {
  const { hasRole, user } = useAuth();  // signing out moved into the profile menu
  const location = useLocation();
  const isLocationPage = /^\/((s|f|l)\/|my-tasks|dashboards|timesheets|inbox|replies|assigned-comments|reminders|people|all-tasks|forms|planner|leave|billing|team-week|compliance|all-spaces|goals)/.test(location.pathname);
  const { timers, stopTimer, getLiveElapsedSeconds, focusSession, stopFocus } = useTimer();
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  
  const [showTimersDropdown, setShowTimersDropdown] = useState(false);
  const timersDropdownRef = useRef<HTMLDivElement>(null);
  
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const { workspace } = useWork();
  const isWorkspaceAdmin = useIsAdmin();
  const workspaceName = workspace?.name ?? 'Verve Workflow';
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  // On a phone the sidebar is a drawer. On anything wider it is always there and this is ignored.
  const phone = usePhone();
  const [drawer, setDrawer] = useState(false);
  // Say-a-task. Ctrl/Cmd+K is already the search; this takes the next key along.
  const [quickAdd, setQuickAdd] = useState(false);

  useEffect(() => {
    // Start presence tracking for the current user
    presenceService.updatePresence({ timerRunning: Object.keys(timers).length > 0 });
    
    const unsub = presenceService.subscribeToPresence((users) => {
      // Filter out offline users or users inactive for > 5 mins
      const now = Date.now();
      const activeUsers = users.filter(u => {
        if (u.currentStatus === 'Offline') return false;
        if (u.userId === user?.uid) return false;  // you're the chip on the right, not a teammate
        const lastSeen = new Date(u.lastSeen).getTime();
        return now - lastSeen < 5 * 60 * 1000;
      });
      setOnlineUsers(activeUsers);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [timers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (timersDropdownRef.current && !timersDropdownRef.current.contains(event.target as Node)) {
        setShowTimersDropdown(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, []);
  // Following a link puts the drawer away; so does Escape, and growing past a phone.
  useEffect(() => { setDrawer(false); }, [location.pathname]);
  useEffect(() => { if (!phone) setDrawer(false); }, [phone]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setQuickAdd(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const runningTimers = Object.entries(timers).filter(([_, t]) => t.startTime !== null);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const baseNavItems = [
    // An admin has no personal board -- the Company one is theirs, and it is the first row of
    // Dashboards -- so the rail would otherwise carry two routes to the same place.
    ...(isWorkspaceAdmin ? [] : [{ name: 'Dashboard', path: '/', icon: <LayoutDashboard size={16} /> }]),
    ...(FEATURES.legacyTasks ? [{ name: 'My Tasks', path: '/tasks', icon: <CheckSquare size={16} /> }] : []),
    ...(FEATURES.chat ? [{ name: 'Chat', path: '/chat', icon: <MessageSquare size={16} /> }] : []),
    ...(FEATURES.legacyTimeTracking ? [{ name: 'Time Tracking', path: '/time-entries', icon: <Clock size={16} /> }] : []),
    ...(FEATURES.legacyCalendar ? [{ name: 'Calendar', path: '/calendar', icon: <Calendar size={16} /> }] : []),
    ...(FEATURES.legacyTeams ? [{ name: hasRole(['Admin']) ? 'Teams' : 'My Team', path: '/teams', icon: <Users size={16} /> }] : []),
    ...(FEATURES.legacyReports ? [{ name: 'Reports', path: '/reports', icon: <BarChart2 size={16} /> }] : []),
    ...(FEATURES.legacyWorkload ? [{ name: 'Workload', path: '/workload', icon: <Activity size={16} /> }] : []),
  ];

  const adminManagerNavItems: any[] = [
  ];

  const mainNavItems = hasRole(['Admin', 'Manager']) ? [...baseNavItems, ...adminManagerNavItems] : baseNavItems;

  const settingsItems = [
    { name: 'Settings', path: '/settings', icon: <SettingsIcon size={16} /> },
    { name: 'Integrations', path: '/integrations', icon: <Briefcase size={16} /> },
  ];

  const renderNavGroup = (items: typeof mainNavItems) => (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {items.map((item) => {
        const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
        return (
          <Link
            key={item.name}
            to={item.path}
            className={`side-row flex w-full items-center gap-2 pl-1.5 no-underline${isActive ? ' is-active' : ''}`}
          >
            <span className="w-4 shrink-0" aria-hidden />
            {item.icon}
            <span className="truncate">{item.name}</span>
          </Link>
        )
      })}
    </nav>
  );

  return (
    // 100dvh, not 100vh: on a phone the browser's own chrome slides away as you scroll, and
    // 100vh keeps counting the space it used to take -- which puts the bottom of the app under
    // the address bar.
    <div
      className="flex h-[100dvh] overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FAFBFB 0%, #EEF2F1 100%)' }}
    >
      {/* The dimmed page behind an open drawer. Tapping it is how most people close one. */}
      {phone && drawer && (
        <div className="fixed inset-0 z-[55] bg-black/40 md:hidden" onClick={() => setDrawer(false)} aria-hidden />
      )}

      {/* Sidebar: a column on a desktop, a drawer over the page on a phone. */}
      <aside
        className={`glass-panel app-sidebar no-print z-10 flex w-60 shrink-0 flex-col overflow-y-auto px-3 py-5 transition-transform duration-200
          max-md:z-[56] max-md:pb-nav
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:w-[17rem] max-md:shadow-2xl
          ${phone && !drawer ? 'max-md:-translate-x-full' : 'max-md:translate-x-0'}`}
        style={{ borderRight: '1px solid rgba(255,255,255,0.4)' }}
        aria-hidden={phone && !drawer}
      >
        {/* Logo Area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 6px', marginBottom: '20px' }}>
          <div style={{ display: 'flex' }}>
            <img
              src="/verve-workflow-logo.png"
              alt="Verve Workflow"
              style={{ width: '186px', height: 'auto', display: 'block' }}
            />
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {renderNavGroup(mainNavItems)}

          <MyTasksNav />
          <FavoritesNav />

          <SpacesSidebar />

          {FEATURES.sidebarSettings && (
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-sidebar-text)', letterSpacing: '0.05em', marginBottom: '8px', paddingLeft: '14px' }}>
                Settings
              </div>
              {renderNavGroup(settingsItems)}
            </div>
          )}
        </div>

        {/* Bottom Sidebar Actions */}
        {FEATURES.sidebarWorkspaceCard && (
          <div style={{ marginTop: 'auto', paddingTop: 'var(--spacing-6)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
            {/* Workspace Switcher */}
            <div className="premium-btn" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              padding: '10px 14px', 
              borderRadius: '12px',
              width: '100%'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '8px', backgroundColor: '#4F46E5', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, boxShadow: '0 2px 4px rgba(79, 70, 229, 0.3)' }}>
                  T
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: '0.65rem', color: '#6B7280', fontWeight: 500 }}>Workspace</div>
                  <div style={{ fontSize: '0.85rem', color: '#111827', fontWeight: 600 }}>Verve Workflow Team</div>
                </div>
              </div>
              </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Top Header */}
        <header
          className="glass-panel no-print z-[5] flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:h-16 sm:px-6"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.5)' }}
        >
          {/* Left: the way into the drawer, where you are, and where you've just been */}
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            <button
              type="button" onClick={() => setDrawer(true)} aria-label="Open the menu" aria-expanded={drawer}
              className="tap -ml-1 rounded-lg text-gray-600 hover:bg-black/5 md:hidden"
            >
              <Menu size={20} />
            </button>
            <span className="max-w-[9rem] truncate text-[0.95rem] font-semibold text-gray-800 sm:max-w-[220px]">{workspaceName}</span>
            <span className="hidden sm:inline"><RecentMenu /></span>
          </div>

          {/* Right: Actions */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-4">
            
            {/* Multiplayer Avatar Stack -- desktop only: a phone header is 390px wide. */}
            {onlineUsers.length > 0 && !phone && (
              <div style={{ display: 'flex', alignItems: 'center', marginRight: '8px', paddingRight: '16px', borderRight: '1px solid var(--color-border)' }} title={`${onlineUsers.length} online`}>
                <div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                  {onlineUsers.slice(0, 5).map((user, i) => (
                    <div 
                      key={user.userId} 
                      title={`${user.name} (${user.currentStatus})`}
                      style={{ 
                        width: '28px', height: '28px', borderRadius: '50%', 
                        backgroundColor: user.avatarColor || '#4F46E5', 
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        fontSize: '0.7rem', fontWeight: 600,
                        border: '2px solid var(--color-surface)',
                        marginLeft: i === onlineUsers.slice(0, 5).length - 1 ? 0 : '-8px',
                        zIndex: i, position: 'relative'
                      }}
                    >
                      {user.initials}
                      {/* Active indicator dot */}
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', backgroundColor: '#10B981', border: '1.5px solid var(--color-surface)', borderRadius: '50%' }}></span>
                    </div>
                  ))}
                  {onlineUsers.length > 5 && (
                    <div style={{ 
                      width: '28px', height: '28px', borderRadius: '50%', 
                      backgroundColor: '#F3F4F6', color: '#4B5563', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                      fontSize: '0.65rem', fontWeight: 600, border: '2px solid var(--color-surface)',
                      marginLeft: '-8px', zIndex: 10, position: 'relative'
                    }}>
                      +{onlineUsers.length - 5}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {focusSession && !phone && (
              <div 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px', 
                  backgroundColor: '#FEF2F2',
                  color: '#991B1B',
                  padding: '6px 12px', 
                  borderRadius: '20px', 
                  border: '1.5px solid #FCA5A5', 
                  fontSize: '0.75rem', 
                  fontWeight: 600,
                  boxShadow: '1px 1px 0px 0px #7F1D1D',
                  marginRight: '8px'
                }}
              >
                <span style={{ 
                  width: '6px', 
                  height: '6px', 
                  borderRadius: '50%', 
                  backgroundColor: '#DC2626', 
                  animation: 'pulse 1s infinite' 
                }}></span>
                <span style={{ maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Focus: {focusSession.taskTitle}
                </span>
                <span style={{ fontFamily: 'monospace', fontWeight: 700, backgroundColor: '#FEE2E2', padding: '2px 6px', borderRadius: '10px' }}>
                  {Math.floor(focusSession.timeLeft / 60)}:{(focusSession.timeLeft % 60).toString().padStart(2, '0')}
                </span>
                <button 
                  onClick={stopFocus}
                  title="Quit Focus session"
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: '#DC2626', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '2px',
                    borderRadius: '50%',
                    backgroundColor: '#FEE2E2'
                  }}
                >
                  <X size={10} />
                </button>
              </div>
            )}

            {runningTimers.length > 0 && (
              <div style={{ position: 'relative', marginRight: '8px' }} ref={timersDropdownRef}>
                <button
                  onClick={() => setShowTimersDropdown(!showTimersDropdown)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: '#FFFBEB',
                    color: '#B45309',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: '1.5px solid #F59E0B',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '1px 1px 0px 0px #78350F',
                    outline: 'none'
                  }}
                  title="View Active Timers"
                >
                  <span style={{ 
                    width: '6px', 
                    height: '6px', 
                    borderRadius: '50%', 
                    backgroundColor: '#DC2626', 
                    animation: 'pulse 1.5s infinite' 
                  }}></span>
                  
                  <span>
                    ({runningTimers.length}) Running
                  </span>
                  
                  <span style={{ fontFamily: 'monospace', opacity: 0.85 }}>
                    {formatTime(getLiveElapsedSeconds(runningTimers[0][0]))}
                  </span>
                  
                  <ChevronDown size={12} color="#B45309" />
                </button>

                {showTimersDropdown && (
                  <div style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: '8px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    minWidth: '260px',
                    zIndex: 100,
                    overflow: 'hidden'
                  }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #F3F4F6', backgroundColor: '#F9FAFB', fontSize: '0.7rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>
                      Active Timers
                    </div>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {runningTimers.map(([taskId, timer]) => {
                        const elapsed = getLiveElapsedSeconds(taskId);
                        return (
                          <div 
                            key={taskId} 
                            style={{ 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'space-between', 
                              padding: '10px 12px', 
                              borderBottom: '1px solid #F3F4F6' 
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, marginRight: '12px' }}>
                              <span 
                                style={{ 
                                  fontSize: '0.75rem', 
                                  fontWeight: 600, 
                                  color: '#374151', 
                                  whiteSpace: 'nowrap', 
                                  overflow: 'hidden', 
                                  textOverflow: 'ellipsis' 
                                }}
                                title={timer.taskTitle}
                              >
                                {timer.taskTitle}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: '#6B7280', fontFamily: 'monospace', marginTop: '2px' }}>
                                {formatTime(elapsed)}
                              </span>
                            </div>
                            <button 
                              onClick={async (e) => {
                                e.stopPropagation();
                                await stopTimer(taskId);
                              }}
                              style={{
                                backgroundColor: '#FEE2E2',
                                border: 'none',
                                color: '#DC2626',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'background-color 0.15s ease'
                              }}
                              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#FCA5A5'}
                              onMouseLeave={e => e.currentTarget.style.backgroundColor = '#FEE2E2'}
                            >
                              Stop
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {FEATURES.legacyTasks && (
              <Link to="/tasks?new=true" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                backgroundColor: 'var(--color-primary)',
                color: 'white',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8125rem',
                fontWeight: 500,
                cursor: 'pointer',
                textDecoration: 'none',
                boxShadow: 'var(--shadow-sm)'
              }}>
                <Plus size={14} /> New Task
              </Link>
            )}

            <button
              type="button" onClick={() => setQuickAdd(true)}
              title="Add a task by saying it (Ctrl+J)" aria-label="Add a task by saying it"
              className="tap rounded-lg text-gray-500 hover:bg-black/5 hover:text-brand-700"
            >
              <Sparkles size={18} />
            </button>
            <SearchButton />
            <RunningTimerChip />

{FEATURES.leave && (
            <Link to="/teams?tab=leave" style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: '#F3F4F6',
              color: '#374151',
              border: '1px solid var(--color-border)',
              padding: '6px 12px',
              borderRadius: '6px',
              fontSize: '0.8125rem',
              fontWeight: 500,
              cursor: 'pointer',
              textDecoration: 'none'
            }}>
              <Plus size={14} /> Request Leave
            </Link>
            )}

            <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--color-border)', margin: '0 8px' }}></div>

            {FEATURES.legacyNotifications ? (
            <div style={{ position: 'relative' }} ref={notificationsRef}>
              <div 
                style={{ cursor: 'pointer', padding: '4px' }} 
                onClick={() => setShowNotifications(!showNotifications)}
              >
                <Bell size={20} color="var(--color-text-secondary)" />
                {unreadCount > 0 && (
                  <div style={{ position: 'absolute', top: '0', right: '0', width: '8px', height: '8px', backgroundColor: 'var(--color-error)', borderRadius: '50%', border: '2px solid var(--color-surface)' }}></div>
                )}
              </div>

              {showNotifications && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: '8px',
                  backgroundColor: 'white',
                  borderRadius: '8px',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                  minWidth: '320px',
                  zIndex: 100,
                  overflow: 'hidden'
                }}>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>Notifications</span>
                    {notifications.length > 0 && (
                      <button onClick={markAllAsRead} style={{ fontSize: '0.75rem', color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer' }}>Mark all read</button>
                    )}
                  </div>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '32px 16px', textAlign: 'center', color: '#6B7280', fontSize: '0.875rem' }}>
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map(notif => (
                        <div 
                          key={notif.id} 
                          onClick={() => markAsRead(notif.id)}
                          style={{ 
                            padding: '12px 16px', 
                            borderBottom: '1px solid #F3F4F6',
                            backgroundColor: notif.read ? 'white' : '#F9FAFB',
                            cursor: 'pointer'
                          }}
                        >
                          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827', marginBottom: '4px' }}>{notif.title}</div>
                          <div style={{ fontSize: '0.8125rem', color: '#4B5563' }}>{notif.body}</div>
                          <div style={{ fontSize: '0.7rem', color: '#9CA3AF', marginTop: '6px' }}>{notif.timestamp.toLocaleTimeString()}</div>
                        </div>
                      ))
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <div 
                      onClick={clearAll}
                      style={{ padding: '8px', textAlign: 'center', borderTop: '1px solid #F3F4F6', fontSize: '0.75rem', color: '#6B7280', cursor: 'pointer', backgroundColor: '#F9FAFB' }}
                    >
                      Clear All
                    </div>
                  )}
                </div>
              )}
            </div>
            ) : FEATURES.headerBell ? <HeaderInboxBell /> : null}

            {FEATURES.availabilityStatus && <StatusSelector />}

            <HelpMenu />
            <ProfileChip />
          </div>
        </header>

        {/* Page Content: Space/Folder/List pages fill the pane and scroll internally.
            On a phone `pb-nav` keeps the last row clear of the tab bar across the bottom. */}
        <div
          className={`min-h-0 flex-1 ${isLocationPage ? 'flex flex-col' : 'overflow-y-auto p-4 sm:p-8'} ${phone ? 'pb-nav' : ''}`}
        >
          <Outlet />
          <GlobalSearch />
          {quickAdd && <QuickAdd onClose={() => setQuickAdd(false)} />}
        </div>
      </main>

      <BottomNav onMore={() => setDrawer(true)} moreOpen={drawer} />
    </div>
  );
};
