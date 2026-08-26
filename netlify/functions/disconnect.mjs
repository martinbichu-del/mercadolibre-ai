import { json, deleteTokenRecord } from './_shared.mjs';
export default async () => {
  await deleteTokenRecord();
  return json({ ok: true });
};
