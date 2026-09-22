import React, { useState } from 'react';
import { Folder, FolderOpen, List as ListIcon, ChevronRight, ChevronDown, Plus, Search, MoreVertical, Layout, Box } from 'lucide-react';

type ItemType = 'space' | 'folder' | 'list';

interface HierarchyItem {
  id: string;
  name: string;
  type: ItemType;
  color?: string;
  children?: HierarchyItem[];
}

const SAMPLE_HIERARCHY: HierarchyItem[] = [
  {
    id: 'space-1',
    name: 'Engineering Space',
    type: 'space',
    color: '#4F46E5',
    children: [
      {
        id: 'folder-1',
        name: 'Frontend Development',
        type: 'folder',
        color: '#3B82F6',
        children: [
          { id: 'list-1', name: 'Sprint 42', type: 'list', color: '#10B981' },
          { id: 'list-2', name: 'Backlog', type: 'list', color: '#6B7280' },
        ]
      },
      {
        id: 'folder-2',
        name: 'Backend Infrastructure',
        type: 'folder',
        color: '#8B5CF6',
        children: [
          { id: 'list-3', name: 'API V2', type: 'list', color: '#F59E0B' },
          { id: 'list-4', name: 'Database Migration', type: 'list', color: '#EF4444' }
        ]
      }
    ]
  },
  {
    id: 'space-2',
    name: 'Marketing Space',
    type: 'space',
    color: '#EC4899',
    children: [
      {
        id: 'folder-3',
        name: 'Q3 Campaigns',
        type: 'folder',
        color: '#F43F5E',
        children: [
          { id: 'list-5', name: 'Social Media', type: 'list', color: '#06B6D4' },
          { id: 'list-6', name: 'Email Newsletter', type: 'list', color: '#84CC16' }
        ]
      }
    ]
  }
];

const MOCK_TASKS: Record<string, any[]> = {
  'list-1': [
    { id: 't1', title: 'Implement Dashboard UI', status: 'In Progress', priority: 'High', assignee: 'HJ' },
    { id: 't2', title: 'Fix Navbar Responsive Bug', status: 'Todo', priority: 'Medium', assignee: 'SA' },
    { id: 't3', title: 'Update Auth Context', status: 'Completed', priority: 'Critical', assignee: 'VS' },
  ],
  'list-3': [
    { id: 't4', title: 'Setup FastAPI Router', status: 'In Progress', priority: 'High', assignee: 'ME' },
    { id: 't5', title: 'Configure PostgreSQL', status: 'Todo', priority: 'High', assignee: 'SA' },
  ]
};

