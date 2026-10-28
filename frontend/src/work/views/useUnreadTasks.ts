// Which tasks have a comment you haven't read yet, taken from your Inbox -- the one place that
// already knows what you have and haven't seen. Asked once per list, not once per row.
import { useEffect, useState } from 'react';
import { collabApi } from '../collabApi';
import { useWork } from '../WorkContext';

export function useUnreadTasks(): Set<string> {
  const { workspace } = useWork();
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!workspace) return;
    let live = true;
    collabApi.inbox(workspace.id, 'all')
      .then((items) => {
        if (!live) return;
        setIds(new Set(items.filter((i) => !i.read && i.comment && i.task).map((i) => i.task!.id)));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [workspace]);
  return ids;
}
