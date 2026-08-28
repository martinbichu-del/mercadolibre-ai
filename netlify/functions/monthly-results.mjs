import {
  json, meli, fetchOrders, paidOrders, startOfMonth, endOfMonth,
  getCostsRecord, getPnlExpenses, savePnlExpenses, getCache, saveCache
} from './_shared.mjs';

const num = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const normalizeSku = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
const skuAttr = attrs => {
  const attr = (attrs || []).find(a => ['SELLER_SKU', 'SKU'].includes(String(a?.id || '').toUpperCase()));
  return attr?.value_name || attr?.value_id || '';
};
const directSkus = row => [
  row?.item?.seller_sku, row?.item?.seller_custom_field,
  row?.seller_sku, row?.seller_custom_field
].filter(Boolean).map(String);

function skuFromDetail(detail, row) {
  const variationId = row?.item?.variation_id ?? row?.variation_id;
  if (variationId != null) {
    const variation = (detail?.variations || []).find(v => String(v.id) === String(variationId));
    const sku = variation?.seller_custom_field || variation?.seller_sku || skuAttr(variation?.attributes);
    if (sku) return String(sku);
  }
  return String(detail?.seller_custom_field || detail?.seller_sku || skuAttr(detail?.attributes) || '');
}

async function itemDetailsFor(orders) {
  const ids = [...new Set(orders.flatMap(o => (o.order_items || []).map(r => r?.item?.id).filter(Boolean)))];
  const map = new Map();
  for (let i = 0; i < ids.length; i += 20) {
    const group = ids.slice(i, i + 20);
    try {
      const payload = await meli(`/items?ids=${group.join(',')}`);
      for (const entry of Array.isArray(payload) ? payload : []) {
        if (entry?.body?.id) map.set(String(entry.body.id), entry.body);
      }
    } catch {
      for (const id of group) {
        try {
          const item = await meli(`/items/${encodeURIComponent(id)}?include_attributes=all`);
          if (item?.id) map.set(String(item.id), item);
        } catch {}
      }
    }
  }
  return map;
}

function monthTemplate(index) {
  return {
    index,
    grossSales: 0,
    discounts: 0,
    netSales: 0,
    commission: 0,
    installments: 0,
    fixedCharge: 0,
    shipping: 0,
    otherMl: 0,
    totalMl: 0,
    netAfterMl: 0,
    merchandise: 0,
    packaging: 0,
    totalProducts: 0,
    contribution: 0,
    operatingExpenses: 0,
    retentions: 0,
    taxes: 0,
    operatingResult: 0,
    netResult: 0,
    orders: 0,
    units: 0,
    matchedUnits: 0,
    unmatchedUnits: 0,
    settlementPayments: 0,
    settlementFallbacks: 0
  };
}

function defaultExpenseYear() {
  return {
    publicidad: Array(12).fill(0),
    alquiler: Array(12).fill(0),
    sueldos: Array(12).fill(0),
    servicios: Array(12).fill(0),
    contador: Array(12).fill(0),
    software: Array(12).fill(0),
    gastosBancarios: Array(12).fill(0),
    logisticaExterna: Array(12).fill(0),
    retenciones: Array(12).fill(0),
    impuestos: Array(12).fill(0),
    otros: Array(12).fill(0)
  };
}

const operatingExpenseKeys = [
  'publicidad', 'alquiler', 'sueldos', 'servicios', 'contador',
  'software', 'gastosBancarios', 'logisticaExterna', 'otros'
];

function expenseTotal(expenses, monthIndex) {
  return operatingExpenseKeys.reduce((sum, key) => {
    const values = expenses?.[key];
    return sum + num(Array.isArray(values) ? values[monthIndex] : 0);
  }, 0);
}

function feeType(detail) {
  return String(detail?.type || detail?.fee_type || detail?.name || detail?.description || '').toLowerCase();
}

