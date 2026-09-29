import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../core/firebase';
import { isAllowedDomain } from '../utils/auth';
import { devUser, signOutOfDev } from '../core/devSession';

/** Local testing: the v1 role that goes with a v2 workspace role, so the old pages behave too. */
const DEV_ROLE: Record<string, string> = { owner: 'Admin', admin: 'Admin', member: 'Employee', guest: 'Employee' };

interface AuthContextType {
  user: User | null;
  role: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  hasRole: (allowedRoles: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, role: null, loading: true, logout: async () => {}, hasRole: () => false });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Local testing: pretending to be someone skips Firebase entirely.
    const pretending = devUser();
    if (pretending) {
      setUser({
        uid: pretending.id,
        email: pretending.email,
        displayName: pretending.name,
      } as User);
      setRole(pretending.leads.length ? 'Manager' : DEV_ROLE[pretending.role] ?? 'Employee');
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        if (!isAllowedDomain(u.email)) {
          // Unauthorized domain
          await signOut(auth);
          setUser(null);
          setLoading(false);
          return;
        }

        // Domain is valid, check/create user profile in Firestore
        try {
          const userRef = doc(db, 'users', u.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            const defaultRole = 'Employee';
            const newUser = {
              displayName: u.displayName || u.email?.split('@')[0] || 'User',
              email: u.email,
              role: defaultRole,
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp()
            };
            await setDoc(userRef, newUser);
            setRole(defaultRole);
          } else {
            // Update last login
            const userData = userSnap.data();
            setRole(userData?.role || 'Employee');
            await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
          }
        } catch (error) {
          console.error("Error creating/updating user profile:", error);
        }
      }
      
      setUser(u);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    if (devUser()) {
      signOutOfDev();
      window.location.assign('/login');
      return;
    }
    await signOut(auth);
    setRole(null);
  };

  const hasRole = (allowedRoles: string[]) => {
    if (!role) return false;
    const lowerRole = role.toLowerCase();
    return allowedRoles.map(r => r.toLowerCase()).includes(lowerRole);
  };

  const value = {
    user,
    role,
    loading,
    logout,
    hasRole
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
