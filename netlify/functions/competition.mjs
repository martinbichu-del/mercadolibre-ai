import { json, meli } from './_shared.mjs';

const stop = new Set(['de','del','la','las','el','los','para','con','y','en','por','un','una','mercado','libre']);
const queryFromTitle = title => String(title || '')
  .toLowerCase()
  .replace(/[^a-z0-9áéíóúñü\s-]/gi, ' ')
  .split(/\s+/)
  .filter(word => word.length > 2 && !stop.has(word))
  .slice(0, 7)
  .join(' ');

export default async (request) => {
  try {
    const url = new URL(request.url);
    const itemId = url.searchParams.get('itemId');
    if (!itemId) return json({ error: 'Falta itemId.' }, 400);
    const own = await meli(`/items/${encodeURIComponent(itemId)}`);
    const query = queryFromTitle(own.title);
    const result = await meli(`/sites/MLA/search?q=${encodeURIComponent(query)}&limit=20`);
    const competitors = (result.results || [])
      .filter(item => item.id !== own.id && item.seller?.id !== own.seller_id)
      .slice(0, 10)
      .map((item, index) => ({
        rank: index + 1,
        id: item.id,
        title: item.title,
        price: item.price,
        original_price: item.original_price,
        currency_id: item.currency_id,
        available_quantity: item.available_quantity,
        sold_quantity: item.sold_quantity ?? null,
        free_shipping: Boolean(item.shipping?.free_shipping),
        official_store: Boolean(item.official_store_id),
        permalink: item.permalink,
        thumbnail: item.thumbnail,
        seller_id: item.seller?.id,
        condition: item.condition,
        listing_type_id: item.listing_type_id,
        priceDifference: own.price ? (Number(item.price) - Number(own.price)) / Number(own.price) : null
      }));

    return json({
      query,
      own: {
        id: own.id,
        title: own.title,
        price: own.price,
        currency_id: own.currency_id,
        available_quantity: own.available_quantity,
        sold_quantity: own.sold_quantity,
        free_shipping: Boolean(own.shipping?.free_shipping),
        permalink: own.permalink,
        thumbnail: own.thumbnail,
        listing_type_id: own.listing_type_id
      },
      competitors,
      notes: [
        'El orden proviene de la búsqueda pública de Mercado Libre al momento de la consulta.',
        'No se muestran datos privados de otros vendedores.',
        'La posición orgánica real puede variar por ubicación, dispositivo y personalización.'
      ]
    });
  } catch (error) {
    return json({ error: error.message }, error.message === 'NOT_CONNECTED' ? 401 : 500);
  }
};
