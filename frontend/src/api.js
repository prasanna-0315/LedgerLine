// All data comes from the real backend. Balances are never calculated here.
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
const TOKEN_KEY = 'll_token';
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY));

export async function api(method, path, body, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let res;
  try { res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw { status: 0, message: 'Cannot reach the server' }; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, message: data.errors?.map(e => e.message).join(', ') || data.message || 'Request failed', data };
  return data;
}
export const newKey = () => crypto.randomUUID();
export const inr = (s) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(s); // display only
