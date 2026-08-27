import { json, validToken } from './_shared.mjs';

export default async () => {
  try {
    await validToken();
    return json({
      connected: false,
      status: 'pending_ads_integration',
      message: 'El módulo visual está listo. Para traer inversión, ROAS, ACOS, clics e impresiones falta completar la integración específica de Mercado Ads con el advertiser de la cuenta.',
      metrics: null,
      campaigns: []
    });
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
