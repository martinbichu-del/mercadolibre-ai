import { json, getCache } from './_shared.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Falta OPENAI_API_KEY en Netlify.');
    const { question } = await request.json();
    if (!question || question.length > 1000) return json({ error: 'Escribí una pregunta válida.' }, 400);
    const cached = await getCache();
    if (!cached?.data) return json({ error: 'Primero actualizá el dashboard para cargar datos.' }, 400);

    const context = {
      metrics: cached.data.metrics,
      topProducts: cached.data.topProducts,
      lowStock: cached.data.listings.filter(x => Number(x.available_quantity) <= 3).slice(0, 20),
      recentOrders: cached.data.recentOrders.slice(0, 10)
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: [{ type: 'input_text', text: 'Sos un analista comercial de Mercado Libre Argentina. Respondé en español argentino, con conclusiones concretas. No inventes datos. Aclarar cuando faltan costos para calcular rentabilidad. No ejecutes cambios en Mercado Libre; solo analizá y recomendá.' }] },
          { role: 'user', content: [{ type: 'input_text', text: `Datos del negocio: ${JSON.stringify(context)}\n\nPregunta: ${question}` }] }
        ],
        max_output_tokens: 700
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
