import React, { Suspense, useState, useRef, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useTimer } from '../context/TimerContext';
import { useNotifications } from '../context/NotificationContext';
import { LayoutDashboard, Bell, ChevronDown, ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { SpacesSidebar } from '../work/SpacesSidebar';
import { MyTasksNav } from '../work/MyTasksNav';
import { FavoritesNav } from '../work/Favorites';
import { GlobalSearch, SearchButton } from '../work/GlobalSearch';
import { AssistantButton } from '../work/assistant/AssistantButton';
import { RunningTimerChip } from '../work/RunningTimer';
import { StatusSelector } from './StatusSelector';
import { FEATURES } from '../config/features';
import { HeaderInboxBell } from '../work/InboxPages';
import { ProfileChip } from './HeaderBits';
import { useIsAdmin, useWork } from '../work/WorkContext';
import type { UserPresence } from '../services/presenceService';
import { BottomNav } from './BottomNav';
import { MobileScopeBar } from './MobileScope';
import { usePhone } from '../work/useBreakpoint';
import { TopBarSlotContext } from './topBarSlot';
import { BrandLockup } from './BrandMark';

const SIDEBAR_KEY = 'verveflow.sidebar.collapsed';

/** What the content pane shows while a page's own chunk is still on the way. */
/** `padded` for the pages that fill the pane and so bring no padding of their own. */
const PageWaiting: React.FC<{ padded?: boolean }> = ({ padded }) => (
  <div className={`animate-pulse space-y-4 ${padded ? 'p-4 sm:p-8' : ''}`} aria-busy="true" aria-label="Loading">
    <div className="h-7 w-48 rounded-md bg-gray-200" />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-gray-100" />)}
    </div>
    <div className="h-64 rounded-xl bg-gray-100" />
  </div>
);

export const Layout: React.FC = () => {
  const { hasRole, user } = useAuth();  // signing out moved into the profile menu
  const location = useLocation();
  const isLocationPage = /^\/($|(s|f|l)\/|my-tasks|dashboards|timesheets|inbox|reminders|people|all-tasks|forms|planner|leave|billing|team-week|compliance|goals)/.test(location.pathname);
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
  // On a phone there is no sidebar: the four tabs across the bottom and the Spaces tab replace it.
  const phone = usePhone();
  const [titleSlot, setTitleSlot] = useState<HTMLDivElement | null>(null);
  // The sidebar slides down to its icons and back; the choice is kept on this computer.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
  });
  const toggleSidebar = () => setCollapsed((was) => {
    try { localStorage.setItem(SIDEBAR_KEY, was ? '0' : '1'); } catch { /* not kept, still works */ }
    return !was;
  });

  useEffect(() => {
    // Presence runs on Firestore, and Firestore is 114 KB gzipped. This was the only door it came
    // through on the way to first paint -- every other user of it is on a page that now loads on
    // demand -- so it is fetched once the shell is up rather than before anything is drawn. Who
    // else is online is worth knowing a moment late; it is not worth waiting for.
    let unsub: (() => void) | undefined;
    let dropped = false;
    import('../services/presenceService').then(({ presenceService }) => {
      if (dropped) return;
      presenceService.updatePresence({ timerRunning: Object.keys(timers).length > 0 });
      unsub = presenceService.subscribeToPresence((users) => {
        // Filter out offline users or users inactive for > 5 mins
        const now = Date.now();
        const activeUsers = users.filter((u) => {
          if (u.currentStatus === 'Offline') return false;
          if (u.userId === user?.uid) return false;  // you're the chip on the right, not a teammate
          const lastSeen = new Date(u.lastSeen).getTime();
          return now - lastSeen < 5 * 60 * 1000;
        });
        setOnlineUsers(activeUsers);
      });
    }).catch(() => undefined);
    return () => {
      dropped = true;
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
  ];

  const adminManagerNavItems: any[] = [
  ];

  const mainNavItems = hasRole(['Admin', 'Manager']) ? [...baseNavItems, ...adminManagerNavItems] : baseNavItems;

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
      className="app-shell flex h-[100dvh] overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #F4F7FC 0%, #E6EDF8 100%)' }}
    >
      {/* Sidebar: a desktop column. On a phone the bottom tabs and the Spaces tab take its place. */}
      <aside
        className={`glass-panel app-sidebar no-print z-10 flex shrink-0 flex-col overflow-y-auto overflow-x-hidden px-3 py-5 max-md:hidden ${collapsed ? 'is-collapsed w-[76px]' : 'w-[216px]'}`}
        style={{ borderRight: '1px solid rgba(255,255,255,0.4)' }}
      >
        {/* Logo Area */}
        <div className="side-brand">
          <BrandLockup />
          <button
            type="button"
            className="side-fold"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Widen the sidebar' : 'Narrow the sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* The main pages sit together in their own panel, apart from the Spaces tree. */}
          <div className="side-main">
            {renderNavGroup(mainNavItems)}
            <MyTasksNav />
          </div>
          <FavoritesNav />

          <SpacesSidebar />

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
        {/* Three columns -- the page's title (or who you work for), search, and you. The title
            column takes the room the search does not need, so a breadcrumb reads in full. The menu button, "Recent" and the help menu
            came off: on a phone the bottom tabs replace the sidebar, the sidebar
            already lists where you've been, and the shortcuts are in the search box itself. */}
        <header
          className="app-topbar glass-panel no-print z-[5] grid h-14 shrink-0 grid-cols-[minmax(7rem,1fr)_minmax(0,26rem)_minmax(max-content,1fr)] items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6"
        >
          {/* The firm's own logo, then the page's title portalled in after a thin rule. The logo
              already names the workspace, so the bar no longer spells it out a second time. */}
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="topbar-logo" aria-label={workspaceName || 'Verve Advisory'}>
              <img src="/verve-advisory-logo.png" alt="Verve Advisory" />
            </Link>
            <span className="topbar-sep" aria-hidden />
            <div ref={setTitleSlot} className="topbar-title flex min-w-0 flex-1 items-center" />
          </div>

          {/* The search sits in the middle and stays there: the two sides share what is left
              equally, so a timer starting on the right no longer pushes it across. It gives way
              only when the bar is too narrow for the bell, the timer and your name. */}
          <div className="flex w-full min-w-0 justify-center">
            <SearchButton />
          </div>

          {/* Right: Actions */}
          <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-4">
            
            {/* Multiplayer Avatar Stack -- desktop only: a phone header is 390px wide. */}
            {onlineUsers.length > 0 && !phone && (
              <div style={{ display: 'flex', alignItems: 'center', marginRight: '8px', paddingRight: '16px', borderRight: '1px solid var(--color-border)' }} aria-label={`${onlineUsers.length} online`}>
                <div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
                  {onlineUsers.slice(0, 5).map((user, i) => (
                    <div 
                      key={user.userId} 
                      aria-label={`${user.name} (${user.currentStatus})`}
                      style={{ 
                        width: '28px', height: '28px', borderRadius: '50%', 
                        backgroundColor: user.avatarColor || '#234788', 
                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        fontSize: '0.7rem', fontWeight: 600,
                        border: '2px solid var(--color-surface)',
                        marginLeft: i === onlineUsers.slice(0, 5).length - 1 ? 0 : '-8px',
                        zIndex: i, position: 'relative'
                      }}
                    >
                      {user.initials}
                      {/* Active indicator dot */}
                      <span style={{ position: 'absolute', bottom: 0, right: 0, width: '8px', height: '8px', backgroundColor: '#7D98D1', border: '1.5px solid var(--color-surface)', borderRadius: '50%' }}></span>
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
                  backgroundColor: '#EEF2F8',
                  color: '#234788',
                  padding: '6px 12px', 
                  borderRadius: '20px', 
                  border: '1px solid #C9D5EA', 
                  fontSize: '0.75rem', 
                  fontWeight: 600,
                  marginRight: '8px'
                }}
              >
                <span style={{ 
                  width: '6px', 
                  height: '6px', 
                  borderRadius: '50%', 
                  backgroundColor: '#234788' 
                }}></span>
                <span style={{ maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Focus: {focusSession.taskTitle}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, backgroundColor: '#fff', padding: '2px 6px', borderRadius: '10px' }}>
                  {Math.floor(focusSession.timeLeft / 60)}:{(focusSession.timeLeft % 60).toString().padStart(2, '0')}
                </span>
                <button 
                  onClick={stopFocus}
                  aria-label="Quit Focus session"
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: '#234788', 
                    cursor: 'pointer', 
                    display: 'flex', 
                    alignItems: 'center', 
                    padding: '2px',
                    borderRadius: '50%',
                    backgroundColor: '#fff'
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
                    color: '#92400E',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    border: '1px solid #F3D9A4',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    outline: 'none'
                  }}
                  aria-label="View Active Timers"
                >
                  <span style={{ 
                    width: '6px', 
                    height: '6px', 
                    borderRadius: '50%', 
                    backgroundColor: '#D97706' 
                  }}></span>
                  
                  <span>
                    ({runningTimers.length}) Running
                  </span>
                  
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>
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
                                aria-label={timer.taskTitle}
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

            {/* The running timer's place is kept whether a timer runs or not: a fixed slot, so the
                right side is the same width either way and the search never moves. */}
            <div className="flex shrink-0 justify-end sm:w-[8.5rem] 2xl:w-[19rem]">
              <RunningTimerChip />
            </div>

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

            <ProfileChip />
          </div>
        </header>

        {/* Phone: whose Dashboard / Tasks / Timesheet this is (Mine, Team, Company, Person). */}
        <MobileScopeBar />

        {/* Page Content: Space/Folder/List pages fill the pane and scroll internally.
            On a phone `pb-nav` keeps the last row clear of the tab bar across the bottom. */}
        <div
          className={`min-h-0 flex-1 ${isLocationPage ? 'flex flex-col' : 'overflow-y-auto p-4 sm:p-8'} ${phone ? 'pb-nav' : ''}`}
        >
          {/* The page arrives as its own chunk now, so there is a moment on a first visit where
              it is still downloading. The shell stays put and only this pane waits: a skeleton
              in the right shape, which reads as the page arriving rather than the app hanging.
              Navigating back to a page already fetched is instant -- the chunk is cached. */}
          <TopBarSlotContext.Provider value={titleSlot}>
            <Suspense fallback={<PageWaiting padded={isLocationPage} />}>
              <Outlet />
            </Suspense>
          </TopBarSlotContext.Provider>
          <GlobalSearch />
        </div>
      </main>

      <BottomNav />
      <AssistantButton />
    </div>
  );
};
