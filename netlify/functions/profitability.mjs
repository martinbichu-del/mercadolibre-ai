import { json, meli, getCostsRecord, fetchOrders, paidOrders, startOfMonth, endOfMonth } from './_shared.mjs';

const n=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:0};
const normalizeSku=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]/g,'').toUpperCase();
function parseMonth(value){const now=new Date(),m=/^(\d{4})-(\d{2})$/.exec(value||'');return m?{year:+m[1],monthIndex:+m[2]-1}:{year:now.getUTCFullYear(),monthIndex:now.getUTCMonth()}}
function skuCandidates(row){return [row?.item?.seller_sku,row?.item?.seller_custom_field,row?.seller_sku,row?.seller_custom_field].filter(Boolean).map(String)}
function financialModel(product){
  const salePrice=n(product?.netPrice)||n(product?.increasedPrice)||n(product?.listPrice);
  const commission=n(product?.meliCommission),installments=n(product?.installments),fixedCharge=n(product?.fixedCharge),shipping=n(product?.shipping),other=0;
  const mlCosts=commission+installments+fixedCharge+shipping+other;
  const netAfterMl=n(product?.netAfterMeli)||Math.max(0,salePrice-mlCosts);
  const unitCost=n(product?.costPack)||n(product?.cost),profit=n(product?.profit)||(netAfterMl-unitCost);
  return {salePrice,commission,installments,fixedCharge,shipping,other,mlCosts,netAfterMl,unitCost,profit,marginOnSale:salePrice?profit/salePrice:null,returnOnCost:unitCost?profit/unitCost:null};
}
function aggregate(orders,costsBySku){
  const map=new Map();
  for(const order of orders)for(const row of order.order_items||[]){
    const matched=skuCandidates(row).find(s=>costsBySku.has(normalizeSku(s)));if(!matched)continue;
    const key=normalizeSku(matched),cur=map.get(key)||{units:0,operations:0,itemId:row.item?.id||'',title:row.item?.title||costsBySku.get(key)?.model||matched};
    cur.units+=Math.max(1,n(row.quantity));cur.operations++;map.set(key,cur);
  }
  return map;
}
export default async request=>{
  try{
    const url=new URL(request.url),selected=parseMonth(url.searchParams.get('month')),now=new Date();
    const monthFrom=startOfMonth(selected.year,selected.monthIndex),fullEnd=endOfMonth(selected.year,selected.monthIndex);
    const monthTo=selected.year===now.getUTCFullYear()&&selected.monthIndex===now.getUTCMonth()?now:fullEnd;
    const basisTo=monthTo,basisFrom=new Date(basisTo.getTime()-60*24*60*60*1000);
    const user=await meli('/users/me');
    const [monthOrders,basisOrders]=await Promise.all([
      fetchOrders({sellerId:user.id,from:monthFrom,to:monthTo}).then(paidOrders),
      fetchOrders({sellerId:user.id,from:basisFrom,to:basisTo}).then(paidOrders)
    ]);
    const costsRecord=await getCostsRecord(),imported=costsRecord.products||[];
    const costsBySku=new Map(imported.map(p=>[normalizeSku(p.sku),p]));
    const monthAgg=aggregate(monthOrders,costsBySku),basisAgg=aggregate(basisOrders,costsBySku);
    const rows=[];
    for(const product of imported){
      const key=normalizeSku(product.sku),basis=basisAgg.get(key),month=monthAgg.get(key);
      if(!basis)continue;
      const model=financialModel(product),basisUnits=basis.units||0,monthUnits=month?.units||0;
      rows.push({
        sku:product.sku,itemId:basis.itemId,title:basis.title,units:monthUnits,operations:month?.operations||0,
        basisUnits,basisOperations:basis.operations,basisDays:60,costMatched:true,source:'excel-financial-model-60d',
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
      costBasis:{from:basisFrom.toISOString(),to:basisTo.toISOString(),days:60},rows,
      coverage:{orders:monthOrders.length,basisOrders:basisOrders.length,matchedProducts:rows.length,
        note:'Las unidades comerciales corresponden al mes seleccionado. Precio, cargos, neto y rentabilidad usan como base las ventas de los últimos 60 días; la estructura financiera proviene de tu Excel.'}
    });
  }catch(error){return json({error:error.message==='NOT_CONNECTED'?'Conectá Mercado Libre.':error.message},error.message==='NOT_CONNECTED'?401:500)}
};
