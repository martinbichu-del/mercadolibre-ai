const button=document.getElementById('capture');
const status=document.getElementById('status');
button.onclick=async()=>{
  button.disabled=true; status.textContent='Capturando resultados…';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id) throw new Error('No encontré la pestaña activa.');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'ROCKOS_CAPTURE',limit:150});
    if(!response?.ok) throw new Error(response?.error||'No se pudo capturar la búsqueda.');
    const blob=new Blob([JSON.stringify(response.data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const safe=(response.data.query||'busqueda').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,50);
    await chrome.downloads.download({url,filename:`rockos-seo-${safe||'captura'}-${new Date().toISOString().slice(0,10)}.json`,saveAs:true});
    status.innerHTML=`<span class="ok">Captura completa.</span>\n${response.data.results.length} resultados guardados.`;
  }catch(error){status.innerHTML=`<span class="bad">${error.message}</span>`}
  finally{button.disabled=false}
};
