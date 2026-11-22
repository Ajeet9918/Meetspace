import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api, refresh, setSessionExpiredHandler } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    refresh().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (creds) => setUser(await api.login(creds)), []);
  const signup = useCallback(async (data) => setUser(await api.signup(data)), []);
  const logout = useCallback(async () => { await api.logout().catch(() => {}); setUser(null); }, []);
  const logoutAll = useCallback(async () => { await api.logoutAll().catch(() => {}); setUser(null); }, []);

  const value = useMemo(() => ({ user, loading, login, signup, logout, logoutAll }), [user, loading, login, signup, logout, logoutAll]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
