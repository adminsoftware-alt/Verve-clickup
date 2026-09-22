import React, { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Folder, List, Layout as LayoutIcon, ChevronRight, AlignLeft, Grid, CalendarDays, Search, Plus, Users, X, Lock, Star } from "lucide-react";
import { workspaceService } from "../services/workspaceService";
import type { HierarchySpace, HierarchyFolder, HierarchyList } from "../services/workspaceService";
import { useAuth } from "../components/AuthContext";
import { adminService } from "../services/adminService";
import { TaskForm } from "../components/TaskForm";
import { taskService, SAMPLE_TEAM_MEMBERS } from "../services/taskService";
type ListViewMode = "table" | "board" | "calendar";

const SpacePageView: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const [space, setSpace] = useState<HierarchySpace | null>(null);
  const [loading, setLoading] = useState(true);
  const [spaceTasks, setSpaceTasks] = useState<any[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);
  const navigate = useNavigate();

  const onToggleStar = async (taskId: string) => {
    try {
      const updated = await taskService.toggleTaskStar(taskId);
      setSpaceTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    } catch (e: any) {
      console.error(e);
    }
  };

  const loadHierarchy = () => {
    workspaceService.getHierarchy().then(all => {
      setSpace(all.find(s => s.id === spaceId) || null);
      setLoading(false);
    });

    taskService.getTasks().then(allTasks => {
        setSpaceTasks(allTasks.filter(t => t.projectId === spaceId));
    });
  };

  useEffect(() => {
    loadHierarchy();
  }, [spaceId]);

  if (loading) return <div style={{ padding: "32px", color: "#6B7280" }}>Loading...</div>;
  if (!space) return <div style={{ padding: "32px", color: "#EF4444" }}>Space not found.</div>;

  return (
    <div style={{ padding: "32px", maxWidth: "900px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "24px", fontSize: "0.8rem", color: "#9CA3AF" }}>
        <Link to="/" style={{ color: "#9CA3AF", textDecoration: "none" }}>Home</Link>
        <ChevronRight size={12} />
        <span style={{ color: "#374151", fontWeight: 600 }}>{space.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "linear-gradient(135deg, #4F46E5, #7C3AED)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LayoutIcon size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#111827", margin: 0 }}>{space.name}</h1>
            <p style={{ fontSize: "0.8rem", color: "#9CA3AF", margin: "2px 0 0" }}>{space.folders.length} folder{space.folders.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <button onClick={() => setShowTaskModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
          <Plus size={16} /> New Task
        </button>
      </div>
      {space.folders.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#9CA3AF", backgroundColor: "white", borderRadius: "12px", border: "2px dashed #E5E7EB" }}>
          <Folder size={40} style={{ marginBottom: "12px", opacity: 0.4 }} />
          <p style={{ fontWeight: 600, color: "#6B7280" }}>No folders yet</p>
          <p style={{ fontSize: "0.8rem" }}>Create a folder in this space to organize your work</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
          {space.folders.map(folder => (
            <div key={folder.id} onClick={() => navigate(`/folders/${folder.id}`)}
              style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: "12px", padding: "20px", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366F1"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(99,102,241,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Folder size={18} color="#059669" />
                </div>
                <span style={{ fontWeight: 600, color: "#111827", fontSize: "0.95rem" }}>
                  {folder.name}
                  {folder.members && folder.members.length > 0 && (
                    <span title="Restricted Access"><Lock size={12} color="#9CA3AF" style={{ marginLeft: '8px', verticalAlign: 'middle' }} /></span>
                  )}
                </span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#9CA3AF", margin: 0 }}>{folder.lists.length} list{folder.lists.length !== 1 ? "s" : ""}</p>
            </div>
          ))}
        </div>
      )}
      {/* Tasks in this Space */}
      <div style={{ marginTop: '40px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>Tasks in {space.name}</h2>
        {spaceTasks.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#6B7280", backgroundColor: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
            No tasks directly in this space.
          </div>
        ) : (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left', backgroundColor: 'white' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#F9FAFB' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Task Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Due Date</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {spaceTasks.map(task => {
                  
                  return (
                  <tr key={task.id} onClick={() => setEditingTask(task)} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F9FAFB'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#111827' }}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.8125rem', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {task.title}
                        <Star 
                          size={14} 
                          color={task.isStarred ? "#F59E0B" : "#D1D5DB"} 
                          fill={task.isStarred ? "#F59E0B" : "none"} 
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); onToggleStar(task.id); }} 
                        />
                      </div>
                      {task.description && <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{task.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.priority === 'Critical' ? '#FEE2E2' : task.priority === 'High' ? '#FEF3C7' : '#D1FAE5',
                        color: task.priority === 'Critical' ? '#DC2626' : task.priority === 'High' ? '#D97706' : '#059669',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.priority || 'Medium'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.status === 'Completed' ? '#D1FAE5' : task.status === 'In Progress' ? '#DBEAFE' : '#F3F4F6',
                        color: task.status === 'Completed' ? '#059669' : task.status === 'In Progress' ? '#2563EB' : '#374151',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.status || 'Todo'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#4B5563', fontSize: '0.8125rem' }}>{task.dueDate || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {(() => {
                        const allIds: string[] = (task.assignees && task.assignees.length > 0) ? task.assignees : (task.assignedUserId ? [task.assignedUserId] : []);
                        if (allIds.length === 0) return <span style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>—</span>;
                        const first = SAMPLE_TEAM_MEMBERS.find(m => m.id === allIds[0]) || { name: allIds[0], color: '#9CA3AF', initials: allIds[0].substring(0,2).toUpperCase() };
                        const extra = allIds.length - 1;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <div title={first.name} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: first.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid white', flexShrink: 0 }}>{first.initials}</div>
                              {extra > 0 && (
                                <div title={`+${extra} more`} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#E5E7EB', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, border: '2px solid white', marginLeft: '-6px', flexShrink: 0 }}>+{extra}</div>
                              )}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: '#374151', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{first.name}</span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showTaskModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={{ projectId: spaceId } as any}
              onSuccess={() => { setShowTaskModal(false); loadHierarchy(); }} 
              onCancel={() => setShowTaskModal(false)} 
            />
          </div>
        </div>
      )}
      {editingTask && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={editingTask}
              onSuccess={() => { setEditingTask(null); loadHierarchy(); }} 
              onCancel={() => setEditingTask(null)} 
            />
          </div>
        </div>
      )}
    </div>
  );
};

const FolderPageView: React.FC<{ folderId: string; spaceId?: string }> = ({ folderId }) => {
  const [folder, setFolder] = useState<HierarchyFolder | null>(null);
  const [parentSpace, setParentSpace] = useState<HierarchySpace | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [folderTasks, setFolderTasks] = useState<any[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  const loadHierarchy = () => {
    workspaceService.getHierarchy().then(all => {
      for (const space of all) {
        const found = space.folders.find(f => f.id === folderId);
        if (found) { setFolder(found); setParentSpace(space); setSelectedUsers(found.members || []); break; }
      }
      setLoading(false);
    });

    taskService.getTasks().then(allTasks => {
        setFolderTasks(allTasks.filter(t => t.projectId === folderId));
    });
  };

  useEffect(() => {
    loadHierarchy();
  }, [folderId]);

  const onToggleStar = async (taskId: string) => {
    try {
      const updated = await taskService.toggleTaskStar(taskId);
      setFolderTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    } catch (e: any) {
      console.error(e);
    }
  };

  const openAssignModal = async () => {
    setShowAssignModal(true);
    try {
      const users = await adminService.getUsers();
      setAllUsers(users.filter(u => u.role.toLowerCase() === 'employee'));
    } catch (e) {
      console.error("Failed to load users", e);
    }
  };

  const handleSaveAssignments = async () => {
    setSaving(true);
    try {
      await workspaceService.assignFolderMembers(folderId, selectedUsers);
      loadHierarchy();
      setShowAssignModal(false);
    } catch (e) {
      console.error(e);
      alert("Failed to assign members");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: "32px", color: "#6B7280" }}>Loading...</div>;
  if (!folder) return <div style={{ padding: "32px", color: "#EF4444" }}>Folder not found.</div>;

  return (
    <div style={{ padding: "32px", maxWidth: "900px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "24px", fontSize: "0.8rem", color: "#9CA3AF" }}>
        <Link to="/" style={{ color: "#9CA3AF", textDecoration: "none" }}>Home</Link>
        <ChevronRight size={12} />
        {parentSpace && <><Link to={`/spaces/${parentSpace.id}`} style={{ color: "#9CA3AF", textDecoration: "none" }}>{parentSpace.name}</Link><ChevronRight size={12} /></>}
        <span style={{ color: "#374151", fontWeight: 600 }}>{folder.name}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "10px", background: "linear-gradient(135deg, #059669, #10B981)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Folder size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#111827", margin: 0 }}>{folder.name}</h1>
            <p style={{ fontSize: "0.8rem", color: "#9CA3AF", margin: "2px 0 0" }}>{folder.lists.length} list{folder.lists.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {hasRole(['Admin', 'Manager']) && (
            <button 
              onClick={openAssignModal}
              style={{ display: "flex", alignItems: "center", gap: "6px", backgroundColor: "white", border: "1px solid #D1D5DB", padding: "8px 14px", borderRadius: "6px", fontSize: "0.85rem", fontWeight: 500, color: "#374151", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}
            >
              <Users size={16} />
              Assign Employees
            </button>
          )}
          <button onClick={() => setShowTaskModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
            <Plus size={16} /> New Task
          </button>
        </div>
      </div>

      {showAssignModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ backgroundColor: "white", borderRadius: "12px", width: "400px", maxWidth: "90%", padding: "24px", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: 0, color: "#111827" }}>Assign Employees</h2>
              <X size={20} color="#6B7280" cursor="pointer" onClick={() => setShowAssignModal(false)} />
            </div>
            
            <p style={{ fontSize: "0.85rem", color: "#6B7280", marginBottom: "16px" }}>Select the employees who should have access to this folder.</p>
            
            <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "8px" }}>
              {allUsers.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", color: "#9CA3AF", fontSize: "0.85rem" }}>Loading or no employees found...</div>
              ) : (
                allUsers.map(user => (
                  <label key={user.uid} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px", cursor: "pointer", borderRadius: "6px" }}>
                    <input 
                      type="checkbox" 
                      checked={selectedUsers.includes(user.uid)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedUsers([...selectedUsers, user.uid]);
                        else setSelectedUsers(selectedUsers.filter(id => id !== user.uid));
                      }}
                      style={{ cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "#111827" }}>{user.displayName}</div>
                      <div style={{ fontSize: "0.75rem", color: "#6B7280" }}>{user.email}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
            
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "24px" }}>
              <button 
                onClick={() => setShowAssignModal(false)}
                style={{ padding: "8px 16px", backgroundColor: "white", border: "1px solid #D1D5DB", borderRadius: "6px", fontSize: "0.9rem", fontWeight: 500, color: "#374151", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveAssignments}
                disabled={saving}
                style={{ padding: "8px 16px", backgroundColor: "#4F46E5", border: "none", borderRadius: "6px", fontSize: "0.9rem", fontWeight: 500, color: "white", cursor: "pointer", opacity: saving ? 0.7 : 1 }}
              >
                {saving ? "Saving..." : "Save Assignments"}
              </button>
            </div>
          </div>
        </div>
      )}
      {folder.lists.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#9CA3AF", backgroundColor: "white", borderRadius: "12px", border: "2px dashed #E5E7EB" }}>
          <List size={40} style={{ marginBottom: "12px", opacity: 0.4 }} />
          <p style={{ fontWeight: 600, color: "#6B7280" }}>No lists yet</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
          {folder.lists.map(list => (
            <div key={list.id} onClick={() => navigate(`/lists/${list.id}`)}
              style={{ backgroundColor: "white", border: "1px solid #E5E7EB", borderRadius: "12px", padding: "20px", cursor: "pointer" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#F59E0B"; e.currentTarget.style.boxShadow = "0 4px 12px rgba(245,158,11,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.boxShadow = "none"; }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "#FFFBEB", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <List size={18} color="#D97706" />
                </div>
                <span style={{ fontWeight: 600, color: "#111827", fontSize: "0.95rem" }}>{list.name}</span>
              </div>
              <p style={{ fontSize: "0.75rem", color: "#9CA3AF", margin: "10px 0 0" }}>Click to manage tasks</p>
            </div>
          ))}
        </div>
      )}

      {/* Tasks in this Folder */}
      <div style={{ marginTop: '40px' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#111827', marginBottom: '16px' }}>Tasks in {folder.name}</h2>
        {folderTasks.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#6B7280", backgroundColor: "#F9FAFB", borderRadius: "8px", border: "1px solid #E5E7EB" }}>
            No tasks directly in this folder.
          </div>
        ) : (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left', backgroundColor: 'white' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: '#F9FAFB' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Task Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Due Date</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Assignee</th>
                </tr>
              </thead>
              <tbody>
                {folderTasks.map(task => {
                  
                  return (
                  <tr key={task.id} onClick={() => setEditingTask(task)} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F9FAFB'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#111827' }}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.8125rem', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {task.title}
                        <Star 
                          size={14} 
                          color={task.isStarred ? "#F59E0B" : "#D1D5DB"} 
                          fill={task.isStarred ? "#F59E0B" : "none"} 
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); onToggleStar(task.id); }} 
                        />
                      </div>
                      {task.description && <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{task.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.priority === 'Critical' ? '#FEE2E2' : task.priority === 'High' ? '#FEF3C7' : '#D1FAE5',
                        color: task.priority === 'Critical' ? '#DC2626' : task.priority === 'High' ? '#D97706' : '#059669',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.priority || 'Medium'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.status === 'Completed' ? '#D1FAE5' : task.status === 'In Progress' ? '#DBEAFE' : '#F3F4F6',
                        color: task.status === 'Completed' ? '#059669' : task.status === 'In Progress' ? '#2563EB' : '#374151',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.status || 'Todo'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#4B5563', fontSize: '0.8125rem' }}>{task.dueDate || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {(() => {
                        const allIds: string[] = (task.assignees && task.assignees.length > 0) ? task.assignees : (task.assignedUserId ? [task.assignedUserId] : []);
                        if (allIds.length === 0) return <span style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>—</span>;
                        const first = SAMPLE_TEAM_MEMBERS.find(m => m.id === allIds[0]) || { name: allIds[0], color: '#9CA3AF', initials: allIds[0].substring(0,2).toUpperCase() };
                        const extra = allIds.length - 1;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <div title={first.name} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: first.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid white', flexShrink: 0 }}>{first.initials}</div>
                              {extra > 0 && (
                                <div title={`+${extra} more`} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#E5E7EB', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, border: '2px solid white', marginLeft: '-6px', flexShrink: 0 }}>+{extra}</div>
                              )}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: '#374151', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{first.name}</span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {showTaskModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={{ projectId: folderId } as any}
              onSuccess={() => { setShowTaskModal(false); loadHierarchy(); }} 
              onCancel={() => setShowTaskModal(false)} 
            />
          </div>
        </div>
      )}
      {editingTask && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={editingTask}
              onSuccess={() => { setEditingTask(null); loadHierarchy(); }} 
              onCancel={() => setEditingTask(null)} 
            />
          </div>
        </div>
      )}
    </div>
  );
};

const ListPageView: React.FC<{ listId: string }> = ({ listId }) => {
  const [list, setList] = useState<HierarchyList | null>(null);
  const [parentFolder, setParentFolder] = useState<HierarchyFolder | null>(null);
  const [parentSpace, setParentSpace] = useState<HierarchySpace | null>(null);
  const [viewMode, setViewMode] = useState<ListViewMode>("table");
  const [loading, setLoading] = useState(true);

  const [tasks, setTasks] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<any | null>(null);

  const onToggleStar = async (taskId: string) => {
    try {
      const updated = await taskService.toggleTaskStar(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? updated : t));
    } catch (e: any) {
      console.error(e);
    }
  };

  const loadTasks = () => {
    taskService.getTasks().then(allTasks => {
        setTasks(allTasks.filter(t => t.projectId === listId));
    });
  };

  useEffect(() => {
    workspaceService.getHierarchy().then(all => {
      outer: for (const space of all) {
        for (const folder of space.folders) {
          const found = folder.lists.find(l => l.id === listId);
          if (found) { setList(found); setParentFolder(folder); setParentSpace(space); break outer; }
        }
      }
      setLoading(false);
    });
    
    loadTasks();
  }, [listId]);

  if (loading) return <div style={{ padding: "32px", color: "#6B7280" }}>Loading...</div>;

  const viewButtons = [
    { mode: "table" as ListViewMode, icon: <AlignLeft size={14} />, label: "Table" },
    { mode: "board" as ListViewMode, icon: <Grid size={14} />, label: "Board" },
    { mode: "calendar" as ListViewMode, icon: <CalendarDays size={14} />, label: "Calendar" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#FFFFFF" }}>
      <div style={{ padding: "20px 32px 0", borderBottom: "1px solid #E5E7EB", backgroundColor: "white" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px", fontSize: "0.75rem", color: "#9CA3AF" }}>
          <Link to="/" style={{ color: "#9CA3AF", textDecoration: "none" }}>Home</Link>
          <ChevronRight size={11} />
          {parentSpace && <><Link to={`/spaces/${parentSpace.id}`} style={{ color: "#9CA3AF", textDecoration: "none" }}>{parentSpace.name}</Link><ChevronRight size={11} /></>}
          {parentFolder && parentSpace && <><Link to={`/spaces/${parentSpace.id}/folders/${parentFolder.id}`} style={{ color: "#9CA3AF", textDecoration: "none" }}>{parentFolder.name}</Link><ChevronRight size={11} /></>}
          <span style={{ color: "#374151", fontWeight: 600 }}>{list?.name || listId}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ backgroundColor: '#EEF2FF', padding: '8px', borderRadius: '8px' }}>
              <List size={24} color="#4F46E5" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>{list?.name || "List"}</h1>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280' }}>Manage tasks and track progress for this list.</p>
            </div>
          </div>
          
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={{ display: "flex", backgroundColor: "#F3F4F6", borderRadius: "8px", padding: "3px", gap: "2px", marginRight: "12px" }}>
              {viewButtons.map(({ mode, icon, label }) => (
                <button key={mode} onClick={() => setViewMode(mode)}
                  style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 12px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600, transition: "all 0.15s", backgroundColor: viewMode === mode ? "white" : "transparent", color: viewMode === mode ? "#4F46E5" : "#6B7280", boxShadow: viewMode === mode ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                  {icon} {label}
                </button>
              ))}
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#F3F4F6', padding: '8px 12px', borderRadius: '8px', width: '250px' }}>
              <Search size={16} color="#9CA3AF" style={{ marginRight: '8px' }} />
              <input 
                type="text" 
                placeholder="Search tasks..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ border: 'none', outline: 'none', width: '100%', fontSize: '0.875rem', backgroundColor: 'transparent' }} 
              />
            </div>
            <button onClick={() => setShowTaskModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', cursor: 'pointer', padding: '8px 16px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500 }}>
              <Plus size={16} /> New Task
            </button>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, padding: '24px 32px', overflowY: "auto" }}>
        {viewMode === "table" && (
          tasks.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6B7280' }}>
              <List size={48} color="#D1D5DB" style={{ marginBottom: '16px' }} />
              <p style={{ fontSize: '1rem', fontWeight: 500, margin: '0 0 8px 0', color: '#374151' }}>No tasks found in {list?.name}</p>
              <p style={{ fontSize: '0.875rem', margin: '0 0 16px 0' }}>Create a new task to get started.</p>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Task Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Due Date</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Assignee</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {tasks.filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase())).map(task => {
                  
                  return (
                  <tr key={task.id} onClick={() => setEditingTask(task)} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F9FAFB'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#111827' }}>
                      <div style={{ fontWeight: 600, color: '#111827', fontSize: '0.8125rem', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {task.title}
                        <Star 
                          size={14} 
                          color={task.isStarred ? "#F59E0B" : "#D1D5DB"} 
                          fill={task.isStarred ? "#F59E0B" : "none"} 
                          style={{ cursor: 'pointer' }}
                          onClick={(e) => { e.stopPropagation(); onToggleStar(task.id); }} 
                        />
                      </div>
                      {task.description && <div style={{ fontSize: '0.7rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{task.description}</div>}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.priority === 'Critical' ? '#FEE2E2' : task.priority === 'High' ? '#FEF3C7' : '#D1FAE5',
                        color: task.priority === 'Critical' ? '#DC2626' : task.priority === 'High' ? '#D97706' : '#059669',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.priority || 'Medium'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.status === 'Completed' ? '#D1FAE5' : task.status === 'In Progress' ? '#DBEAFE' : '#F3F4F6',
                        color: task.status === 'Completed' ? '#059669' : task.status === 'In Progress' ? '#2563EB' : '#374151',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.status || 'Todo'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#4B5563', fontSize: '0.8125rem' }}>{task.dueDate || '—'}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {(() => {
                        const allIds: string[] = (task.assignees && task.assignees.length > 0) ? task.assignees : (task.assignedUserId ? [task.assignedUserId] : []);
                        if (allIds.length === 0) return <span style={{ color: '#9CA3AF', fontSize: '0.75rem' }}>—</span>;
                        const first = SAMPLE_TEAM_MEMBERS.find(m => m.id === allIds[0]) || { name: allIds[0], color: '#9CA3AF', initials: allIds[0].substring(0,2).toUpperCase() };
                        const extra = allIds.length - 1;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                              <div title={first.name} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: first.color, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, border: '2px solid white', flexShrink: 0 }}>{first.initials}</div>
                              {extra > 0 && (
                                <div title={`+${extra} more`} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#E5E7EB', color: '#6B7280', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, border: '2px solid white', marginLeft: '-6px', flexShrink: 0 }}>+{extra}</div>
                              )}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: '#374151', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{first.name}</span>
                          </div>
                        );
                      })()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}>...</button>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          )
        )}
        {viewMode === "board" && (
          <div style={{ padding: "24px", color: "#9CA3AF", textAlign: "center", marginTop: "60px" }}>
            <p style={{ fontWeight: 600, color: "#6B7280" }}>Board View — Coming Soon</p>
          </div>
        )}
        {viewMode === "calendar" && (
          <div style={{ padding: "24px", color: "#9CA3AF", textAlign: "center", marginTop: "60px" }}>
            <p style={{ fontWeight: 600, color: "#6B7280" }}>Calendar View — Coming Soon</p>
          </div>
        )}
      </div>
      {showTaskModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={{ projectId: listId } as any}
              onSuccess={() => { setShowTaskModal(false); loadTasks(); }} 
              onCancel={() => setShowTaskModal(false)} 
            />
          </div>
        </div>
      )}
      {editingTask && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '450px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <TaskForm 
              initialTask={editingTask}
              onSuccess={() => { setEditingTask(null); loadTasks(); }} 
              onCancel={() => setEditingTask(null)} 
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const SpaceView: React.FC<{ type: "space" | "folder" | "list" }> = ({ type }) => {
  const { spaceId, folderId, listId } = useParams();
  if (type === "space" && spaceId) return <SpacePageView spaceId={spaceId} />;
  if (type === "folder" && folderId) return <FolderPageView folderId={folderId} spaceId={spaceId} />;
  if (type === "list" && listId) return <ListPageView listId={listId} />;
  return <div style={{ padding: "32px", color: "#EF4444" }}>Invalid workspace path.</div>;
};
