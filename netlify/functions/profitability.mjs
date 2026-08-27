import { json, meli, getCostsRecord, fetchOrders, paidOrders, startOfMonth, endOfMonth } from './_shared.mjs';

const n = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeSku = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

function parseMonth(value) {
  const now = new Date();
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  if (!match) return { year: now.getUTCFullYear(), monthIndex: now.getUTCMonth() };
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

function skuCandidates(row) {
  return [
    row?.item?.seller_sku,
    row?.item?.seller_custom_field,
    row?.seller_sku,
    row?.seller_custom_field
  ].filter(Boolean).map(String);
}

function financialModel(product) {
  const salePrice = n(product?.netPrice) || n(product?.increasedPrice) || n(product?.listPrice);
  const commission = n(product?.meliCommission);
  const installments = n(product?.installments);
  const fixedCharge = n(product?.fixedCharge);
  const shipping = n(product?.shipping);
  const other = 0;
  const mlCosts = commission + installments + fixedCharge + shipping + other;
  const netAfterMl = n(product?.netAfterMeli) || Math.max(0, salePrice - mlCosts);
  const unitCost = n(product?.costPack) || n(product?.cost);
  const profit = n(product?.profit) || (netAfterMl - unitCost);
  const marginOnSale = salePrice ? profit / salePrice : null;
  const returnOnCost = unitCost ? profit / unitCost : null;

  return {
    salePrice,
    commission,
    installments,
    fixedCharge,
    shipping,
    other,
    mlCosts,
    netAfterMl,
    unitCost,
    profit,
    marginOnSale,
    returnOnCost
  };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const selected = parseMonth(url.searchParams.get('month'));
    const now = new Date();
    const from = startOfMonth(selected.year, selected.monthIndex);
    const fullEnd = endOfMonth(selected.year, selected.monthIndex);
    const to = selected.year === now.getUTCFullYear() && selected.monthIndex === now.getUTCMonth() ? now : fullEnd;

    const user = await meli('/users/me');
    const orders = paidOrders(await fetchOrders({ sellerId: user.id, from, to }));
    const costsRecord = await getCostsRecord();
    const imported = costsRecord.products || [];
    const costsBySku = new Map(imported.map(product => [normalizeSku(product.sku), product]));
    const grouped = new Map();

    for (const order of orders) {
      for (const row of order.order_items || []) {
        const candidates = skuCandidates(row);
        const matchedSku = candidates.find(candidate => costsBySku.has(normalizeSku(candidate)));
        if (!matchedSku) continue;
        const key = normalizeSku(matchedSku);
        const current = grouped.get(key) || {
          sku: costsBySku.get(key)?.sku || matchedSku,
          itemId: row.item?.id || '',
          title: row.item?.title || costsBySku.get(key)?.model || matchedSku,
          units: 0,
          operations: 0
        };
        current.units += Math.max(1, n(row.quantity));
        current.operations += 1;
        grouped.set(key, current);
      }
    }

    const rows = [...grouped.values()].map(row => {
      const product = costsBySku.get(normalizeSku(row.sku));
      const model = financialModel(product);
      return {
        ...row,
        costMatched: true,
        source: 'excel-financial-model',
        averageSalePrice: model.salePrice,
        averageMlCosts: model.mlCosts,
        averageNetAfterMl: model.netAfterMl,
        unitCost: model.unitCost,
        averageProfit: model.profit,
        realMargin: model.marginOnSale,
        returnOnCost: model.returnOnCost,
        commission: model.commission * row.units,
        installments: model.installments * row.units,
        fixedCharge: model.fixedCharge * row.units,
        shipping: model.shipping * row.units,
        other: model.other * row.units,
        mlCosts: model.mlCosts * row.units,
        sales: model.salePrice * row.units,
        netAfterMl: model.netAfterMl * row.units,
        merchandiseCost: model.unitCost * row.units,
        realProfit: model.profit * row.units,
        unitBreakdown: {
          commission: model.commission,
          installments: model.installments,
          fixedCharge: model.fixedCharge,
          shipping: model.shipping,
          other: model.other
        }
      };
    }).sort((a, b) => b.sales - a.sales);

    return json({
      period: { from: from.toISOString(), to: to.toISOString() },
      rows,
      coverage: {
        orders: orders.length,
        matchedProducts: rows.length,
        note: 'La rentabilidad usa exactamente la estructura financiera importada desde tu Excel: Precio Vta neto − Comisión ML − Cuotas − Cargo fijo − Envío = Neto ML; luego Neto ML − Costo + Pack = Ganancia. Mercado Libre aporta las unidades vendidas del período y el stock.'
      }
    });
  } catch (error) {
    return json({ error: error.message === 'NOT_CONNECTED' ? 'Conectá Mercado Libre.' : error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
