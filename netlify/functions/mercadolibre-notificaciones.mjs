import { getStore } from '@netlify/blobs';

export default async (request) => {
  if (request.method !== 'POST') return new Response('Endpoint activo', { status: 200 });
  let payload = null;
  try { payload = await request.json(); } catch {}
  try {
    const store = getStore({ name: 'rockos-events', consistency: 'eventual' });
    await store.setJSON(`${Date.now()}-${crypto.randomUUID()}`, { receivedAt: new Date().toISOString(), payload });
  } catch (error) {
    console.error('No se pudo guardar la notificación:', error);
  }
  return new Response('OK', { status: 200 });
};
