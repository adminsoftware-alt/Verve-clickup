import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Circle } from 'lucide-react';
import { useAuth } from './AuthContext';
import { presenceService, PRESENCE_COLORS } from '../services/presenceService';
import type { PresenceStatus } from '../services/presenceService';

const statusColors = PRESENCE_COLORS;
// Everything but Offline, which is what you are when you are not signed in, not a choice.
const statuses = (Object.keys(PRESENCE_COLORS) as PresenceStatus[]).filter((s) => s !== 'Offline');

export const StatusSelector: React.FC<{ align?: 'left' | 'right' }> = ({ align = 'right' }) => {
  const { user } = useAuth();
  const [currentStatus, setCurrentStatus] = useState<PresenceStatus>('Available');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    // We subscribe to all presences, but only care about the current user
    const unsubscribe = presenceService.subscribeToPresence((presences) => {
      const myPresence = presences.find(p => p.userId === user.uid);
      if (myPresence) {
        setCurrentStatus(myPresence.currentStatus);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, []);

  const handleStatusChange = async (status: PresenceStatus) => {
    setCurrentStatus(status);
    setIsOpen(false);
    await presenceService.updatePresence({ currentStatus: status });
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: '1px solid var(--color-border)',
          cursor: 'pointer',
          padding: '6px 12px',
          borderRadius: '20px',
          backgroundColor: '#FFFFFF',
          transition: 'all 0.15s ease',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151'
        }}
        title="Set your status"
      >
        <Circle size={10} fill={statusColors[currentStatus] || '#10B981'} color={statusColors[currentStatus] || '#10B981'} />
        <span>{currentStatus}</span>
        <ChevronDown size={14} color="var(--color-text-secondary)" />
      </button>
      
      {isOpen && (
        <div style={{
          position: 'absolute',
          [align]: 0,
          top: '100%',
          marginTop: '8px',
          backgroundColor: 'white',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          minWidth: '180px',
          maxHeight: '360px',
          zIndex: 100,
          overflowY: 'auto'
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #F3F4F6', fontSize: '0.7rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' }}>
            Set Status
          </div>
          {statuses.map(status => (
            <button
              key={status}
              onClick={() => handleStatusChange(status)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                padding: '10px 16px',
                fontSize: '0.8125rem',
                color: '#374151',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F9FAFB'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Circle size={10} fill={statusColors[status]} color={statusColors[status]} />
              {status}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
