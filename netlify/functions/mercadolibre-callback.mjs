import { env, saveTokenRecord } from './_shared.mjs';

function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  return cookie.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

export default async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const returnedState = url.searchParams.get('state');
  const expectedState = readCookie(request, 'meli_oauth_state');

  if (error) return new Response(`Mercado Libre rechazó la autorización: ${error}`, { status: 400 });
  if (!code) return new Response('Falta el código de autorización.', { status: 400 });
  if (!returnedState || !expectedState || returnedState !== expectedState) {
    return new Response('La validación de seguridad OAuth falló. Volvé a iniciar la conexión.', { status: 400 });
  }

  try {
    const { clientId, clientSecret, redirectUri } = env();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    });
    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || payload.error || 'No se pudo obtener el token.');
    await saveTokenRecord({
      ...payload,
      obtained_at: Date.now(),
      expires_at: Date.now() + Number(payload.expires_in || 21600) * 1000
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: new URL('/?connected=1', url.origin).toString(),
        'set-cookie': 'meli_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        'cache-control': 'no-store'
      }
    });
  } catch (err) {
    return new Response(`Error al conectar Mercado Libre: ${err.message}`, { status: 500 });
  }
};
