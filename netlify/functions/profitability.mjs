import { json, meli, getCostsRecord, fetchOrders, paidOrders, startOfMonth, endOfMonth } from './_shared.mjs';

const n=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0};
const normalizeSku=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
function parseMonth(value){const now=new Date(),m=/^(\d{4})-(\d{2})$/.exec(value||'');return m?{year:+m[1],monthIndex:+m[2]-1}:{year:now.getUTCFullYear(),monthIndex:now.getUTCMonth()}}
function directSkuCandidates(row){return [row?.item?.seller_sku,row?.item?.seller_custom_field,row?.seller_sku,row?.seller_custom_field].filter(Boolean).map(String)}
function attrSku(attrs){const a=(attrs||[]).find(x=>String(x?.id||'').toUpperCase()==='SELLER_SKU');return a?.value_name||a?.value_id||''}
function skuFromItemDetail(detail,row){
  const variationId=row?.item?.variation_id??row?.variation_id;
  if(variationId!=null){
    const variation=(detail?.variations||[]).find(v=>String(v.id)===String(variationId));
    const vSku=variation?.seller_custom_field||attrSku(variation?.attributes);
    if(vSku)return String(vSku);
  }
  const main=detail?.seller_custom_field||attrSku(detail?.attributes);
  return main?String(main):'';
}
async function fetchItemDetails(orders){
  const ids=[...new Set(orders.flatMap(o=>(o.order_items||[]).map(r=>r?.item?.id).filter(Boolean)))];
  const map=new Map();
  for(let i=0;i<ids.length;i+=20){
    const chunk=ids.slice(i,i+20);
    try{
      const response=await meli(`/items?ids=${chunk.join(',')}`);
      for(const entry of (Array.isArray(response)?response:[]))if(entry?.body?.id)map.set(String(entry.body.id),entry.body);
    }catch{
      for(const id of chunk){try{const item=await meli(`/items/${encodeURIComponent(id)}`);if(item?.id)map.set(String(item.id),item)}catch{/* keep processing */}}
    }
  }
  return map;
}
function financialModel(product){
  const salePrice=n(product?.netPrice)||n(product?.increasedPrice)||n(product?.listPrice);
  const commission=n(product?.meliCommission),installments=n(product?.installments),fixedCharge=n(product?.fixedCharge),shipping=n(product?.shipping),other=0;
  const mlCosts=commission+installments+fixedCharge+shipping+other;
  const netAfterMl=n(product?.netAfterMeli)||Math.max(0,salePrice-mlCosts);
  const unitCost=n(product?.costPack)||n(product?.cost),profit=n(product?.profit)||(netAfterMl-unitCost);
  return {salePrice,commission,installments,fixedCharge,shipping,other,mlCosts,netAfterMl,unitCost,profit,marginOnSale:salePrice?profit/salePrice:null,returnOnCost:unitCost?profit/unitCost:null};
}
async function aggregate(orders,costsBySku,itemDetails){
  const map=new Map();
  for(const order of orders)for(const row of order.order_items||[]){
    let matched=directSkuCandidates(row).find(s=>costsBySku.has(normalizeSku(s)));
    let detectedSku=matched||'';
    if(!matched){
      const detail=itemDetails.get(String(row?.item?.id||''));
      detectedSku=skuFromItemDetail(detail,row);
      if(detectedSku&&costsBySku.has(normalizeSku(detectedSku)))matched=detectedSku;
    }
    if(!matched)continue;
    const key=normalizeSku(matched),cur=map.get(key)||{units:0,operations:0,itemId:row.item?.id||'',title:row.item?.title||costsBySku.get(key)?.model||matched,detectedSku};
    cur.units+=Math.max(1,n(row.quantity));cur.operations++;map.set(key,cur);
  }
  return map;
}
export default async request=>{
  try{
    const url=new URL(request.url),selected=parseMonth(url.searchParams.get('month')),now=new Date();
    const monthFrom=startOfMonth(selected.year,selected.monthIndex),fullEnd=endOfMonth(selected.year,selected.monthIndex);
    const monthTo=selected.year===now.getUTCFullYear()&&selected.monthIndex===now.getUTCMonth()?now:fullEnd;
    // Two full calendar months ending at the selected period date. 62 days avoids dropping early-July sales on 31-day months.
    const basisTo=monthTo,basisFrom=new Date(basisTo.getTime()-62*24*60*60*1000);
    const user=await meli('/users/me');
    const [monthOrders,basisOrders]=await Promise.all([
      fetchOrders({sellerId:user.id,from:monthFrom,to:monthTo}).then(paidOrders),
      fetchOrders({sellerId:user.id,from:basisFrom,to:basisTo}).then(paidOrders)
    ]);
    const costsRecord=await getCostsRecord(),imported=costsRecord.products||[];
    const costsBySku=new Map(imported.map(p=>[normalizeSku(p.sku),p]));
    const itemDetails=await fetchItemDetails(basisOrders);
    const [monthAgg,basisAgg]=await Promise.all([
      aggregate(monthOrders,costsBySku,itemDetails),aggregate(basisOrders,costsBySku,itemDetails)
    ]);
    const rows=[];
    for(const product of imported){
      const key=normalizeSku(product.sku),basis=basisAgg.get(key),month=monthAgg.get(key);
      if(!basis)continue;
      const model=financialModel(product),basisUnits=basis.units||0,monthUnits=month?.units||0;
      rows.push({
        sku:product.sku,detectedSku:basis.detectedSku||product.sku,itemId:basis.itemId,title:basis.title,units:monthUnits,operations:month?.operations||0,
        basisUnits,basisOperations:basis.operations,basisDays:62,costMatched:true,source:'excel-financial-model-62d-enriched-sku',
        confidence:basisUnits>=10?'alta':basisUnits>=3?'media':'baja',
        averageSalePrice:model.salePrice,averageMlCosts:model.mlCosts,averageNetAfterMl:model.netAfterMl,unitCost:model.unitCost,
        averageProfit:model.profit,realMargin:model.marginOnSale,returnOnCost:model.returnOnCost,
        commission:model.commission*basisUnits,installments:model.installments*basisUnits,fixedCharge:model.fixedCharge*basisUnits,
        shipping:model.shipping*basisUnits,other:model.other*basisUnits,mlCosts:model.mlCosts*basisUnits,sales:model.salePrice*basisUnits,
        netAfterMl:model.netAfterMl*basisUnits,merchandiseCost:model.unitCost*basisUnits,realProfit:model.profit*basisUnits,
        unitBreakdown:{commission:model.commission,installments:model.installments,fixedCharge:model.fixedCharge,shipping:model.shipping,other:model.other}
      });
    }
    rows.sort((a,b)=>b.basisUnits-a.basisUnits);
    return json({
      period:{from:monthFrom.toISOString(),to:monthTo.toISOString()},
      costBasis:{from:basisFrom.toISOString(),to:basisTo.toISOString(),days:62},rows,
      coverage:{orders:monthOrders.length,basisOrders:basisOrders.length,matchedProducts:rows.length,
        note:'Las unidades comerciales corresponden al mes seleccionado. La base de costos revisa los últimos dos meses y también recupera el SKU desde la publicación o variación cuando no viene dentro de la orden.'}
    });
  }catch(error){return json({error:error.message==='NOT_CONNECTED'?'Conectá Mercado Libre.':error.message},error.message==='NOT_CONNECTED'?401:500)}
};
