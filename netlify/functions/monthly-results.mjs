import {
  json, meli, fetchOrders, paidOrders, startOfMonth, endOfMonth,
  getCostsRecord, getPnlExpenses, savePnlExpenses, getCache, saveCache, getSalesImportRecord
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
    listSales: 0,
    discounts: 0,
    totalSales: 0,
    cancellations: 0,
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
  return [detail?.type, detail?.fee_type, detail?.name, detail?.description, detail?.reason, detail?.detail]
    .filter(Boolean).join(' ').toLowerCase();
}

function allFeeRows(payment) {
  return [
    ...(Array.isArray(payment?.fee_details) ? payment.fee_details : []),
    ...(Array.isArray(payment?.charges_details) ? payment.charges_details : []),
    ...(Array.isArray(payment?.fees) ? payment.fees : [])
  ];
}

function classifyPayment(payment) {
  const transactionAmount = num(payment?.transaction_amount || payment?.total_paid_amount || payment?.amount);
  const netReceived = num(payment?.transaction_details?.net_received_amount ?? payment?.net_received_amount ?? payment?.net_amount);
  const marketplaceFee = Math.abs(num(payment?.marketplace_fee ?? payment?.marketplace_fee_amount));
  let commission = marketplaceFee;
  let installments = Math.abs(num(payment?.financing_fee ?? payment?.installments_fee ?? payment?.financial_cost));
  let fixedCharge = Math.abs(num(payment?.fixed_fee ?? payment?.fixed_charge));
  let shipping = Math.abs(num(payment?.shipping_cost ?? payment?.shipping_amount));
  let explicitOther = Math.abs(num(payment?.taxes_amount ?? payment?.tax_amount));

  for (const fee of allFeeRows(payment)) {
    const amount = Math.abs(num(fee?.amount ?? fee?.value ?? fee?.fee_amount));
    const type = feeType(fee);
    if (!amount) continue;
    if (/financ|install|cuota|financial|interest|interes|interés/.test(type)) installments += amount;
    else if (/fixed|cargo fijo|flat fee/.test(type)) fixedCharge += amount;
    else if (/shipping|shipment|envio|envío|freight|logistic/.test(type)) shipping += amount;
    else if (/marketplace|sale fee|commission|comision|comisión|selling fee/.test(type)) {
      if (!marketplaceFee) commission += amount;
    } else explicitOther += amount;
  }

  const componentTotal = commission + installments + fixedCharge + shipping + explicitOther;
  const settlementCost = netReceived > 0 && transactionAmount > 0
    ? Math.max(0, transactionAmount - netReceived)
    : Math.max(0, componentTotal);
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
    detailed: Boolean(netReceived || allFeeRows(payment).length || marketplaceFee || installments || fixedCharge)
  };
}


function classifyOrderPaymentFallback(payment) {
  return classifyPayment(payment || {});
}

async function fetchPaymentDetails(orders) {
  const ids = [...new Set(orders.flatMap(order => (order.payments || []).map(p => p?.id).filter(Boolean)).map(String))];
  const map = new Map();
  const concurrency = 4;
  let cursor = 0;

  async function getPayment(id) {
    const paths = [
      `/v1/payments/${encodeURIComponent(id)}`,
      `/payments/${encodeURIComponent(id)}`,
      `/collections/${encodeURIComponent(id)}`
    ];
    for (const path of paths) {
      try {
        const payment = await meli(path);
        if (payment && (payment.id || payment.collection?.id || payment.transaction_amount != null)) {
          return payment.collection || payment;
        }
      } catch {}
    }
    return null;
  }

  async function worker() {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index];
      const payment = await getPayment(id);
      if (payment) map.set(id, payment);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, () => worker()));
  return map;
}


async function fetchShipmentSellerCosts(orders) {
  const ids = [...new Set((orders || []).map(o => o?.shipping?.id).filter(Boolean).map(String))];
  const map = new Map();
  const concurrency = 5;
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      try {
        const costs = await meli(`/shipments/${encodeURIComponent(id)}/costs`);
        const senderCost = (costs?.senders || []).reduce((sum, row) => sum + Math.abs(num(row?.cost)), 0);
        map.set(id, senderCost);
      } catch {
        map.set(id, 0);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, () => worker()));
  return map;
}

