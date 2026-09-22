import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  created_at: string;
  updated_at: string;
  is_archived: boolean;
}

export const UserManagementTab: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (uid: string, newRole: string) => {
    try {
      const token = await user?.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/admin/users/${uid}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: newRole })
      });
      if (!res.ok) throw new Error('Failed to update role');
      fetchUsers(); // refresh list
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) return <div>Loading users...</div>;
  if (error) return <div style={{color: 'red'}}>Error: {error}</div>;

  return (
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>User Management</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <thead style={{ backgroundColor: '#F3F4F6', textAlign: 'left' }}>
          <tr>
            <th style={{ padding: '12px', fontSize: '0.875rem', color: '#4B5563' }}>Name</th>
            <th style={{ padding: '12px', fontSize: '0.875rem', color: '#4B5563' }}>Email</th>
            <th style={{ padding: '12px', fontSize: '0.875rem', color: '#4B5563' }}>Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.uid} style={{ borderBottom: '1px solid #E5E7EB' }}>
              <td style={{ padding: '12px', fontSize: '0.875rem' }}>{u.displayName || 'N/A'}</td>
              <td style={{ padding: '12px', fontSize: '0.875rem' }}>{u.email}</td>
              <td style={{ padding: '12px' }}>
                <select 
                  value={u.role}
                  onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                  disabled={u.uid === user?.uid} // Don't allow self role change
                  style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #D1D5DB' }}
                >
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Employee">Employee</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
