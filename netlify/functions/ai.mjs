import { json, getCache } from './_shared.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY en Netlify.');
    const { question } = await request.json();
    if (!question || question.length > 1000) return json({ error: 'Escribí una pregunta válida.' }, 400);
    const cached = await getCache('dashboard-cache');
    if (!cached?.data) return json({ error: 'Primero actualizá el dashboard para cargar datos.' }, 400);

    const d = cached.data;
    const context = {
      period: d.period,
      metrics: d.metrics,
      projection: d.projection,
      topProducts: d.topProducts,
      urgentPurchases: (d.purchases || []).filter(x => x.urgency !== 'baja').slice(0, 20),
      productsWithCosts: (d.listings || []).filter(x => x.cost).slice(0, 60).map(x => ({
        id: x.id,
        sku: x.sku,
        title: x.title,
        price: x.price,
        stockMercadoLibre: x.available_quantity,
        unitsSelectedMonth: x.salesMonth?.units,
        dailyVelocity: x.dailyVelocity,
        coverageDays: x.coverageDays,
        suggestedOrder: x.suggestedOrder,
        costPack: x.cost?.costPack,
        estimatedGrossProfit: x.cost?.estimatedGrossProfit,
        estimatedMargin: x.cost?.estimatedMargin
      })),
      productsWithoutCosts: (d.listings || []).filter(x => !x.cost).slice(0, 30).map(x => ({ id: x.id, sku: x.sku, title: x.title, stockMercadoLibre: x.available_quantity }))
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: [{ type: 'input_text', text: 'Sos Rocko, un analista comercial de Mercado Libre Argentina. Respondé en español argentino, de forma concreta y accionable. No inventes datos. El stock válido siempre es el de Mercado Libre, nunca el del Excel. El plazo habitual de reposición desde China hasta Buenos Aires está en los parámetros del contexto. Diferenciá margen simple de rentabilidad neta: no llames ganancia neta a un cálculo que no descuenta todos los cargos. No ejecutes cambios; solo analizá y recomendá.' }] },
          { role: 'user', content: [{ type: 'input_text', text: `Datos actuales: ${JSON.stringify(context)}\n\nPregunta: ${question}` }] }
        ],
        max_output_tokens: 900
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'OpenAI no pudo responder.');
    const answer = payload.output_text || payload.output?.flatMap(x => x.content || []).map(x => x.text || '').join('\n') || 'No se recibió una respuesta.';
    return json({ answer });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
};