function orderItemsAmount(order, field = 'unit_price') {
  return (order?.order_items || []).reduce((sum, row) => {
    const quantity = Math.max(1, num(row?.quantity));
    return sum + num(row?.[field]) * quantity;
  }, 0);
}

function approvedPayment(payment) {
  const status = String(payment?.status || '').toLowerCase();
  return ['approved', 'paid', 'refunded', 'charged_back', 'partially_refunded'].includes(status)
    || num(payment?.transaction_amount_refunded) > 0
    || num(payment?.refunded_amount) > 0;
}

function orderWasFinanciallyCaptured(order) {
  if (String(order?.status || '').toLowerCase() === 'paid') return true;
  return (order?.payments || []).some(approvedPayment);
}

function orderRefundAmount(order) {
  let refunded = 0;
  for (const payment of order?.payments || []) {
    const status = String(payment?.status || '').toLowerCase();
    const explicit = Math.abs(num(payment?.transaction_amount_refunded ?? payment?.refunded_amount));
    if (explicit) refunded += explicit;
    else if (['refunded', 'charged_back'].includes(status)) {
      refunded += Math.abs(num(payment?.transaction_amount || payment?.total_paid_amount));
    }
  }
  return refunded;
}


function buildMonthsFromImportedSales(record, year, costsRecord, expenses) {
  const months = Array.from({ length: 12 }, (_, i) => monthTemplate(i));
  const costsBySku = new Map((costsRecord.products || []).map(p => [normalizeSku(p.sku), p]));
  const ids = Array.from({length:12},()=>new Set());
  for (const row of record.rows || []) {
    const date = new Date(row.date); if (date.getUTCFullYear() !== year) continue;
    const i=date.getUTCMonth(), m=months[i], units=Math.max(0,num(row.units)); ids[i].add(String(row.saleId));
    const productIncome=num(row.productIncome), cancellations=Math.abs(num(row.cancellationsRefunds));
    const saleFee=Math.abs(num(row.saleFee)), fixed=Math.abs(num(row.fixedCost)), installments=Math.abs(num(row.installmentsCost));
    const shipping=Math.max(0,Math.abs(num(row.shippingCost))-Math.abs(num(row.shippingIncome)));
    const netSales=Math.max(0,productIncome-cancellations), reportedTotal=num(row.total);
    const totalMl=Math.max(0,netSales-reportedTotal), known=saleFee+fixed+installments+shipping, other=Math.max(0,totalMl-known);
    m.totalSales+=productIncome; m.cancellations+=cancellations; m.netSales+=netSales; m.units+=units;
    m.commission+=saleFee; m.fixedCharge+=fixed; m.installments+=installments; m.shipping+=shipping; m.otherMl+=other; m.totalMl+=totalMl; m.netAfterMl+=reportedTotal;
    const product=costsBySku.get(normalizeSku(row.sku));
    if(product){m.matchedUnits+=units; const cost=num(product.cost), pack=num(product.packaging)||Math.max(0,num(product.costPack)-cost);m.merchandise+=cost*units;m.packaging+=pack*units}else m.unmatchedUnits+=units;
  }
  for(let i=0;i<12;i++){const m=months[i];m.orders=ids[i].size;m.listSales=m.totalSales+Math.max(0,m.discounts);m.totalProducts=m.merchandise+m.packaging;m.contribution=m.netAfterMl-m.totalProducts;m.operatingExpenses=expenseTotal(expenses,i);m.retentions=num(expenses.retenciones?.[i]);m.taxes=num(expenses.impuestos?.[i]);m.operatingResult=m.contribution-m.operatingExpenses;m.netResult=m.operatingResult-m.retentions-m.taxes}
  return months;
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
    const cacheKey = `pnl-v10-reconciled-${year}`;
    const cached = await getCache(cacheKey);
    if (!force && cached?.createdAt && Date.now() - cached.createdAt < 30 * 60 * 1000) return json(cached.data);

    const now = new Date();
    const from = startOfMonth(year, 0);
    const yearEnd = endOfMonth(year, 11);
    const to = year === now.getUTCFullYear() ? now : yearEnd;
    const [salesImport, costsRecord, expensesRecord] = await Promise.all([getSalesImportRecord(), getCostsRecord(), getPnlExpenses()]);
    const expenses = { ...defaultExpenseYear(), ...(expensesRecord.years?.[String(year)] || {}) };
    if ((salesImport.rows || []).some(r => new Date(r.date).getUTCFullYear() === year)) {
      const months = buildMonthsFromImportedSales(salesImport, year, costsRecord, expenses);
      const totals = months.reduce((acc,m)=>{for(const [k,v] of Object.entries(m))if(typeof v==='number'&&k!=='index')acc[k]=(acc[k]||0)+v;return acc},{});
      const activeMonths=months.filter(m=>m.netSales||m.operatingExpenses||m.taxes||m.retentions).length||1;
      const averages=Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v/activeMonths]));
      const lastIndex=Math.min(year===now.getUTCFullYear()?now.getUTCMonth():11,11),currentMonth=months[lastIndex],previousMonth=months[Math.max(0,lastIndex-1)];
      const variation=previousMonth.netResult?(currentMonth.netResult-previousMonth.netResult)/Math.abs(previousMonth.netResult):null;
      const data={year,generatedAt:new Date().toISOString(),source:'Base de ventas descargada de Mercado Libre + Excel de costos + gastos externos manuales',months,totals,averages,activeMonths,expenses,currentSummary:{monthIndex:lastIndex,totalSales:currentMonth.totalSales,cancellations:currentMonth.cancellations,netSales:currentMonth.netSales,netAfterMl:currentMonth.netAfterMl,contribution:currentMonth.contribution,netResult:currentMonth.netResult,netMargin:currentMonth.netSales?currentMonth.netResult/currentMonth.netSales:null,variation},coverage:{orders:totals.orders||0,allOrders:totals.orders||0,settlementPayments:0,settlementFallbacks:0,matchedUnits:totals.matchedUnits||0,unmatchedUnits:totals.unmatchedUnits||0,costFile:costsRecord.fileName||null,costImportedAt:costsRecord.importedAt||null,salesFile:salesImport.lastImport?.fileName||null,salesImportedAt:salesImport.importedAt||null,note:'Los importes financieros provienen de la Base de Ventas de Mercado Libre. Las actualizaciones se fusionan por # de venta y nunca duplican operaciones.'}};
      await saveCache({createdAt:Date.now(),data},cacheKey); return json(data);
    }
    const user = await meli('/users/me');
    const allOrders = await fetchOrders({ sellerId: user.id, from, to });
    const orders = paidOrders(allOrders);
    const [details, paymentDetails, shipmentCosts] = await Promise.all([
      itemDetailsFor(orders),
      fetchPaymentDetails(orders),
      fetchShipmentSellerCosts(orders)
    ]);

    const costsBySku = new Map((costsRecord.products || []).map(p => [normalizeSku(p.sku), p]));
    const months = Array.from({ length: 12 }, (_, i) => monthTemplate(i));
    const orderIdsByMonth = Array.from({ length: 12 }, () => new Set());

    // Solo se consideran ventas que tuvieron captura financiera. Una orden cancelada
    // antes de pagarse no es venta ni anulación contable. Las devoluciones se restan por
    // el importe efectivamente reintegrado, evitando inflar la fila de anulaciones.
    for (const order of allOrders) {
      if (!orderWasFinanciallyCaptured(order)) continue;
      const monthIndex = new Date(order.date_created).getUTCMonth();
      if (monthIndex < 0 || monthIndex > 11) continue;
      const amount = orderItemsAmount(order, 'unit_price');
      const refunded = Math.min(amount, orderRefundAmount(order));
      months[monthIndex].totalSales += amount;
      months[monthIndex].cancellations += refunded;
    }

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

      target.listSales += orderItemsGross;
      target.discounts += Math.max(0, orderItemsGross - orderItemsNet);

      const payments = order.payments || [];
      const saleFee = (order.order_items || []).reduce((sum, row) => sum + Math.abs(num(row?.sale_fee)), 0);
      const sellerShipping = Math.abs(num(shipmentCosts.get(String(order?.shipping?.id || ''))));
      let orderSettlement = { commission: 0, installments: 0, fixedCharge: 0, shipping: sellerShipping, otherMl: 0, paymentMl: 0, totalMl: 0 };
      for (const paymentSummary of payments) {
        const detail = paymentDetails.get(String(paymentSummary?.id));
        const classified = classifyPayment(detail ? { ...paymentSummary, ...detail } : paymentSummary);
        if (detail) target.settlementPayments += 1;
        else target.settlementFallbacks += 1;
        orderSettlement.commission += num(classified.commission);
        orderSettlement.installments += num(classified.installments);
        orderSettlement.fixedCharge += num(classified.fixedCharge);
        orderSettlement.otherMl += num(classified.otherMl);
        orderSettlement.paymentMl += Math.max(0, num(classified.totalMl) - num(classified.shipping));
      }

      // En muchas órdenes Mercado Libre informa la comisión únicamente en sale_fee.
      // Se usa como respaldo, nunca se suma dos veces.
      if (!orderSettlement.commission && saleFee) orderSettlement.commission = saleFee;
      const knownPayment = orderSettlement.commission + orderSettlement.installments + orderSettlement.fixedCharge;
      if (orderSettlement.paymentMl < knownPayment) orderSettlement.paymentMl = knownPayment + orderSettlement.otherMl;
      else orderSettlement.otherMl = Math.max(0, orderSettlement.paymentMl - knownPayment);
      orderSettlement.totalMl = orderSettlement.paymentMl + orderSettlement.shipping;

      target.commission += orderSettlement.commission;
      target.installments += orderSettlement.installments;
      target.fixedCharge += orderSettlement.fixedCharge;
      target.shipping += orderSettlement.shipping;
      target.otherMl += orderSettlement.otherMl;
      target.totalMl += orderSettlement.totalMl;
      target.netAfterMl += Math.max(0, orderItemsNet - orderSettlement.totalMl);
    }

    for (let i = 0; i < 12; i++) {
      const m = months[i];
      m.orders = orderIdsByMonth[i].size;
      m.netSales = Math.max(0, m.totalSales - m.cancellations);
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
      source: 'Órdenes, pagos, sale_fee y costos de envío de Mercado Libre + mercadería del Excel + gastos externos manuales',
      months,
      totals,
      averages,
      activeMonths,
      expenses,
      currentSummary: {
        monthIndex: lastIndex,
        totalSales: currentMonth.totalSales,
        cancellations: currentMonth.cancellations,
        netSales: currentMonth.netSales,
        netAfterMl: currentMonth.netAfterMl,
        contribution: currentMonth.contribution,
        netResult: currentMonth.netResult,
        netMargin: currentMonth.netSales ? currentMonth.netResult / currentMonth.netSales : null,
        variation
      },
      coverage: {
        orders: orders.length,
        allOrders: allOrders.length,
        settlementPayments: totals.settlementPayments || 0,
        settlementFallbacks: totals.settlementFallbacks || 0,
        matchedUnits: totals.matchedUnits || 0,
        unmatchedUnits: totals.unmatchedUnits || 0,
        costFile: costsRecord.fileName || null,
        costImportedAt: costsRecord.importedAt || null,
        note: 'Solo cuentan como ventas las órdenes con pago capturado. Anulaciones y devoluciones usan importes efectivamente reintegrados. Se prueban varias rutas de detalle de pago y se combinan con sale_fee y el costo real del remitente. Los gastos externos son editables por mes.'
      }
    };

    await saveCache({ createdAt: Date.now(), data }, cacheKey);
    return json(data);
  } catch (error) {
    return json({ error: error.message === 'NOT_CONNECTED' ? 'Conectá Mercado Libre.' : error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