function classifyPayment(payment) {
  const transactionAmount = num(payment?.transaction_amount || payment?.total_paid_amount);
  const netReceived = num(payment?.transaction_details?.net_received_amount ?? payment?.net_received_amount);
  const marketplaceFee = Math.abs(num(payment?.marketplace_fee));
  let commission = marketplaceFee;
  let installments = 0;
  let fixedCharge = 0;
  let shipping = Math.abs(num(payment?.shipping_cost));
  let explicitOther = 0;

  for (const fee of payment?.fee_details || []) {
    const amount = Math.abs(num(fee?.amount));
    const type = feeType(fee);
    if (!amount) continue;
    if (/financ|install|cuota/.test(type)) installments += amount;
    else if (/fixed|cargo fijo/.test(type)) fixedCharge += amount;
    else if (/shipping|shipment|envio|envío|freight/.test(type)) shipping += amount;
    else if (/marketplace|sale|commission|comision|comisión/.test(type)) {
      if (!marketplaceFee) commission += amount;
    } else explicitOther += amount;
  }

  // The settlement total is the source of truth. Component fields are used only
  // to explain that total, and never added twice.
  const settlementCost = netReceived > 0 && transactionAmount > 0
    ? Math.max(0, transactionAmount - netReceived)
    : Math.max(0, commission + installments + fixedCharge + shipping + explicitOther);
  const known = commission + installments + fixedCharge + shipping;
  const otherMl = Math.max(0, settlementCost - known);

  return {
    transactionAmount,
    netReceived: netReceived > 0 ? netReceived : Math.max(0, transactionAmount - settlementCost),
    commission,
    installments,
    fixedCharge,
    shipping,
    otherMl,
    totalMl: settlementCost,
    detailed: Boolean(payment?.transaction_details || payment?.fee_details)
  };
}

function classifyOrderPaymentFallback(payment) {
  return classifyPayment(payment || {});
}

async function fetchPaymentDetails(orders) {
  const ids = [...new Set(orders.flatMap(order => (order.payments || []).map(p => p?.id).filter(Boolean)).map(String))];
  const map = new Map();
  const concurrency = 5;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index];
      try {
        const payment = await meli(`/v1/payments/${encodeURIComponent(id)}`);
        map.set(id, payment);
      } catch {
        // A missing payment detail must not prevent the annual statement.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, () => worker()));
  return map;
}

