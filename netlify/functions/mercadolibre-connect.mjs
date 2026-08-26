import { env } from './_shared.mjs';

export default async () => {
  try {
    const { clientId, redirectUri } = env();
    const state = crypto.randomUUID();
    const url = new URL('https://auth.mercadolibre.com.ar/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);

    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        'set-cookie': `meli_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        'cache-control': 'no-store'
      }
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
};
