import { json, getCostsRecord, saveCostsRecord, validToken } from './_shared.mjs';

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};
const text = value => String(value ?? '').trim();
const key = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    await validToken();
    const body = await request.json();
    const rows = Array.isArray(body?.products) ? body.products : [];
    if (!rows.length) return json({ error: 'No se encontraron productos válidos en el Excel.' }, 400);
    if (rows.length > 2000) return json({ error: 'El archivo supera el límite de 2.000 productos.' }, 400);

    const seen = new Set();
    const products = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const sku = text(row.sku);
      const model = text(row.model);
      if (!sku && !model) continue;
      if (!sku) { errors.push({ row: i + 1, message: 'Falta SKU', model }); continue; }
      const skuKey = key(sku);
      if (seen.has(skuKey)) { errors.push({ row: i + 1, message: 'SKU duplicado', sku }); continue; }
      seen.add(skuKey);
      const cost = num(row.cost);
      const costPack = num(row.costPack);
      if (cost === null && costPack === null) { errors.push({ row: i + 1, message: 'Falta costo', sku }); continue; }
      products.push({
        sku,
        model,
        cost,
        costPack: costPack ?? cost,
        listPrice: num(row.listPrice),
        increasedPrice: num(row.increasedPrice),
        discount: num(row.discount),
        netPrice: num(row.netPrice),
        meliCommission: num(row.meliCommission),
        installments: num(row.installments),
        fixedCharge: num(row.fixedCharge),
        shipping: num(row.shipping),
        packaging: num(row.packaging),
        netAfterMeli: num(row.netAfterMeli),
        profit: num(row.profit),
        profitability: num(row.profitability)
      });
    }
    if (!products.length) return json({ error: 'No quedó ningún producto válido para importar.', errors }, 400);

    const previous = await getCostsRecord();
    const oldMap = new Map((previous.products || []).map(p => [key(p.sku), p]));
    let added = 0, changed = 0, unchanged = 0;
    for (const product of products) {
      const old = oldMap.get(key(product.sku));
      if (!old) added++;
      else if (JSON.stringify(old) !== JSON.stringify(product)) changed++;
      else unchanged++;
    }
    const newKeys = new Set(products.map(p => key(p.sku)));
    const removed = (previous.products || []).filter(p => !newKeys.has(key(p.sku))).length;
    const record = {
      importedAt: new Date().toISOString(),
      fileName: text(body.fileName) || 'Excel de costos',
      products,
      summary: { total: products.length, added, changed, unchanged, removed, errors: errors.length }
    };
    await saveCostsRecord(record);
    return json({ ok: true, ...record, errors: errors.slice(0, 100) });
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
