import { getToken, onMessage } from 'firebase/messaging';
import { messaging, auth } from '../core/firebase';
import toast from 'react-hot-toast';

export const requestNotificationPermission = async (token: string) => {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const msg = await messaging();
      if (!msg) {
        console.warn('Messaging not supported on this browser.');
        return;
      }
      
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
          console.warn('VITE_FIREBASE_VAPID_KEY is not defined. Cannot get FCM token.');
          return;
      }

      const currentToken = await getToken(msg, { vapidKey });
      
      if (currentToken) {
        // Send token to backend to save for this user
        await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/notifications/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ token: currentToken })
        });
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    }
  } catch (error) {
    console.error('An error occurred while retrieving token. ', error);
  }
};

export const setupMessageListener = async (onMessageReceived?: (payload: any) => void) => {
  const msg = await messaging();
  if (msg) {
    onMessage(msg, (payload) => {
      console.log('Message received in foreground: ', payload);
      if (onMessageReceived) {
        onMessageReceived(payload);
      }
      if (payload.notification) {
        toast.success(
          `${payload.notification.title}: ${payload.notification.body}`,
          { duration: 5000, position: 'top-right' }
        );
      }
    });
  }
};

// Also send config to service worker to initialize it
export const initializeServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/firebase-messaging-sw.js')
      .then((registration) => {
        if (registration.active) {
          registration.active.postMessage({
            type: 'INITIALIZE_FIREBASE',
            firebaseConfig: {
              apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
              authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
              projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
              storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
              messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
              appId: import.meta.env.VITE_FIREBASE_APP_ID,
            }
          });
        }
      });
  }
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001/api/v1';

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  entityType: string;
  entityId: string;
  triggeredBy: string;
  isRead: boolean;
  createdAt: string;
}

export const appNotificationService = {
  getNotifications: async (): Promise<AppNotification[]> => {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('NETWORK_SKIP: User not authenticated');
      const token = await user.getIdToken();
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
      
      const response = await fetch(`${API_BASE_URL}/notifications/`, { headers });
      if (!response.ok) throw new Error('Failed to fetch notifications');
      return await response.json();
    } catch (e) {
      console.warn("Backend not available, using local storage notifications.", e);
      return [];
    }
  },

  markAsRead: async (id: string): Promise<void> => {
    try {
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
      
      const response = await fetch(`${API_BASE_URL}/notifications/${id}/read`, { 
        method: 'PATCH',
        headers 
      });
      if (!response.ok) throw new Error('Failed to mark read');
    } catch (e) {
      console.warn("Failed to mark read", e);
    }
  }
};
