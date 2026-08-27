import { json, meli } from './_shared.mjs';

const stop = new Set(['de','del','la','las','el','los','para','con','y','en','por','un','una','mercado','libre','rockos','rocko']);
const queryFromTitle = title => String(title || '').toLowerCase()
  .replace(/[^a-z0-9áéíóúñü\s-]/gi, ' ').split(/\s+/)
  .filter(word => word.length > 2 && !stop.has(word)).slice(0, 7).join(' ');

async function publicFetch(url) {
  const response = await fetch(url, { headers: { accept: 'text/html,application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36' } });
  const text = await response.text();
  if (!response.ok) { const e = new Error(`Respuesta pública ${response.status}`); e.status=response.status; throw e; }
  return { text, contentType: response.headers.get('content-type') || '' };
}

async function apiSearch(query) {
  const { text } = await publicFetch(`https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=20`);
  return JSON.parse(text);
}

async function storefrontSearch(query) {
  const slug = query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'');
  const { text } = await publicFetch(`https://listado.mercadolibre.com.ar/${encodeURIComponent(slug)}`);
  const ids = [...new Set((text.match(/MLA\d{8,}/g) || []))].slice(0, 25);
  if (!ids.length) throw Object.assign(new Error('No se encontraron publicaciones en el buscador público.'), { status: 502 });
  const result = await publicFetch(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`);
  return { results: JSON.parse(result.text).map(x => x.body).filter(Boolean), source: 'listado_publico' };
}

function parseManualIds(value) {
  return [...new Set((String(value || '').match(/MLA\d{8,}/gi) || []).map(x => x.toUpperCase()))].slice(0, 15);
}

async function manualItems(value) {
  const ids = parseManualIds(value);
  if (!ids.length) return null;
  const { text } = await publicFetch(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`);
  return { results: JSON.parse(text).map(x => x.body).filter(Boolean), source: 'enlaces_manual' };
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    const manual = url.searchParams.get('competitors');
    if (!itemId) return json({ error: 'Falta itemId.' }, 400);
    const own = await meli(`/items/${encodeURIComponent(itemId)}`);
    const query = queryFromTitle(own.title);
    let result = await manualItems(manual);
    let source = result?.source;
    if (!result) {
      try { result = await apiSearch(query); source = 'api_publica'; }
      catch { result = await storefrontSearch(query); source = result.source; }
    }
    const candidates = result.results || [];
    const competitors = candidates.filter(item => item.id !== own.id && item.seller_id !== own.seller_id && item.seller?.id !== own.seller_id).slice(0,10).map((item,index)=>({
      rank:index+1,id:item.id,title:item.title,price:item.price,original_price:item.original_price,currency_id:item.currency_id,
      available_quantity:item.available_quantity,sold_quantity:item.sold_quantity??null,free_shipping:Boolean(item.shipping?.free_shipping),
      official_store:Boolean(item.official_store_id),permalink:item.permalink,thumbnail:item.thumbnail,seller_id:item.seller?.id||item.seller_id,
      condition:item.condition,listing_type_id:item.listing_type_id,priceDifference:own.price?(Number(item.price)-Number(own.price))/Number(own.price):null
    }));
    return json({ query, source, own:{id:own.id,title:own.title,price:own.price,currency_id:own.currency_id,available_quantity:own.available_quantity,sold_quantity:own.sold_quantity,free_shipping:Boolean(own.shipping?.free_shipping),permalink:own.permalink,thumbnail:own.thumbnail,listing_type_id:own.listing_type_id}, competitors,
      notes:['Primero se intenta la API pública; si está bloqueada se usa el listado web público.','También podés pegar enlaces de competidores para una comparación directa.','No se accede a datos privados de otros vendedores.'] });
  } catch (error) {
    return json({ error:'No pude obtener competidores automáticamente. Pegá uno o más enlaces de Mercado Libre en el campo manual y volvé a analizar.', technical:error.message }, Number(error.status||500));
  }
};