const HierarchyNode: React.FC<{ item: HierarchyItem, level: number, selectedId: string, onSelect: (id: string) => void }> = ({ item, level, selectedId, onSelect }) => {
  const [expanded, setExpanded] = useState(level === 0);
  const isSelected = selectedId === item.id;
  const hasChildren = item.children && item.children.length > 0;

  return (
    <div>
      <div 
        onClick={() => {
          onSelect(item.id);
          if (hasChildren) setExpanded(!expanded);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `8px 12px 8px ${12 + level * 16}px`,
          cursor: 'pointer',
          backgroundColor: isSelected ? '#EEF2FF' : 'transparent',
          borderRadius: '6px',
          color: isSelected ? '#4F46E5' : '#374151',
          transition: 'all 0.2s'
        }}
        className="hierarchy-node"
      >
        <div style={{ width: '16px', display: 'flex', justifyContent: 'center', marginRight: '4px' }}>
          {hasChildren && (
            expanded ? <ChevronDown size={14} color="#6B7280" /> : <ChevronRight size={14} color="#6B7280" />
          )}
        </div>
        
        {item.type === 'space' && <Box size={16} color={item.color || '#4F46E5'} style={{ marginRight: '8px' }} />}
        {item.type === 'folder' && (expanded ? <FolderOpen size={16} color={item.color || '#3B82F6'} style={{ marginRight: '8px' }} /> : <Folder size={16} color={item.color || '#3B82F6'} style={{ marginRight: '8px' }} />)}
        {item.type === 'list' && <ListIcon size={16} color={item.color || '#10B981'} style={{ marginRight: '8px' }} />}
        
        <span style={{ fontSize: '0.875rem', fontWeight: item.type === 'space' ? 600 : 500, userSelect: 'none' }}>{item.name}</span>
      </div>
      
      {expanded && hasChildren && (
        <div style={{ marginTop: '4px' }}>
          {item.children!.map(child => (
            <HierarchyNode key={child.id} item={child} level={level + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Projects: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string>('list-1');
  const [searchTerm, setSearchTerm] = useState('');

  const findItemName = (nodes: HierarchyItem[], id: string): string => {
    for (const node of nodes) {
      if (node.id === id) return node.name;
      if (node.children) {
        const found = findItemName(node.children, id);
        if (found) return found;
      }
    }
    return '';
  };

  const selectedName = findItemName(SAMPLE_HIERARCHY, selectedId) || 'Select a list';
  const currentTasks = MOCK_TASKS[selectedId] || [];

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', backgroundColor: '#FFFFFF', borderRadius: '12px', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
      
      {/* Sidebar */}
      <div style={{ width: '280px', borderRight: '1px solid var(--color-border)', backgroundColor: '#F9FAFB', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Spaces & Projects</h2>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}><Plus size={16} /></button>
        </div>
        
        <div style={{ padding: '12px', flex: 1, overflowY: 'auto' }}>
          {SAMPLE_HIERARCHY.map(space => (
            <HierarchyNode key={space.id} item={space} level={0} selectedId={selectedId} onSelect={setSelectedId} />
          ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#FFFFFF' }}>
        <div style={{ padding: '24px 32px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ backgroundColor: '#EEF2FF', padding: '8px', borderRadius: '8px' }}>
              <Layout size={24} color="#4F46E5" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 4px 0', color: '#111827' }}>{selectedName}</h1>
              <p style={{ margin: 0, fontSize: '0.8125rem', color: '#6B7280' }}>Manage tasks and track progress for this project.</p>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
            <button className="premium-btn premium-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Plus size={16} /> New Task
            </button>
          </div>
        </div>

        <div style={{ flex: 1, padding: '24px 32px', overflowY: 'auto' }}>
          {currentTasks.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6B7280' }}>
              <ListIcon size={48} color="#D1D5DB" style={{ marginBottom: '16px' }} />
              <p style={{ fontSize: '1rem', fontWeight: 500, margin: '0 0 8px 0', color: '#374151' }}>No tasks found in {selectedName}</p>
              <p style={{ fontSize: '0.875rem', margin: '0 0 16px 0' }}>Create a new task to get started.</p>
              <button className="premium-btn premium-btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Plus size={16} /> New Task
              </button>
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#6B7280', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Task Name</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Priority</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600 }}>Assignee</th>
                  <th style={{ padding: '12px 16px', fontWeight: 600, width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {currentTasks.filter(t => t.title.toLowerCase().includes(searchTerm.toLowerCase())).map(task => (
                  <tr key={task.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#111827' }}>{task.title}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.status === 'Completed' ? '#D1FAE5' : task.status === 'In Progress' ? '#DBEAFE' : '#F3F4F6',
                        color: task.status === 'Completed' ? '#059669' : task.status === 'In Progress' ? '#2563EB' : '#374151',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ 
                        backgroundColor: task.priority === 'Critical' ? '#FEE2E2' : task.priority === 'High' ? '#FEF3C7' : '#D1FAE5',
                        color: task.priority === 'Critical' ? '#DC2626' : task.priority === 'High' ? '#D97706' : '#059669',
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600
                      }}>
                        {task.priority}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#4F46E5', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600 }}>
                        {task.assignee}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}><MoreVertical size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
