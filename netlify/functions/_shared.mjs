import { getStore } from '@netlify/blobs';

const TOKEN_KEY = 'mercadolibre-token';
const CACHE_KEY = 'dashboard-cache';
const COSTS_KEY = 'product-costs';
const SETTINGS_KEY = 'business-settings';

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

export async function getCache(key = CACHE_KEY) {
  return (await store().get(key, { type: 'json' })) || null;
}

export async function saveCache(value, key = CACHE_KEY) {
  await store().setJSON(key, value);
}

export async function clearCache(prefixes = [CACHE_KEY, 'history-', 'dashboard-']) {
  await store().delete(CACHE_KEY);
  // Netlify Blobs has no cheap wildcard delete in this setup. Versioned cache keys expire logically.
  return prefixes;
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

export async function fetchOrders({ sellerId, from, to }) {
  const rows = [];
  const limit = 50;
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await meli(`/orders/search?seller=${sellerId}&order.date_created.from=${encodeURIComponent(from.toISOString())}&order.date_created.to=${encodeURIComponent(to.toISOString())}&sort=date_desc&limit=${limit}&offset=${offset}`);
    const results = page.results || [];
    rows.push(...results);
    total = Number(page.paging?.total ?? rows.length);
    offset += results.length;
    if (!results.length) break;
  }
  return rows;
}

export function paidOrders(rows) {
  return (rows || []).filter(o => ['paid', 'confirmed'].includes(o.status));
}

export function money(value, currency = 'ARS') {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
}

export async function getCostsRecord() {
  return (await store().get(COSTS_KEY, { type: 'json' })) || { importedAt: null, fileName: null, products: [] };
}

export async function saveCostsRecord(record) {
  await store().setJSON(COSTS_KEY, record);
  await clearCache();
}

export async function getSettings() {
  return (await store().get(SETTINGS_KEY, { type: 'json' })) || {
    leadTimeDays: 20,
    safetyStockDays: 7,
    targetMargin: 0.30,
    currency: 'ARS'
  };
}

export async function saveSettings(settings) {
  await store().setJSON(SETTINGS_KEY, settings);
  await clearCache();
}

export function startOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
}

export function endOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

export function dateKey(date) {
  return date.toISOString().slice(0, 10);
}
