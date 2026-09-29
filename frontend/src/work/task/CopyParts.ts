// What a duplicated task carries over.
//
// Mirrors CopyParts on the server, and the defaults match: everything travels except the two
// things that would make the copy lie about itself. A ticked checklist item is somebody else's
// finished work, and a comment thread is a conversation that happened once, to a task that is
// not this one.
export interface CopyParts {
  assignees: boolean;
  followers: boolean;
  attachments: boolean;
  checklists: boolean;
  keep_checked_items: boolean;
  comments: boolean;
  custom_fields: boolean;
  dates: boolean;
  keep_status: boolean;
  tags: boolean;
  task_type: boolean;
  recurrence: boolean;
  relationships: boolean;
  subtasks: boolean;
}

export const ALL_PARTS: CopyParts = {
  assignees: true, followers: true, attachments: true, checklists: true, keep_checked_items: false,
  comments: false, custom_fields: true, dates: true, keep_status: true, tags: true,
  task_type: true, recurrence: true, relationships: true, subtasks: true,
};

/** In the order they are shown, two to a row, with the dependent ones under their parent. */
export const PART_LABELS: { key: keyof CopyParts; label: string; under?: keyof CopyParts }[] = [
  { key: 'assignees', label: 'Assignees' },
  { key: 'attachments', label: 'Attachments' },
  { key: 'checklists', label: 'Checklists' },
  { key: 'keep_checked_items', label: 'Keep checked items', under: 'checklists' },
  { key: 'comments', label: 'Comments' },
  { key: 'custom_fields', label: 'Custom fields' },
  { key: 'dates', label: 'Start and due dates' },
  { key: 'keep_status', label: 'Keep task status' },
  { key: 'followers', label: 'Followers' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'recurrence', label: 'Recurring settings' },
  { key: 'subtasks', label: 'Subtasks' },
  { key: 'tags', label: 'Tags' },
  { key: 'task_type', label: 'Task type' },
];
