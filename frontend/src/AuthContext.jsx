import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { setOn401Handler } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setTenant(data.tenant || null);
      return data.user;
    } catch {
      setUser(null);
      setTenant(null);
      return null;
    }
  }, []);

  useEffect(() => {
    setOn401Handler(() => {
      setUser(null);
      setTenant(null);
      if (location.pathname !== '/login') {
        navigate('/login?from=' + encodeURIComponent(location.pathname + location.search), { replace: true });
      }
    });
    fetchMe().finally(() => setLoading(false));
  }, [fetchMe, navigate, location.pathname, location.search]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data.user);
    setTenant(data.tenant || null);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    setUser(null);
    setTenant(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <AuthCtx.Provider value={{ user, tenant, loading, login, logout, refresh: fetchMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
