import { json, meli, getCache, saveCache } from './_shared.mjs';

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

export default async (request) => {
  try {
    const force = new URL(request.url).searchParams.get('refresh') === '1';
    const cached = await getCache();
    if (!force && cached?.createdAt && Date.now() - cached.createdAt < 5 * 60 * 1000) return json(cached.data);

    const user = await meli('/users/me');
    const itemSearch = await meli(`/users/${user.id}/items/search?status=active&limit=100`);
    const ids = (itemSearch.results || []).slice(0, 100);
    let items = [];
    for (const group of chunk(ids, 20)) {
      if (!group.length) continue;
      const result = await meli(`/items?ids=${group.join(',')}`);
      items.push(...result.map(x => x.body).filter(Boolean));
    }

    const dateTo = new Date();
    const dateFrom = new Date(Date.now() - 30 * 86400000);
    // Mercado Libre pagina las órdenes. La versión anterior solo leía las primeras 50,
    // por eso los totales quedaban incompletos. Recorremos todas las páginas del período.
    const orderRows = [];
    const limit = 50;
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await meli(`/orders/search?seller=${user.id}&order.date_created.from=${encodeURIComponent(dateFrom.toISOString())}&order.date_created.to=${encodeURIComponent(dateTo.toISOString())}&sort=date_desc&limit=${limit}&offset=${offset}`);
      const results = page.results || [];
      orderRows.push(...results);
      total = Number(page.paging?.total ?? orderRows.length);
      offset += results.length;

      // Evita un bucle infinito si la API devuelve una página vacía.
      if (!results.length) break;
    }
    const paid = orderRows.filter(o => o.status === 'paid' || o.status === 'confirmed');
    const revenue = paid.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    const units = paid.reduce((sum, o) => sum + (o.order_items || []).reduce((s, i) => s + Number(i.quantity || 0), 0), 0);
    const lowStock = items.filter(i => Number(i.available_quantity || 0) <= 3);
    const paused = items.filter(i => i.status === 'paused').length;

    const productSales = new Map();
    for (const order of paid) {
      for (const row of order.order_items || []) {
        const id = row.item?.id || 'sin-id';
        const current = productSales.get(id) || { id, title: row.item?.title || id, units: 0, revenue: 0 };
        current.units += Number(row.quantity || 0);
        current.revenue += Number(row.unit_price || 0) * Number(row.quantity || 0);
        productSales.set(id, current);
      }
    }

    const data = {
      generatedAt: new Date().toISOString(),
      user: { id: user.id, nickname: user.nickname, reputation: user.seller_reputation?.level_id || null },
      metrics: { activeListings: items.length, orders30d: paid.length, units30d: units, revenue30d: revenue, lowStock: lowStock.length, paused },
      topProducts: [...productSales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      listings: items.slice(0, 60).map(i => ({
        id: i.id, title: i.title, price: i.price, currency_id: i.currency_id, available_quantity: i.available_quantity,
        sold_quantity: i.sold_quantity, status: i.status, permalink: i.permalink, thumbnail: i.thumbnail
      })),
      recentOrders: orderRows.slice(0, 12).map(o => ({ id: o.id, date_created: o.date_created, status: o.status, total_amount: o.total_amount, currency_id: o.currency_id, items: (o.order_items || []).map(i => ({ title: i.item?.title, quantity: i.quantity })) }))
    };
    await saveCache({ createdAt: Date.now(), data });
    return json(data);
  } catch (error) {
    const status = error.message === 'NOT_CONNECTED' ? 401 : 500;
    return json({ error: error.message }, status);
  }
};