export default async request => {
  try {
    const url = new URL(request.url);

    if (request.method === 'POST') {
      const body = await request.json();
      const year = Number(body?.year);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ error: 'Año inválido.' }, 400);
      const current = await getPnlExpenses();
      current.years ||= {};
      current.years[String(year)] = { ...defaultExpenseYear(), ...(body.expenses || {}) };
      current.updatedAt = new Date().toISOString();
      await savePnlExpenses(current);
      return json({ ok: true, year, expenses: current.years[String(year)], updatedAt: current.updatedAt });
    }

    if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405);

    const year = Number(url.searchParams.get('year') || new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return json({ error: 'Año inválido.' }, 400);
    const force = url.searchParams.get('refresh') === '1';
    const cacheKey = `pnl-v8-auto-ml-${year}`;
    const cached = await getCache(cacheKey);
    if (!force && cached?.createdAt && Date.now() - cached.createdAt < 30 * 60 * 1000) return json(cached.data);

    const now = new Date();
    const from = startOfMonth(year, 0);
    const yearEnd = endOfMonth(year, 11);
    const to = year === now.getUTCFullYear() ? now : yearEnd;
    const user = await meli('/users/me');
    const orders = paidOrders(await fetchOrders({ sellerId: user.id, from, to }));
    const [costsRecord, details, paymentDetails, expensesRecord] = await Promise.all([
      getCostsRecord(),
      itemDetailsFor(orders),
      fetchPaymentDetails(orders),
      getPnlExpenses()
    ]);

    const costsBySku = new Map((costsRecord.products || []).map(p => [normalizeSku(p.sku), p]));
    const expenses = { ...defaultExpenseYear(), ...(expensesRecord.years?.[String(year)] || {}) };
    const months = Array.from({ length: 12 }, (_, i) => monthTemplate(i));
    const orderIdsByMonth = Array.from({ length: 12 }, () => new Set());

    for (const order of orders) {
      const monthIndex = new Date(order.date_created).getUTCMonth();
      if (monthIndex < 0 || monthIndex > 11) continue;
      const target = months[monthIndex];
      orderIdsByMonth[monthIndex].add(String(order.id));

      let orderItemsNet = 0;
      let orderItemsGross = 0;
      for (const row of order.order_items || []) {
        const quantity = Math.max(1, num(row.quantity));
        const actualUnit = num(row.unit_price);
        const fullUnit = Math.max(actualUnit, num(row.full_unit_price));
        orderItemsNet += actualUnit * quantity;
        orderItemsGross += fullUnit * quantity;
        target.units += quantity;

        const candidate = directSkus(row).find(s => costsBySku.has(normalizeSku(s)));
        let sku = candidate || '';
        if (!sku) sku = skuFromDetail(details.get(String(row?.item?.id || '')), row);
        const product = costsBySku.get(normalizeSku(sku));
        if (!product) {
          target.unmatchedUnits += quantity;
          continue;
        }
        target.matchedUnits += quantity;
        const cost = num(product?.cost);
        const packaging = num(product?.packaging) || Math.max(0, num(product?.costPack) - cost);
        target.merchandise += cost * quantity;
        target.packaging += packaging * quantity;
      }

      target.grossSales += orderItemsGross;
      target.netSales += orderItemsNet;
      target.discounts += Math.max(0, orderItemsGross - orderItemsNet);

      const payments = order.payments || [];
      let orderSettlement = { commission: 0, installments: 0, fixedCharge: 0, shipping: 0, otherMl: 0, totalMl: 0, netReceived: 0 };
      for (const paymentSummary of payments) {
        const detail = paymentDetails.get(String(paymentSummary?.id));
        const classified = detail ? classifyPayment(detail) : classifyOrderPaymentFallback(paymentSummary);
        if (detail) target.settlementPayments += 1;
        else target.settlementFallbacks += 1;
        for (const key of ['commission', 'installments', 'fixedCharge', 'shipping', 'otherMl', 'totalMl', 'netReceived']) {
          orderSettlement[key] += num(classified[key]);
        }
      }

      // Payment settlements are the source of truth for Mercado Libre deductions.
      // If no payment detail exists, the order total remains visible and the missing
      // deduction is not fabricated.
      target.commission += orderSettlement.commission;
      target.installments += orderSettlement.installments;
      target.fixedCharge += orderSettlement.fixedCharge;
      target.shipping += orderSettlement.shipping;
      target.otherMl += orderSettlement.otherMl;
      target.totalMl += orderSettlement.totalMl;
      target.netAfterMl += orderSettlement.netReceived || Math.max(0, orderItemsNet - orderSettlement.totalMl);
    }

    for (let i = 0; i < 12; i++) {
      const m = months[i];
      m.orders = orderIdsByMonth[i].size;
      m.totalProducts = m.merchandise + m.packaging;
      if (!m.netAfterMl && m.netSales) m.netAfterMl = Math.max(0, m.netSales - m.totalMl);
      m.contribution = m.netAfterMl - m.totalProducts;
      m.operatingExpenses = expenseTotal(expenses, i);
      m.retentions = num(expenses.retenciones?.[i]);
      m.taxes = num(expenses.impuestos?.[i]);
      m.operatingResult = m.contribution - m.operatingExpenses;
      m.netResult = m.operatingResult - m.retentions - m.taxes;
    }

    const totals = months.reduce((acc, m) => {
      for (const [key, value] of Object.entries(m)) {
        if (typeof value === 'number' && key !== 'index') acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {});
    const activeMonths = months.filter(m => m.netSales > 0 || m.operatingExpenses > 0 || m.taxes > 0 || m.retentions > 0).length || 1;
    const averages = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / activeMonths]));
    const lastIndex = Math.min(year === now.getUTCFullYear() ? now.getUTCMonth() : 11, 11);
    const currentMonth = months[lastIndex];
    const previousMonth = months[Math.max(0, lastIndex - 1)];
    const variation = previousMonth.netResult
      ? (currentMonth.netResult - previousMonth.netResult) / Math.abs(previousMonth.netResult)
      : null;

    const data = {
      year,
      generatedAt: new Date().toISOString(),
      source: 'Ventas, liquidaciones y costos de Mercado Libre + mercadería del Excel + gastos externos manuales',
      months,
      totals,
      averages,
      activeMonths,
      expenses,
      currentSummary: {
        monthIndex: lastIndex,
        netSales: currentMonth.netSales,
        netAfterMl: currentMonth.netAfterMl,
        contribution: currentMonth.contribution,
        netResult: currentMonth.netResult,
        netMargin: currentMonth.netSales ? currentMonth.netResult / currentMonth.netSales : null,
        variation
      },
      coverage: {
        orders: orders.length,
        settlementPayments: totals.settlementPayments || 0,
        settlementFallbacks: totals.settlementFallbacks || 0,
        matchedUnits: totals.matchedUnits || 0,
        unmatchedUnits: totals.unmatchedUnits || 0,
        costFile: costsRecord.fileName || null,
        costImportedAt: costsRecord.importedAt || null,
        note: 'Comisiones, cuotas, cargos, envíos y demás descuentos se concilian desde las liquidaciones de Mercado Libre. Mercadería y packaging vienen del Excel. Publicidad, sueldos, contador, retenciones, impuestos y otros gastos externos son editables por mes.'
      }
    };

    await saveCache({ createdAt: Date.now(), data }, cacheKey);
    return json(data);
  } catch (error) {
    return json({ error: error.message === 'NOT_CONNECTED' ? 'Conectá Mercado Libre.' : error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
