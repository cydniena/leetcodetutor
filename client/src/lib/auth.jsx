import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // On boot, ask the server who we are. The cookie is HttpOnly so this is the
  // only way to know -- there is no client-side token to inspect.
  useEffect(() => {
    api.get('/auth/me')
      .then(({ user: u }) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email, password) => {
    const { user: u } = await api.post('/auth/login', { email, password });
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (email, password) => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const { user: u } = await api.post('/auth/register', { email, password, timezone });
    setUser(u);
    return u;
  }, []);

  // The server rotates the session cookie and drops this user's other
  // sessions, so the browser is still signed in when this resolves.
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { user: u } = await api.patch('/auth/me/password', { currentPassword, newPassword });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, register, logout, changePassword, isAdmin: user?.role === 'admin' }),
    [user, ready, login, register, logout, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
