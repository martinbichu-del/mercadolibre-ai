import { json, validToken, meli } from './_shared.mjs';

export default async () => {
  try {
    await validToken();
    const user = await meli('/users/me');
    return json({ connected: true, user: { id: user.id, nickname: user.nickname, country_id: user.country_id } });
  } catch (error) {
    if (['NOT_CONNECTED', 'TOKEN_EXPIRED'].includes(error.message)) return json({ connected: false });
    return json({ connected: false, error: error.message }, 500);
  }
};
