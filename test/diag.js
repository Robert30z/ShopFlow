// ShopFlow — diagnóstico de TODA la app (estático + E2E). No modifica nada.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://localhost:8931/index.html';
let fail = 0, warn = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };
const wn = (n, d) => { console.log(`[WARN] ${n}${d?' — '+d:''}`); warn++; };

// ---------- 1) AUDITORÍA ESTÁTICA DE CABLEADO (todos los handlers -> función existe) ----------
const src = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
// nombres de funciones definidas: function X(  |  X=function  |  var X=function
const defined = new Set();
let m;
const reDef = [/function\s+([A-Za-z_$][\w$]*)\s*\(/g, /(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*function\b/g];
reDef.forEach(re => { while((m=re.exec(src))) defined.add(m[1]); });
// funciones nativas / globales permitidas
const builtins = new Set(['alert','confirm','prompt','event','window','document','location','history','parseFloat','parseInt','JSON','Math','Date','Object','Array','String','Number','setTimeout','clearTimeout','encodeURIComponent','decodeURIComponent','open','print','isNaN','console','navigator','this','RegExp','Boolean','btoa','atob','URL']);
// extrae llamadas dentro de on*="..."  (maneja comillas escapadas \" en template strings)
const handlerRe = /on(?:click|change|input|submit|keyup|keydown|blur|focus)\s*=\s*(?:"|\\")((?:[^"\\]|\\.)*?)(?:"|\\")/g;
const called = new Map(); // fn -> count
let h;
while((h = handlerRe.exec(src))){
  let body = h[1].replace(/\\'/g,"'").replace(/\\"/g,'"');
  let c; const callRe = /([A-Za-z_$][\w$]*)\s*\(/g;
  while((c = callRe.exec(body))){
    const fn = c[1];
    // ignora métodos .foo( y palabras clave de control
    const before = body[c.index-1];
    if(before==='.') continue;
    if(['if','for','while','return','function','var','let','const','new','typeof','else','switch','catch'].includes(fn)) continue;
    called.set(fn, (called.get(fn)||0)+1);
  }
}
const missing = [];
for(const fn of called.keys()){
  if(!defined.has(fn) && !builtins.has(fn)) missing.push(fn);
}
ok(missing.length===0, 'Cableado: todos los on* apuntan a funciones que existen',
   missing.length? ('faltan: '+missing.join(', ')) : (called.size+' handlers únicos verificados'));

// ---------- E2E ----------
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, permissions:[] });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message.slice(0,200)));
  page.on('console', msg => { if(msg.type()==='error' && !/cdn|favicon|Failed to load resource/i.test(msg.text())) errors.push(msg.text().slice(0,160)); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const vclick = sel => page.locator(sel).filter({visible:true}).first().click({timeout:5000});

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(1200);
  ok(true, 'App carga');

  // 2) todas las pantallas
  for(const s of ['garage','ordenes','clientes','menu','finanzas','historial','inventario','ajustes']){
    try { await vclick(`[onclick="go('${s}')"]`); await page.waitForTimeout(200); await vclick(`[onclick="go('home')"]`); ok(true, `Pantalla: ${s}`); }
    catch(e){ ok(false, `Pantalla: ${s}`, e.message.split('\n')[0]); }
  }

  // 3) librerías críticas cargadas (jsPDF, ZXing)
  const libs = await page.evaluate(() => ({ jspdf: typeof window.jspdf, zxing: typeof window.ZXing }));
  ok(libs.jspdf!=='undefined', 'Librería jsPDF cargada (PDF)', libs.jspdf);
  ok(libs.zxing!=='undefined', 'Librería ZXing cargada (escáner VIN)', libs.zxing);

  // 4) FLUJO PDF — crear RO y generar recibo
  await vclick(`[onclick="go('ro')"]`); await page.waitForTimeout(400);
  await page.fill('#c-n','Diag Cliente');
  await page.fill('#c-t','787-555-1234');
  await page.fill('#v-y','2018'); await page.fill('#v-ma','Toyota'); await page.fill('#v-mo','Corolla');
  await page.evaluate(`gotoStep(2)`); await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({visible:true}).first().click();
  await page.waitForTimeout(200);
  // firma 1 (necesaria para autorización en PDF)
  await page.evaluate(() => { RO.sigData=RO.sigData||{}; RO.sigData.sig1='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mhowever'; }).catch(()=>{});
  // generar recibo PDF
  await page.evaluate(`gotoStep(8)`); await page.waitForTimeout(200);
  const pdf = await page.evaluate(async () => {
    try {
      exportPDF();
      const modalOpen = document.getElementById('pdf-share-modal').style.display==='flex';
      const b = window._pdfBlob;
      const buf = b ? new Uint8Array(await b.arrayBuffer()).slice(0,5) : null;
      const magic = buf ? String.fromCharCode.apply(null, buf) : '';
      return { modalOpen, size: b?b.size:0, magic, ctx: window._pdfCtx, fname: window._pdfFilename };
    } catch(e){ return { err: e.message }; }
  });
  ok(!pdf.err && pdf.modalOpen, 'PDF recibo: se genera y abre el modal', pdf.err||('modal='+pdf.modalOpen));
  ok(pdf.magic==='%PDF-', 'PDF recibo: blob es un PDF válido', 'magic='+pdf.magic+' size='+pdf.size);
  ok(pdf.ctx && pdf.ctx.id && pdf.ctx.cliente==='Diag Cliente', 'PDF recibo: contexto congelado (_pdfCtx)', JSON.stringify(pdf.ctx));

  // 5) botones del modal existen y funciones definidas
  const modalBtns = await page.evaluate(() => {
    const names = ['sendWhatsAppPDF','shareViaNative','printPDF','downloadPDF','closePDFShare'];
    const res = {};
    names.forEach(n => res[n] = typeof window[n]==='function');
    const waBtn = !!document.querySelector('[onclick="sendWhatsAppPDF()"]');
    return { res, waBtn };
  });
  ok(Object.values(modalBtns.res).every(Boolean) && modalBtns.waBtn, 'PDF modal: botones cableados', JSON.stringify(modalBtns.res));

  // 6) sendWhatsAppPDF NO usa RO en vivo (usa _pdfCtx) — simulamos que RO cambió
  const waMsg = await page.evaluate(() => {
    let opened = null;
    const orig = window.open; window.open = (u)=>{ opened=u; return {focus(){}}; };
    // cambia RO drásticamente para probar que el mensaje sale del contexto congelado
    window.RO = { id:'RO-OTRO', cliente:'Otra Persona', tel:'000', total:999 };
    try { sendWhatsAppPDF(); } catch(e){ return {err:e.message}; }
    window.open = orig;
    return { url: opened };
  });
  let waDec=''; try { waDec = decodeURIComponent(waMsg.url||''); } catch(e){ waDec = waMsg.url||''; }
  ok(waMsg.url && /Diag/.test(waDec) && /5551234/.test(waDec),
     'WhatsApp usa el contexto correcto del recibo (no el RO en vivo)', waMsg.err||waDec.slice(0,90));

  // 7) shareViaNative sin navigator.share -> cae a descarga sin lanzar error
  const shareFallback = await page.evaluate(() => {
    const c = document.createElement.bind(document);
    let clicked=false;
    document.createElement = function(t){ const el=c(t); if(t==='a'){ const oc=el.click.bind(el); el.click=function(){clicked=true;}; } return el; };
    let alerted=false; const oa=window.alert; window.alert=()=>{alerted=true;};
    try { shareViaNative(); } catch(e){ return {err:e.message}; } finally { document.createElement=c; window.alert=oa; }
    return { clicked, alerted };
  });
  ok(!shareFallback.err && shareFallback.clicked, 'PDF compartir: fallback descarga garantizada (sin navigator.share)', shareFallback.err||('descargó='+shareFallback.clicked));

  // restaura un RO completo y realista (el paso 6 dejó un stub a propósito)
  await page.evaluate(() => {
    window.RO = { id:'RO-DIAG', fecha:new Date().toISOString(), cliente:'Diag Cliente', tel:'787-555-1234', email:'',
      vehiculo:{year:'2018',make:'Toyota',model:'Corolla',tag:'ABC-123',color:'',odoIn:'50000',odoOut:'',vin:''},
      queja:'ruido', insp:{}, servicios:[{id:'x',n:'Diagnóstico',ep:80,qty:1,parts:[],laborHours:0}], denegados:[],
      descuento:0, descTipo:'%', pago:'Cash', estado:'pendiente', abonado:0, nextDate:'', techNotes:'', total:89.2,
      sig1:true, sig2:false, sigData:{sig1:'data:image/png;base64,iVBORw0KGgo='}, sigTimes:{}, fotos:[], terms:null,
      auth1:null, empresa:'', cortesia:false, tecnico:'' };
  });

  // 8) Orden de trabajo (work order) también genera PDF válido + fija _pdfCtx.tipo='orden'
  const wo = await page.evaluate(async () => {
    try { workOrderPDF(); const b=window._pdfBlob; const buf=b?new Uint8Array(await b.arrayBuffer()).slice(0,5):null;
      return { magic: buf?String.fromCharCode.apply(null,buf):'', tipo: window._pdfCtx.tipo, size:b?b.size:0 }; }
    catch(e){ return {err:e.message}; }
  });
  ok(wo.magic==='%PDF-' && wo.tipo==='orden', 'Orden de trabajo: PDF válido + contexto tipo=orden', wo.err||('magic='+wo.magic+' tipo='+wo.tipo));

  // 9) cámara: funciones definidas + maneja falta de cámara sin romper
  const cam = await page.evaluate(() => {
    const fns = ['openCamera','snapPhoto','camUpdateCount','closeCamera'].every(n=>typeof window[n]==='function');
    const ovExists = !!document.getElementById('cam-ov');
    // simula navegador sin cámara
    const md = navigator.mediaDevices; try { Object.defineProperty(navigator,'mediaDevices',{value:undefined,configurable:true}); } catch(e){}
    let threw=false; try { openCamera(); } catch(e){ threw=true; }
    const status = (document.getElementById('cam-status')||{}).textContent||'';
    try { Object.defineProperty(navigator,'mediaDevices',{value:md,configurable:true}); } catch(e){}
    closeCamera();
    return { fns, ovExists, threw, status };
  });
  ok(cam.fns && cam.ovExists && !cam.threw, 'Cámara rápida: funciones + overlay + maneja sin-cámara', 'status="'+cam.status.slice(0,40)+'"');

  // 10) Ver RO en vivo
  const rov = await page.evaluate(() => {
    try { showROView(); const vis=document.getElementById('roview-ov').style.display==='flex';
      const body=document.getElementById('roview-body').textContent||''; closeROView();
      return { vis, hasTotal: body.includes('Total'), hasProg: body.includes('Progreso') }; }
    catch(e){ return {err:e.message}; }
  });
  ok(!rov.err && rov.vis && rov.hasTotal && rov.hasProg, 'RO en vivo: abre con progreso + total', rov.err||JSON.stringify(rov));

  // 11) respaldo: funciones presentes + estado configurable
  const bk = await page.evaluate(() => ({
    fns: ['saveDB','cloudBackup','scheduleCloudBackup','restoreFromCloud','backupCfg','exportBackup','importBackup'].every(n=>typeof window[n]==='function')
  }));
  ok(bk.fns, 'Respaldo: todas las funciones presentes');

  // 12) reExportPDF desde historial NO deja RO corrupto
  const reExp = await page.evaluate(async () => {
    try {
      // guarda una orden real primero
      window.RO = { id:'RO-DIAG9', fecha:new Date().toISOString(), cliente:'Historial Cliente', tel:'787-555-9999',
        vehiculo:{year:'2015',make:'Honda',model:'Civic',tag:'',odoIn:'',odoOut:'',vin:''}, queja:'', insp:{},
        servicios:[{id:'x',n:'Diag',ep:80,qty:1,parts:[],laborHours:0}], denegados:[], descuento:0, descTipo:'%',
        pago:'Cash', estado:'pagado', abonado:0, nextDate:'', techNotes:'', total:89.2, sig1:false, sig2:false,
        sigData:{}, sigTimes:{}, fotos:[], terms:null, auth1:null, empresa:'', cortesia:false };
      const before = { id: window.RO.id, cliente: window.RO.cliente };
      reExportPDF('RO-DIAG9');
      const after = { id: window.RO.id, cliente: window.RO.cliente };
      return { restored: before.id===after.id && before.cliente===after.cliente, ctx: window._pdfCtx };
    } catch(e){ return {err:e.message}; }
  });
  ok(!reExp.err && reExp.restored, 'reExportPDF: restaura RO sin corromperlo', reExp.err||('ctx.id='+(reExp.ctx&&reExp.ctx.id)));

  ok(errors.length===0, 'Sin errores de página en toda la corrida', errors.slice(0,3).join(' | '));

  console.log('\n=== RESUMEN: '+(fail?fail+' FALLOS':'TODO VERDE')+(warn?(' · '+warn+' avisos'):'')+' ===');
  await browser.close();
  process.exit(fail?1:0);
})();
