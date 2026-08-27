import { json, meli, getCache, saveCache, fetchOrders, paidOrders, startOfMonth, endOfMonth } from './_shared.mjs';

const num = value => Number(value || 0);

function summarize(rows) {
  const paid = paidOrders(rows);
  const revenue = paid.reduce((sum, order) => sum + num(order.total_amount), 0);
  const units = paid.reduce((sum, order) => sum + (order.order_items || []).reduce((s, item) => s + num(item.quantity), 0), 0);
  return { orders: paid.length, units, revenue, ticket: paid.length ? revenue / paid.length : 0 };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const months = Math.min(12, Math.max(3, Number(url.searchParams.get('months') || 6)));
    const force = url.searchParams.get('refresh') === '1';
    const now = new Date();
    const cacheKey = `history-v5-${months}-${now.getUTCFullYear()}-${now.getUTCMonth() + 1}`;
    const cached = await getCache(cacheKey);
    if (!force && cached?.createdAt && Date.now() - cached.createdAt < 30 * 60 * 1000) return json(cached.data);

    const user = await meli('/users/me');
    const rows = [];
    for (let index = months - 1; index >= 0; index--) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
      const from = startOfMonth(date.getUTCFullYear(), date.getUTCMonth());
      const endFull = endOfMonth(date.getUTCFullYear(), date.getUTCMonth());
      const to = date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth() ? now : endFull;
      const orders = await fetchOrders({ sellerId: user.id, from, to });
      rows.push({
        key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        label: new Intl.DateTimeFormat('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date),
        ...summarize(orders)
      });
    }
    const data = { generatedAt: new Date().toISOString(), months: rows };
    await saveCache({ createdAt: Date.now(), data }, cacheKey);
    return json(data);
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
