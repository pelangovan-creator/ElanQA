import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';
import type { User } from './types';

interface AuthCtx { user: User | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void }
const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem('qapilot.project');
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  useEffect(() => {
    if (tokenStore.get()) api<User>('/auth/me').then(setUser).catch(logout).finally(() => setLoading(false));
    const onLogout = () => setUser(null);
    window.addEventListener('qapilot:logout', onLogout);
    return () => window.removeEventListener('qapilot:logout', onLogout);
  }, [logout]);

  const login = async (email: string, password: string) => {
    const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', json: { email, password } });
    tokenStore.set(res.token);
    queryClient.clear();
    setUser(res.user);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
