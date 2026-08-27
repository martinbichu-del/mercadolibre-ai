import {
  json, meli, getCache, saveCache, getCostsRecord, getSettings,
  fetchOrders, paidOrders, startOfMonth, endOfMonth, dateKey
} from './_shared.mjs';

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
const num = value => Number(value || 0);
const pct = (value, previous) => previous ? (value - previous) / previous : null;

function parseMonth(value) {
  const now = new Date();
  const match = /^(\d{4})-(\d{2})$/.exec(value || '');
  if (!match) return { year: now.getUTCFullYear(), monthIndex: now.getUTCMonth() };
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (year < 2020 || year > 2100 || monthIndex < 0 || monthIndex > 11) throw new Error('Mes inválido.');
  return { year, monthIndex };
}

function summarizeOrders(orders) {
  const paid = paidOrders(orders);
  const revenue = paid.reduce((sum, order) => sum + num(order.total_amount), 0);
  const units = paid.reduce((sum, order) => sum + (order.order_items || []).reduce((s, item) => s + num(item.quantity), 0), 0);
  return { paid, revenue, units, orders: paid.length, ticket: paid.length ? revenue / paid.length : 0 };
}

function dailySeries(orders, from, days) {
  const map = new Map();
  for (let day = 1; day <= days; day++) map.set(day, { day, orders: 0, units: 0, revenue: 0 });
  for (const order of paidOrders(orders)) {
    const date = new Date(order.date_created);
    const day = date.getUTCDate();
    if (!map.has(day)) continue;
    const row = map.get(day);
    row.orders += 1;
    row.revenue += num(order.total_amount);
    row.units += (order.order_items || []).reduce((sum, item) => sum + num(item.quantity), 0);
  }
  return [...map.values()];
}

function weeklySeries(daily) {
  const result = [];
  for (let start = 1; start <= daily.length; start += 7) {
    const rows = daily.slice(start - 1, start + 6);
    result.push({
      label: `${start}–${Math.min(start + 6, daily.length)}`,
      orders: rows.reduce((sum, row) => sum + row.orders, 0),
      units: rows.reduce((sum, row) => sum + row.units, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0)
    });
  }
  return result;
}

