import { json, meli, getCostsRecord, fetchOrders, paidOrders, startOfMonth, endOfMonth } from './_shared.mjs';

const n = value => Number(value || 0);
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
  return [row?.item?.seller_sku, row?.item?.seller_custom_field, row?.seller_sku, row?.seller_custom_field]
    .filter(Boolean).map(String);
}

function feeBreakdown(order) {
  let commission = 0, installments = 0, other = 0;
  for (const payment of order.payments || []) {
    commission += Math.abs(n(payment.marketplace_fee));
    for (const fee of payment.fee_details || []) {
      const type = String(fee.type || fee.fee_payer || '').toLowerCase();
      const amount = Math.abs(n(fee.amount));
      if (!amount) continue;
      if (type.includes('financ') || type.includes('install')) installments += amount;
      else if (!type.includes('marketplace') && !type.includes('application')) other += amount;
    }
  }
  return { commission, installments, other };
}

function extractSellerShippingCost(payload) {
  // Para conciliación, Mercado Libre documenta que el importe efectivamente
  // cobrado al vendedor está en senders[].cost. No usamos sender.cost,
  // gross_amount ni cost porque pueden representar el costo logístico bruto,
  // el precio de lista del envío o importes previos a subsidios/descuentos.
  const senders = Array.isArray(payload?.senders) ? payload.senders : [];
  return senders.reduce((sum, sender) => sum + Math.max(0, n(sender?.cost)), 0);
}

async function shipmentCost(order) {
  const shipmentId = order?.shipping?.id;
  if (!shipmentId) return 0;
  try {
    const costs = await meli(`/shipments/${shipmentId}/costs`);
    return extractSellerShippingCost(costs);
  } catch {
    return 0;
  }
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
    const costsBySku = new Map((costsRecord.products || []).map(p => [normalizeSku(p.sku), p]));
    const grouped = new Map();
    let ordersWithShippingCost = 0;

    // Keep requests controlled while still obtaining actual shipping deductions.
    for (let i = 0; i < orders.length; i += 8) {
      const batch = orders.slice(i, i + 8);
      const shipping = await Promise.all(batch.map(shipmentCost));
      batch.forEach((order, index) => {
        const orderRevenue = (order.order_items || []).reduce((s, row) => s + n(row.unit_price) * n(row.quantity), 0) || n(order.total_amount);
        const fees = feeBreakdown(order);
        const ship = shipping[index];
        if (ship > 0) ordersWithShippingCost += 1;
        const totalOrderMlCosts = fees.commission + fees.installments + fees.other + ship;
        for (const row of order.order_items || []) {
          const quantity = Math.max(1, n(row.quantity));
          const revenue = n(row.unit_price) * quantity;
          const share = orderRevenue ? revenue / orderRevenue : 1 / Math.max(1, (order.order_items || []).length);
          const candidates = skuCandidates(row);
          const sku = candidates.find(x => costsBySku.has(normalizeSku(x))) || candidates[0] || '';
          const key = normalizeSku(sku) || `ITEM:${row.item?.id || 'sin-id'}`;
          const current = grouped.get(key) || {
            sku, itemId: row.item?.id || '', title: row.item?.title || sku || 'Producto', units: 0,
            sales: 0, commission: 0, installments: 0, shipping: 0, other: 0, mlCosts: 0
          };
          current.units += quantity;
          current.sales += revenue;
          current.commission += fees.commission * share;
          current.installments += fees.installments * share;
          current.shipping += ship * share;
          current.other += fees.other * share;
          current.mlCosts += totalOrderMlCosts * share;
          grouped.set(key, current);
        }
      });
    }

    const rows = [...grouped.values()].map(row => {
      const costProduct = costsBySku.get(normalizeSku(row.sku));
      const unitCost = n(costProduct?.costPack ?? costProduct?.cost);
      const merchandiseCost = unitCost * row.units;
      const netAfterMl = row.sales - row.mlCosts;
      const realProfit = netAfterMl - merchandiseCost;
      return {
        ...row,
        costMatched: Boolean(costProduct),
        unitCost,
        merchandiseCost,
        averageSalePrice: row.units ? row.sales / row.units : 0,
        averageMlCosts: row.units ? row.mlCosts / row.units : 0,
        averageNetAfterMl: row.units ? netAfterMl / row.units : 0,
        averageProfit: row.units ? realProfit / row.units : 0,
        netAfterMl,
        realProfit,
        realMargin: row.sales ? realProfit / row.sales : null,
        returnOnCost: merchandiseCost ? realProfit / merchandiseCost : null
      };
    }).sort((a,b) => b.sales - a.sales);

    return json({
      period: { from: from.toISOString(), to: to.toISOString() },
      rows,
      coverage: {
        orders: orders.length,
        ordersWithShippingCost,
        note: 'Los costos de envío usan exclusivamente senders[].cost, que representa lo cobrado al vendedor después de subsidios. No se usan gross_amount ni costos logísticos brutos. Los demás cargos provienen de órdenes y pagos; si Mercado Libre no expone un cargo, no se inventa.'
      }
    });
  } catch (error) {
    return json({ error: error.message === 'NOT_CONNECTED' ? 'Conectá Mercado Libre.' : error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
