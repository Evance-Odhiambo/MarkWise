
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getStudentSession,
  getLecturerSession,
  saveStudentSession,
  saveLecturerSession,
  clearStudentSession,
  clearLecturerSession,
  subscribeAuthSessionChanges
} from '../utils/authSession';
import { registerPushToken } from '../utils/studentAuthApi';
import { registerLecturerPushToken } from '../utils/lecturerAuthApi';

const AuthContext = createContext({
  user: null,
  role: null,
  isLoading: false,
  signIn: async () => {},
  signOut: async () => {},
  refreshSession: async () => {},
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load session on mount
  const loadSession = useCallback(async () => {
    setIsLoading(true);
    let session = await getLecturerSession();
    if (session) {
      if (session.id) delete session.id;
      if (!session.lecturerId) {
        console.warn('[AuthContext] Lecturer session loaded but lecturerId is missing!', session);
      }
      setUser(session);
      setRole('lecturer');
      // Re-register FCM token in case it rotated since last sign-in
      registerLecturerPushToken().catch(() => {});
      setIsLoading(false);
      return;
    }
    session = await getStudentSession();
    if (session) {
      setUser(session);
      setRole('student');
      // Re-register FCM token in case it rotated since last sign-in
      registerPushToken().catch(() => {});
    } else {
      setUser(null);
      setRole(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadSession();
    // Subscribe to session changes
    const unsubscribe = subscribeAuthSessionChanges(() => {
      loadSession();
    });
    return unsubscribe;
  }, [loadSession]);

  // Unified signIn for both roles
  const signIn = async ({ authPayload, admissionNumberOrEmail, emailOrPhoneNumber, role }) => {
    setIsLoading(true);
    let session = null;
    if (role === 'student') {
      session = await saveStudentSession({ authPayload, admissionNumberOrEmail });
    } else if (role === 'lecturer') {
      session = await saveLecturerSession({ authPayload, emailOrPhoneNumber });
    }
    await loadSession();
    setIsLoading(false);
    return session;
  };

  // Unified signOut
  const signOut = async () => {
    setIsLoading(true);
    if (role === 'student') {
      await clearStudentSession();
    } else if (role === 'lecturer') {
      await clearLecturerSession();
    }
    await loadSession();
    setIsLoading(false);
  };

  // Manual refresh
  const refreshSession = async () => {
    await loadSession();
  };

  return (
    <AuthContext.Provider value={{ user, role, isLoading, signIn, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
