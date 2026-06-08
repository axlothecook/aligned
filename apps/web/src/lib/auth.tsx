'use client';
// Auth context: holds the current user + login/signup/logout. Any component reads it
// via useAuth(). Client Component (it has state + runs in the browser).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ApiUser } from '@aligned/core';
import { api } from './api';

type AuthState = {
  user: ApiUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (d: { email: string; username: string; displayName: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    // On first load, check if there's an active session.
    refresh().finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (email, password) => {
      const { user } = await api.login({ email, password });
      setUser(user);
    },
    signup: async (d) => {
      await api.signup(d);
      // signup doesn't log in automatically → log in right after
      const { user } = await api.login({ email: d.email, password: d.password });
      setUser(user);
    },
    logout: async () => {
      await api.logout();
      setUser(null);
    },
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
