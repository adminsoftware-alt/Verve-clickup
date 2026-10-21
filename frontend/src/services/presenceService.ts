import { auth, db } from '../core/firebase';
import { collection, doc, setDoc, getDoc, onSnapshot, query, getDocs } from 'firebase/firestore';

export type PresenceStatus =
  | 'Available' | 'Busy' | 'In Meeting' | 'Focus Mode' | 'Do Not Disturb' | 'Break' | 'Lunch'
  | 'Work From Home' | 'In Office' | 'Client Visit' | 'Travelling' | 'In Training' | 'Sick Leave'
  | 'On Leave' | 'Offline';

/** Every status and its dot colour, in the order the picker offers them. */
export const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  'Available': '#10B981',
  'Busy': '#EF4444',
  'In Meeting': '#F59E0B',
  'Focus Mode': '#8B5CF6',
  'Do Not Disturb': '#B91C1C',
  'Break': '#3B82F6',
  'Lunch': '#F97316',
  'Work From Home': '#14B8A6',
  'In Office': '#2563EB',
  'Client Visit': '#0EA5E9',
  'Travelling': '#6366F1',
  'In Training': '#A855F7',
  'Sick Leave': '#EC4899',
  'On Leave': '#6B7280',
  'Offline': '#9CA3AF',
};
export type WorkingLocation = 'Office' | 'Remote' | 'Client Site' | 'Business Travel';

export interface UserPresence {
  userId: string;
  name: string;
  avatarColor: string;
  initials: string;
  currentStatus: PresenceStatus;
  customStatus?: string;
  workingLocation?: WorkingLocation;
  lastSeen: string; // ISO string
  timerRunning: boolean;
  updatedAt: string; // ISO string
  currentTask?: string;
}

// Fallback to local storage if Firestore fails
const getLocalPresence = (): Record<string, UserPresence> => {
  return JSON.parse(localStorage.getItem('timetriq_presence') || '{}');
};

const saveLocalPresence = (data: Record<string, UserPresence>) => {
  localStorage.setItem('timetriq_presence', JSON.stringify(data));
};

export const presenceService = {
  updatePresence: async (updates: Partial<UserPresence>) => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      
      const userId = user.uid;
      const presenceRef = doc(db, 'userPresence', userId);
      
      const currentDoc = await getDoc(presenceRef);
      const now = new Date().toISOString();
      
      const newPresence: Partial<UserPresence> = {
        ...updates,
        userId,
        lastSeen: now,
        updatedAt: now,
      };

      if (!currentDoc.exists()) {
        // Create full
        const fullPresence: UserPresence = {
          userId,
          name: user.displayName || user.email?.split('@')[0] || 'User',
          avatarColor: '#4F46E5', // default
          initials: (user.displayName || user.email || 'U').substring(0, 2).toUpperCase(),
          currentStatus: 'Available',
          timerRunning: false,
          lastSeen: now,
          updatedAt: now,
          ...updates
        };
        await setDoc(presenceRef, fullPresence);
      } else {
        await setDoc(presenceRef, newPresence, { merge: true });
      }

      // Update local storage as fallback
      const local = getLocalPresence();
      local[userId] = { ...local[userId], ...newPresence } as UserPresence;
      saveLocalPresence(local);

    } catch (error) {
      console.warn("Failed to update presence in Firestore, updating locally", error);
      const user = auth.currentUser;
      if (user) {
        const local = getLocalPresence();
        const userId = user.uid;
        const now = new Date().toISOString();
        const existing = local[userId] || {};
        local[userId] = {
          ...existing,
          userId,
          name: user.displayName || user.email?.split('@')[0] || 'User',
          avatarColor: '#4F46E5',
          initials: (user.displayName || user.email || 'U').substring(0, 2).toUpperCase(),
          currentStatus: 'Available' as PresenceStatus,
          timerRunning: false,
          lastSeen: now,
          updatedAt: now,
          ...updates
        };
        saveLocalPresence(local);
      }
    }
  },

  getAllPresence: async (): Promise<UserPresence[]> => {
    try {
      const q = query(collection(db, 'userPresence'));
      const snapshot = await getDocs(q);
      const presence: UserPresence[] = [];
      snapshot.forEach(doc => {
        presence.push(doc.data() as UserPresence);
      });
      return presence;
    } catch (error) {
      console.warn("Falling back to local storage for presence");
      const local = getLocalPresence();
      return Object.values(local);
    }
  },

  subscribeToPresence: (callback: (presence: UserPresence[]) => void) => {
    try {
      const q = query(collection(db, 'userPresence'));
      return onSnapshot(q, (snapshot) => {
        const presence: UserPresence[] = [];
        snapshot.forEach(doc => {
          presence.push(doc.data() as UserPresence);
        });
        callback(presence);
        
        // sync to local
        const local = getLocalPresence();
        presence.forEach(p => local[p.userId] = p);
        saveLocalPresence(local);
      }, (error) => {
        console.warn("Firestore subscription error", error);
        callback(Object.values(getLocalPresence()));
      });
    } catch (error) {
      console.warn("Failed to subscribe to Firestore", error);
      // Fallback polling
      const interval = setInterval(() => {
        callback(Object.values(getLocalPresence()));
      }, 5000);
      return () => clearInterval(interval);
    }
  }
};
