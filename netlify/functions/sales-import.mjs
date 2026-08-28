
import { json, getSalesImportRecord, saveSalesImportRecord } from './_shared.mjs';

const num = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};
const dateIso = value => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const raw=String(value).trim();
  const m=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if(m){const y=Number(m[3].length===2?'20'+m[3]:m[3]);const d=new Date(Date.UTC(y,Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0)));return d.toISOString()}
  const d=new Date(raw);return Number.isNaN(d.getTime())?null:d.toISOString();
};
const clean = row => ({
  saleId: String(row.saleId ?? '').trim(), date: dateIso(row.date), status: String(row.status ?? '').trim(),
  sku: String(row.sku ?? '').trim(), listingId: String(row.listingId ?? '').trim(), units: Math.max(0,num(row.units)),
  productIncome: num(row.productIncome), saleFee: num(row.saleFee), fixedCost: num(row.fixedCost),
  installmentsCost: num(row.installmentsCost), shippingIncome: num(row.shippingIncome), shippingCost: num(row.shippingCost),
  taxes: num(row.taxes), discountsBonuses: num(row.discountsBonuses), cancellationsRefunds: num(row.cancellationsRefunds), total: num(row.total)
});
const period = rows => {
  const dates=rows.map(r=>r.date).filter(Boolean).sort(); return {from:dates[0]||null,to:dates.at(-1)||null};
};
export default async request => {
  try {
    if(request.method==='GET'){
      const record=await getSalesImportRecord();
      return json({importedAt:record.importedAt, rows:record.rows.length, files:record.files||[], period:record.period||period(record.rows), lastImport:record.lastImport||null});
    }
    if(request.method!=='POST') return json({error:'Método no permitido.'},405);
    const body=await request.json();
    const incoming=(body.rows||[]).map(clean).filter(r=>r.saleId&&r.date);
    if(!incoming.length) return json({error:'No se encontraron operaciones válidas con # de venta y fecha.'},400);
    const current=await getSalesImportRecord();
    const map=new Map((current.rows||[]).map(r=>[String(r.saleId),r]));
    let added=0,updated=0,unchanged=0;
    for(const row of incoming){
      const previous=map.get(row.saleId);
      if(!previous){map.set(row.saleId,row);added++;continue}
      if(JSON.stringify(previous)===JSON.stringify(row)){unchanged++;continue}
      map.set(row.saleId,row);updated++;
    }
    const rows=[...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const info={fileName:String(body.fileName||'Base de ventas ML'), importedAt:new Date().toISOString(), incoming:incoming.length, added, updated, unchanged, total:rows.length, period:period(incoming)};
    const files=[...(current.files||[]),info].slice(-20);
    const record={importedAt:info.importedAt,rows,files,period:period(rows),lastImport:info};
    await saveSalesImportRecord(record);
    return json({ok:true,...info,masterPeriod:record.period});
  } catch(error){return json({error:error.message||'No se pudo importar la base.'},500)}
};