function productSales(orders) {
  const map = new Map();
  for (const order of paidOrders(orders)) {
    for (const row of order.order_items || []) {
      const id = row.item?.id || 'sin-id';
      const current = map.get(id) || { id, title: row.item?.title || id, units: 0, revenue: 0 };
      current.units += num(row.quantity);
      current.revenue += num(row.unit_price) * num(row.quantity);
      map.set(id, current);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('refresh') === '1';
    const selected = parseMonth(url.searchParams.get('month'));
    const monthKey = `${selected.year}-${String(selected.monthIndex + 1).padStart(2, '0')}`;
    const cacheKey = `dashboard-v5-${monthKey}`;
    const cached = await getCache(cacheKey);
    if (!force && cached?.createdAt && Date.now() - cached.createdAt < 5 * 60 * 1000) return json(cached.data);

    const user = await meli('/users/me');
    const itemSearch = await meli(`/users/${user.id}/items/search?status=active&limit=100`);
    const ids = (itemSearch.results || []).slice(0, 100);
    const items = [];
    for (const group of chunk(ids, 20)) {
      if (!group.length) continue;
      const result = await meli(`/items?ids=${group.join(',')}`);
      items.push(...result.map(x => x.body).filter(Boolean));
    }

    const now = new Date();
    const selectedStart = startOfMonth(selected.year, selected.monthIndex);
    const selectedEndFull = endOfMonth(selected.year, selected.monthIndex);
    const isCurrentMonth = selected.year === now.getUTCFullYear() && selected.monthIndex === now.getUTCMonth();
    const selectedEnd = isCurrentMonth ? now : selectedEndFull;
    const elapsedDays = isCurrentMonth ? now.getUTCDate() : selectedEndFull.getUTCDate();

    const previousDate = new Date(Date.UTC(selected.year, selected.monthIndex - 1, 1));
    const previousStart = startOfMonth(previousDate.getUTCFullYear(), previousDate.getUTCMonth());
    const previousEndFull = endOfMonth(previousDate.getUTCFullYear(), previousDate.getUTCMonth());
    const previousEndDay = Math.min(elapsedDays, previousEndFull.getUTCDate());
    const previousEnd = new Date(Date.UTC(previousDate.getUTCFullYear(), previousDate.getUTCMonth(), previousEndDay, 23, 59, 59, 999));

    const [selectedOrders, previousOrders] = await Promise.all([
      fetchOrders({ sellerId: user.id, from: selectedStart, to: selectedEnd }),
      fetchOrders({ sellerId: user.id, from: previousStart, to: previousEnd })
    ]);

    const current = summarizeOrders(selectedOrders);
    const previous = summarizeOrders(previousOrders);
    const daysInSelectedMonth = selectedEndFull.getUTCDate();
    const dailyCurrent = dailySeries(selectedOrders, selectedStart, elapsedDays);
    const dailyPrevious = dailySeries(previousOrders, previousStart, previousEndDay);
    const weeklyCurrent = weeklySeries(dailyCurrent);
    const weeklyPrevious = weeklySeries(dailyPrevious);

    const lastSeven = dailyCurrent.slice(Math.max(0, dailyCurrent.length - 7));
    const avgUnits7 = lastSeven.length ? lastSeven.reduce((sum, row) => sum + row.units, 0) / lastSeven.length : 0;
    const avgRevenue7 = lastSeven.length ? lastSeven.reduce((sum, row) => sum + row.revenue, 0) / lastSeven.length : 0;
    const remainingDays = Math.max(0, daysInSelectedMonth - elapsedDays);
    const projection = {
      units: Math.round(current.units + avgUnits7 * remainingDays),
      revenue: Math.round(current.revenue + avgRevenue7 * remainingDays),
      orders: Math.round(current.orders + (lastSeven.length ? lastSeven.reduce((sum, row) => sum + row.orders, 0) / lastSeven.length : 0) * remainingDays),
      method: 'Promedio móvil de los últimos 7 días'
    };

    const costsRecord = await getCostsRecord();
    const settings = await getSettings();
    const costsBySku = new Map((costsRecord.products || []).map(p => [String(p.sku || '').trim().toUpperCase(), p]));
    const itemSku = item => String(item.seller_custom_field || item.variations?.[0]?.seller_custom_field || '').trim();
    const salesByItem = new Map(productSales(selectedOrders).map(row => [row.id, row]));

    const listings = items.map(item => {
      const sku = itemSku(item);
      const cost = costsBySku.get(sku.toUpperCase()) || null;
      const salePrice = num(item.price);
      const unitCost = num(cost?.costPack ?? cost?.cost);
      const sales = salesByItem.get(item.id) || { units: 0, revenue: 0 };
      const dailyVelocity = elapsedDays ? sales.units / elapsedDays : 0;
      const stock = num(item.available_quantity);
      const coverageDays = dailyVelocity > 0 ? stock / dailyVelocity : null;
      const reorderPoint = dailyVelocity * (num(settings.leadTimeDays) + num(settings.safetyStockDays));
      const suggestedOrder = Math.max(0, Math.ceil(reorderPoint - stock));
      return {
        id: item.id,
        sku,
        title: item.title,
        price: item.price,
        currency_id: item.currency_id,
        available_quantity: item.available_quantity,
        sold_quantity: item.sold_quantity,
        status: item.status,
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        free_shipping: Boolean(item.shipping?.free_shipping),
        listing_type_id: item.listing_type_id,
        salesMonth: sales,
        dailyVelocity,
        coverageDays,
        reorderPoint,
        suggestedOrder,
        cost: cost ? {
          ...cost,
          estimatedGrossProfit: salePrice - unitCost,
          estimatedMargin: salePrice ? (salePrice - unitCost) / salePrice : null
        } : null
      };
    });

    const purchases = listings
      .filter(item => item.dailyVelocity > 0)
      .map(item => ({
        id: item.id,
        sku: item.sku,
        title: item.title,
        stock: num(item.available_quantity),
        dailyVelocity: item.dailyVelocity,
        coverageDays: item.coverageDays,
        leadTimeDays: settings.leadTimeDays,
        safetyStockDays: settings.safetyStockDays,
        suggestedOrder: item.suggestedOrder,
        urgency: item.coverageDays <= settings.leadTimeDays ? 'alta' : item.coverageDays <= settings.leadTimeDays + settings.safetyStockDays ? 'media' : 'baja',
        estimatedInvestment: item.cost ? item.suggestedOrder * num(item.cost.costPack ?? item.cost.cost) : null
      }))
      .sort((a, b) => (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity));

    const productRanking = productSales(selectedOrders).slice(0, 12);
    const data = {
      generatedAt: new Date().toISOString(),
      period: {
        key: monthKey,
        from: selectedStart.toISOString(),
        to: selectedEnd.toISOString(),
        elapsedDays,
        daysInMonth: daysInSelectedMonth,
        isCurrentMonth,
        previousFrom: previousStart.toISOString(),
        previousTo: previousEnd.toISOString()
      },
      user: { id: user.id, nickname: user.nickname, reputation: user.seller_reputation?.level_id || null },
      metrics: {
        activeListings: listings.length,
        orders: current.orders,
        units: current.units,
        revenue: current.revenue,
        ticket: current.ticket,
        lowStock: listings.filter(item => num(item.available_quantity) <= 3).length,
        previous: { orders: previous.orders, units: previous.units, revenue: previous.revenue, ticket: previous.ticket },
        change: {
          orders: pct(current.orders, previous.orders),
          units: pct(current.units, previous.units),
          revenue: pct(current.revenue, previous.revenue),
          ticket: pct(current.ticket, previous.ticket)
        }
      },
      projection,
      charts: {
        dailyCurrent,
        dailyPrevious,
        weeklyCurrent,
        weeklyPrevious
      },
      topProducts: productRanking,
      listings,
      purchases: purchases.slice(0, 100),
      costs: { importedAt: costsRecord.importedAt, fileName: costsRecord.fileName, count: (costsRecord.products || []).length },
      settings,
      recentOrders: paidOrders(selectedOrders).slice(0, 20).map(order => ({
        id: order.id,
        date_created: order.date_created,
        status: order.status,
        total_amount: order.total_amount,
        currency_id: order.currency_id,
        items: (order.order_items || []).map(item => ({ title: item.item?.title, quantity: item.quantity }))
      }))
    };

    await saveCache({ createdAt: Date.now(), data }, cacheKey);
    await saveCache({ createdAt: Date.now(), data }, 'dashboard-cache');
    return json(data);
  } catch (error) {
    const status = error.message === 'NOT_CONNECTED' ? 401 : 500;
    return json({ error: error.message }, status);
  }
};
