import { json, getCostsRecord, validToken } from './_shared.mjs';

export default async () => {
  try {
    await validToken();
    const record = await getCostsRecord();
    return json(record);
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
