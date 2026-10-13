import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { teamService } from '../services/teamService';
import type { Team } from '../services/teamService';
import { useAuth } from '../components/AuthContext';
import { Users, UserPlus, Shield, Crown, User, Plus, X, Search } from 'lucide-react';

export const Teams: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { hasRole } = useAuth();
  const isAdmin = hasRole(['Admin']);
  const isManager = hasRole(['Manager']);
  const navigate = useNavigate();

  // Create Team dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamDesc, setNewTeamDesc] = useState('');
  const [newTeamManagerId, setNewTeamManagerId] = useState('');
  const [creating, setCreating] = useState(false);

  // Add Member dialog state
  const [showAddMemberDialog, setShowAddMemberDialog] = useState<string | null>(null);
  const [addMemberUserId, setAddMemberUserId] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<any[]>([]);

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const data = await teamService.getTeams();
      setTeams(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchTeams(); 
    teamService.getAllUsers().then(setUsers).catch(console.error);
  }, []);

  const handleCreateTeam = async () => {
    if (!newTeamName.trim() || !newTeamManagerId.trim()) return;
    setCreating(true);
    try {
      await teamService.createTeam({ name: newTeamName, description: newTeamDesc, managerId: newTeamManagerId });
      setShowCreateDialog(false);
      setNewTeamName('');
      setNewTeamDesc('');
      setNewTeamManagerId('');
      fetchTeams();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleAddMember = async (teamId: string) => {
    if (!addMemberUserId.trim()) return;
    setAddingMember(true);
    try {
      await teamService.addMember(teamId, addMemberUserId);
      setShowAddMemberDialog(null);
      setAddMemberUserId('');
      fetchTeams();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAddingMember(false);
    }
  };

  const getRoleBadge = (role: string) => {
    const colors: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
      Admin: { bg: '#FEE2E2', text: '#991B1B', icon: <Shield size={12} /> },
      Manager: { bg: '#DBEAFE', text: '#1E40AF', icon: <Crown size={12} /> },
      Employee: { bg: '#F3F4F6', text: '#374151', icon: <User size={12} /> },
    };
    const c = colors[role] || colors.Employee;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, backgroundColor: c.bg, color: c.text }}>
        {c.icon} {role}
      </span>
    );
  };

  const filteredTeams = teams.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.members.some(m => m.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (loading) {
    return (
      <div style={{ padding: 'var(--spacing-8)', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '40px', height: '40px', border: '3px solid #E5E7EB', borderTop: '3px solid var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--color-text-secondary)' }}>Loading teams...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--spacing-8)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={24} /> {isAdmin ? 'All Teams' : 'My Teams'}
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
            {isAdmin ? "Manage your organization's teams and members" : "Manage the teams you lead"}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF' }} />
            <input
              type="text"
              placeholder="Search teams..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', width: '220px', outline: 'none' }}
            />
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowCreateDialog(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', backgroundColor: 'var(--color-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer' }}
            >
              <Plus size={16} /> Create Team
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: '8px', marginBottom: '16px', fontSize: '0.875rem' }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B' }}><X size={14} /></button>
        </div>
      )}

      {/* Teams Grid */}
      {filteredTeams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-secondary)' }}>
          <Users size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h3 style={{ fontWeight: 600, marginBottom: '8px' }}>No teams yet</h3>
          <p style={{ fontSize: '0.875rem' }}>Create your first team to get started with team management.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '20px' }}>
          {filteredTeams.map(team => (
            <div key={team.id} style={{
              backgroundColor: 'white', borderRadius: '12px', border: '1px solid var(--color-border)',
              padding: '24px', transition: 'all 0.2s', cursor: 'pointer'
            }}
              onClick={() => navigate(`/teams/${team.id}`)}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
            >
              {/* Team Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: '4px' }}>{team.name}</h3>
                  {team.description && <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{team.description}</p>}
                </div>
                <span style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, backgroundColor: '#EEF2FF', color: '#4F46E5' }}>
                  {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Members List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                {team.members.map(member => (
                  <div key={member.userId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderRadius: '8px', backgroundColor: '#F9FAFB'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '50%',
                        backgroundColor: member.role === 'Manager' ? '#DBEAFE' : '#E5E7EB',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700,
                        color: member.role === 'Manager' ? '#1E40AF' : '#374151'
                      }}>
                        {member.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>{member.name}</div>
                        <div style={{ fontSize: '0.7rem', color: '#6B7280' }}>{member.email}</div>
                      </div>
                    </div>
                    {getRoleBadge(member.role)}
                  </div>
                ))}
              </div>

              {/* Add Member Button */}
              {(isAdmin || isManager) && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAddMemberDialog(team.id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px', width: '100%', justifyContent: 'center',
                    padding: '8px', border: '1px dashed var(--color-border)', borderRadius: '8px',
                    backgroundColor: 'transparent', color: 'var(--color-text-secondary)', cursor: 'pointer',
                    fontSize: '0.8125rem', fontWeight: 500, transition: 'all 0.15s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                >
                  <UserPlus size={14} /> Add Member
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Team Dialog */}
      {showCreateDialog && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
          onClick={() => setShowCreateDialog(false)}>
          <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '32px', width: '440px', maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} /> Create New Team
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>Team Name *</label>
                <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="e.g., Engineering"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>Description</label>
                <input value={newTeamDesc} onChange={e => setNewTeamDesc(e.target.value)} placeholder="Brief description of the team"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>Manager *</label>
                <select value={newTeamManagerId} onChange={e => setNewTeamManagerId(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box', backgroundColor: 'white' }}>
                  <option value="">Select a Manager...</option>
                  {users.filter(u => u.role === 'Manager' || u.role === 'Admin').map(u => (
                    <option key={u.uid} value={u.uid}>{u.display_name || u.email} ({u.role})</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
              <button onClick={() => setShowCreateDialog(false)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
              <button onClick={handleCreateTeam} disabled={creating || !newTeamName.trim() || !newTeamManagerId.trim()}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', opacity: creating ? 0.7 : 1 }}>
                {creating ? 'Creating...' : 'Create Team'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      {showAddMemberDialog && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}
          onClick={() => setShowAddMemberDialog(null)}>
          <div style={{ backgroundColor: 'white', borderRadius: '16px', padding: '32px', width: '400px', maxWidth: '90vw' }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UserPlus size={18} /> Add Team Member
            </h2>
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>Select User *</label>
              <select value={addMemberUserId} onChange={e => setAddMemberUserId(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box', backgroundColor: 'white' }}>
                <option value="">Select a User...</option>
                {users.map(u => (
                  <option key={u.uid} value={u.uid}>{u.display_name || u.email} ({u.role})</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => setShowAddMemberDialog(null)} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid var(--color-border)', background: 'white', cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
              <button onClick={() => handleAddMember(showAddMemberDialog)} disabled={addingMember || !addMemberUserId.trim()}
                style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', backgroundColor: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem', opacity: addingMember ? 0.7 : 1 }}>
                {addingMember ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
