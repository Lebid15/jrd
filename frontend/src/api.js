import axios from 'axios';

// 401 handler يضبطه AuthProvider لتفادي الاعتماد الدوري بين api.js و AuthContext.
let on401Handler = null;
export function setOn401Handler(fn) {
  on401Handler = fn;
}

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || '';
    // لا نوجّه لـ /login إذا الطلب نفسه هو login/me أثناء الإقلاع
    const isAuthEndpoint = url.startsWith('/auth/login') || url.startsWith('/auth/me');
    if (status === 401 && !isAuthEndpoint && typeof on401Handler === 'function') {
      on401Handler();
    }
    return Promise.reject(err);
  }
);

export default api;
