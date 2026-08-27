import { json, meli } from './_shared.mjs';

const stop = new Set(['de','del','la','las','el','los','para','con','y','en','por','un','una','mercado','libre','rockos','rocko']);
const queryFromTitle = title => String(title || '').toLowerCase()
  .replace(/[^a-z0-9áéíóúñü\s-]/gi, ' ').split(/\s+/)
  .filter(word => word.length > 2 && !stop.has(word)).slice(0, 9).join(' ');

function cleanQuery(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const q = u.searchParams.get('q') || u.searchParams.get('as_word') || '';
    if (q) return decodeURIComponent(q.replace(/\+/g, ' ')).trim();
    const path = decodeURIComponent(u.pathname)
      .replace(/^\/(listado\/)?/i, '')
      .replace(/_Desde_\d+.*$/i, '')
      .replace(/-NoIndex_True.*$/i, '')
      .replace(/\/+$/,'')
      .replace(/[-_]+/g, ' ');
    return path.trim();
  } catch {
    return raw;
  }
}

async function publicFetch(url) {
  const response = await fetch(url, { headers: {
    accept: 'text/html,application/json',
    'accept-language': 'es-AR,es;q=0.9',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36'
  }});
  const text = await response.text();
  if (!response.ok) { const e = new Error(`Respuesta pública ${response.status}`); e.status=response.status; throw e; }
  return { text, contentType: response.headers.get('content-type') || '' };
}

async function apiSearch150(query) {
  const all=[];
  for (const offset of [0,50,100]) {
    const { text } = await publicFetch(`https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=50&offset=${offset}`);
    const page=JSON.parse(text);
    all.push(...(page.results||[]));
    if ((page.results||[]).length<50) break;
  }
  return {results:all.slice(0,150),source:'api_publica_150'};
}

function slugify(query){return query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'')}
async function storefrontSearch150(query) {
  const slug=slugify(query), ids=[];
  for (const start of [1,51,101]) {
    const suffix=start===1?'':`_Desde_${start}_NoIndex_True`;
    const { text }=await publicFetch(`https://listado.mercadolibre.com.ar/${encodeURIComponent(slug)}${suffix}`);
    for (const id of (text.match(/MLA\d{8,}/g)||[])) if(!ids.includes(id)) ids.push(id);
    if(ids.length>=150) break;
  }
  if(!ids.length) throw Object.assign(new Error('Mercado Libre no devolvió resultados públicos.'),{status:502});
  const items=[];
  for(let i=0;i<Math.min(ids.length,150);i+=20){
    const {text}=await publicFetch(`https://api.mercadolibre.com/items?ids=${ids.slice(i,i+20).join(',')}`);
    items.push(...JSON.parse(text).map(x=>x.body).filter(Boolean));
  }
  const order=new Map(ids.map((id,i)=>[id,i]));
  items.sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999));
  return {results:items.slice(0,150),source:'listado_publico_150'};
}

function parseManualIds(value) {
  return [...new Set((String(value || '').match(/MLA[-_]?\d{8,}/gi) || []).map(x => x.replace(/[-_]/g,'').toUpperCase()))].slice(0, 30);
}
async function manualItems(value) {
  const ids=parseManualIds(value); if(!ids.length) return null;
  const results=[];
  for(let i=0;i<ids.length;i+=20){
    const {text}=await publicFetch(`https://api.mercadolibre.com/items?ids=${ids.slice(i,i+20).join(',')}`);
    results.push(...JSON.parse(text).map(x=>x.body).filter(Boolean));
  }
  return {results,source:'enlaces_manual'};
}

const compact=item=>({
  id:item.id,title:item.title,price:item.price,original_price:item.original_price,currency_id:item.currency_id,
  available_quantity:item.available_quantity,sold_quantity:item.sold_quantity??null,free_shipping:Boolean(item.shipping?.free_shipping),
  official_store:Boolean(item.official_store_id),permalink:item.permalink,thumbnail:item.thumbnail,seller_id:item.seller?.id||item.seller_id,
  condition:item.condition,listing_type_id:item.listing_type_id
});

export default async request => {
  try{
    const url=new URL(request.url), itemId=url.searchParams.get('itemId');
    const input=url.searchParams.get('search')||url.searchParams.get('competitors')||'';
    if(!itemId) return json({error:'Falta itemId.'},400);
    const own=await meli(`/items/${encodeURIComponent(itemId)}`);
    const manual=await manualItems(input);
    let query='', result;
    if(manual){result=manual; query='Competidores específicos';}
    else{
      query=cleanQuery(input)||queryFromTitle(own.title);
      try{result=await apiSearch150(query)}catch{result=await storefrontSearch150(query)}
    }
    const candidates=result.results||[];
    const ownIndex=candidates.findIndex(x=>x.id===own.id);
    const ranked=candidates.map((item,index)=>({...compact(item),rank:index+1}));
    const competitors=ranked.filter(item=>item.id!==own.id && item.seller_id!==own.seller_id)
      .slice(0,25).map(item=>({...item,priceDifference:own.price?(Number(item.price)-Number(own.price))/Number(own.price):null}));
    return json({
      query,source:result.source,scanned:candidates.length,ownPosition:ownIndex>=0?ownIndex+1:null,
      own:{...compact(own),rank:ownIndex>=0?ownIndex+1:null},competitors,
      notes:[
        `Se revisaron ${candidates.length} resultados públicos (máximo 150).`,
        ownIndex>=0?`Tu publicación fue observada en la posición ${ownIndex+1}.`:'Tu publicación no apareció entre los resultados revisados.',
        'La posición es observada: puede variar por ubicación, sesión, publicidad y personalización.'
      ]
    });
  }catch(error){
    return json({error:'No pude analizar esa búsqueda. Pegá una URL general de listado, palabras clave o enlaces directos MLA.',technical:error.message},Number(error.status||500));
  }
};
