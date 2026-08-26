import { getStore } from '@netlify/blobs';

const TOKEN_KEY = 'mercadolibre-token';
const CACHE_KEY = 'dashboard-cache';

export const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

export const env = () => {
  const clientId = process.env.MELI_CLIENT_ID;
  const clientSecret = process.env.MELI_CLIENT_SECRET;
  const redirectUri = process.env.MELI_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Faltan MELI_CLIENT_ID, MELI_CLIENT_SECRET o MELI_REDIRECT_URI en Netlify.');
  }
  return { clientId, clientSecret, redirectUri };
};

const store = () => getStore({ name: 'rockos-intelligence', consistency: 'strong' });

export async function getTokenRecord() {
  return (await store().get(TOKEN_KEY, { type: 'json' })) || null;
}

export async function saveTokenRecord(record) {
  await store().setJSON(TOKEN_KEY, record);
}

export async function deleteTokenRecord() {
  await store().delete(TOKEN_KEY);
  await store().delete(CACHE_KEY);
}

export async function getCache() {
  return (await store().get(CACHE_KEY, { type: 'json' })) || null;
}

export async function saveCache(value) {
  await store().setJSON(CACHE_KEY, value);
}

async function exchangeRefreshToken(refreshToken) {
  const { clientId, clientSecret } = env();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  });
  const response = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || payload.error || 'No se pudo renovar el token.');
  const record = {
    ...payload,
    obtained_at: Date.now(),
    expires_at: Date.now() + Number(payload.expires_in || 21600) * 1000
  };
  await saveTokenRecord(record);
  return record;
}

export async function validToken() {
  let record = await getTokenRecord();
  if (!record?.access_token) throw new Error('NOT_CONNECTED');
  if (Date.now() > Number(record.expires_at || 0) - 120000) {
    if (!record.refresh_token) throw new Error('TOKEN_EXPIRED');
    record = await exchangeRefreshToken(record.refresh_token);
  }
  return record;
}

export async function meli(path, options = {}) {
  const token = await validToken();
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token.access_token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Mercado Libre respondió ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export function money(value, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
}
