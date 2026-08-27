import { json, getSettings, saveSettings, validToken } from './_shared.mjs';

const bounded = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export default async (request) => {
  try {
    await validToken();
    if (request.method === 'GET') return json(await getSettings());
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
    const body = await request.json();
    const current = await getSettings();
    const settings = {
      leadTimeDays: bounded(body.leadTimeDays, 1, 180, current.leadTimeDays),
      safetyStockDays: bounded(body.safetyStockDays, 0, 90, current.safetyStockDays),
      targetMargin: bounded(body.targetMargin, 0, 0.95, current.targetMargin),
      currency: 'ARS'
    };
    await saveSettings(settings);
    return json(settings);
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
