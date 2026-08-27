(() => {
  const absolute=(href,base)=>{try{return new URL(href,base).href}catch{return ''}};
  const text=(el)=>el?.textContent?.replace(/\s+/g,' ').trim()||'';
  const numberFrom=(value)=>{
    const clean=String(value||'').replace(/[^0-9,.-]/g,'').replace(/\./g,'').replace(',','.');
    const n=Number(clean); return Number.isFinite(n)?n:null;
  };
  const mlaFrom=(url)=>{
    const m=String(url||'').match(/MLA-?(\d{6,})/i); return m?`MLA${m[1]}`:null;
  };
  function parsePage(doc,pageUrl,startRank){
    const cards=[...doc.querySelectorAll('li.ui-search-layout__item, .ui-search-result, .poly-card, [data-testid="result"]')];
    const source=cards.length?cards:[...doc.querySelectorAll('a[href*="MLA-"]')].map(a=>a.closest('li,article,div')||a);
    const seen=new Set(), rows=[];
    for(const card of source){
      const a=card.matches?.('a')?card:card.querySelector('a[href*="MLA-"], a[href*="/p/"]');
      const href=absolute(a?.getAttribute('href'),pageUrl); const id=mlaFrom(href);
      if(!href||!id||seen.has(id)) continue; seen.add(id);
      const title=text(card.querySelector('.poly-component__title,.ui-search-item__title,h2,h3'))||text(a);
      const fraction=text(card.querySelector('.andes-money-amount__fraction'));
      const cents=text(card.querySelector('.andes-money-amount__cents'));
      let price=numberFrom(fraction); if(price!=null&&cents) price+=Number(cents)/100;
      const oldPrice=numberFrom(text(card.querySelector('.andes-money-amount--previous,.andes-money-amount__discount')));
      const shippingText=text(card.querySelector('.ui-search-item__shipping,.poly-component__shipping,.ui-search-item__group__element'));
      const seller=text(card.querySelector('.ui-search-official-store-label,.poly-component__seller,.ui-search-seller__header'));
      const img=card.querySelector('img');
      rows.push({rank:startRank+rows.length,id,title,price,oldPrice,free_shipping:/gratis|free/i.test(shippingText),full:/full/i.test(shippingText),sponsored:/patrocinado|sponsored/i.test(text(card)),seller,thumbnail:img?.currentSrc||img?.src||'',permalink:href});
    }
    const next=doc.querySelector('a[title="Siguiente"], .andes-pagination__button--next a, a.andes-pagination__link[aria-label*="Siguiente"]');
    return {rows,nextUrl:next?absolute(next.getAttribute('href'),pageUrl):null};
  }
  async function capture(limit=150){
    let url=location.href, all=[], page=0, nextUrl=url;
    const visited=new Set();
    while(nextUrl&&all.length<limit&&page<10&&!visited.has(nextUrl)){
      visited.add(nextUrl); page++;
      let doc;
      if(page===1){doc=document.cloneNode(true)}else{
        const res=await fetch(nextUrl,{credentials:'include',headers:{'Accept':'text/html'}});
        if(!res.ok) throw new Error(`Mercado Libre respondió ${res.status} en la página ${page}.`);
        doc=new DOMParser().parseFromString(await res.text(),'text/html');
      }
      const parsed=parsePage(doc,nextUrl,all.length+1);
      all.push(...parsed.rows.filter(r=>!all.some(x=>x.id===r.id)));
      nextUrl=parsed.nextUrl;
      await new Promise(r=>setTimeout(r,650));
    }
    const query=(document.querySelector('input[name="as_word"],input.nav-search-input')?.value||document.title||'Búsqueda Mercado Libre').trim();
    return {version:1,source:'rockos-seo-capture',captured_at:new Date().toISOString(),url:location.href,query,pages_scanned:page,results:all.slice(0,limit)};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
    if(msg?.type!=='ROCKOS_CAPTURE') return;
    capture(msg.limit||150).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));
    return true;
  });
})();
