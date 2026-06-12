import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext.jsx';

export default function RequireAuth({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="animate-spin text-emerald-700" size={40} />
      </div>
    );
  }
  if (!user) {
    const from = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?from=${from}`} replace />;
  }
  if (adminOnly && user.role !== 'admin') {
    return (
      <div className="p-6 text-center text-red-700" dir="rtl">
        ليس لديك صلاحية الوصول إلى هذه الصفحة.
      </div>
    );
  }
  return children;
}
