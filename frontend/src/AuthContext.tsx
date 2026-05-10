import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, tokenStore } from './api';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'instructor' | 'student';
  created_at: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string, name: string, role: 'instructor' | 'student') => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStore.get();
        if (token) {
          const res = await api.get('/auth/me');
          setUser(res.data);
        }
      } catch {
        await tokenStore.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const res = await api.post('/auth/login', { email, password });
      await tokenStore.set(res.data.access_token);
      setUser(res.data.user);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.response?.data?.detail || 'Login failed' };
    }
  };

  const signUp = async (email: string, password: string, name: string, role: 'instructor' | 'student') => {
    try {
      const res = await api.post('/auth/register', { email, password, name, role });
      await tokenStore.set(res.data.access_token);
      setUser(res.data.user);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.response?.data?.detail || 'Registration failed' };
    }
  };

  const signOut = async () => {
    await tokenStore.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
