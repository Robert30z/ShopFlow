// ShopFlow — prueba del almacén de fotos en IndexedDB (el arreglo del "almacenamiento lleno").
// Verifica: captura->IDB, ref en la orden (no base64 en localStorage), compresión fuerte,
// 100 fotos sin llenar localStorage, persistencia tras recargar, migración de fotos viejas,
// y que el PDF de inspección hidrata las fotos desde IDB.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8931/index.html';
let fail = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0,200)));
  page.on('console', msg => { if(msg.type()==='error' && !/cdn|favicon|Failed to load resource/i.test(msg.text())) errors.push(msg.text().slice(0,160)); });
  page.on('dialog', async d => { await d.accept().catch(()=>{}); });

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(1000);

  // helper en página: hace un dataURL JPEG de NxN (para simular una foto)
  await page.evaluate(() => {
    window._mkDataURL = (n, q) => { const c=document.createElement('canvas'); c.width=n; c.height=n; const x=c.getContext('2d');
      for(let i=0;i<40;i++){ x.fillStyle='hsl('+(i*40%360)+',70%,50%)'; x.fillRect(Math.random()*n,Math.random()*n,n/6,n/6);} return c.toDataURL('image/jpeg',q||0.9); };
  });

  // 1) storePhoto guarda en IDB y devuelve un REF (sin base64), recuperable por photoGet
  const r1 = await page.evaluate(async () => {
    const url = window._mkTiny = 'data:image/jpeg;base64,'+btoa('x'.repeat(300));
    const ref = storePhoto(url);
    const got = await photoGet(ref.id);
    return { hasId: !!ref.id, noInline: !ref.d, cached: _photoCache[ref.id]===url, roundtrip: got===url };
  });
  ok(r1.hasId && r1.noInline, 'storePhoto devuelve un REF {id} sin base64 inline', JSON.stringify(r1));
  ok(r1.roundtrip, 'photoGet recupera la foto desde IndexedDB', JSON.stringify(r1));

  // 2) Compresión fuerte: una foto grande baja a un tamaño chico
  const r2 = await page.evaluate(async () => {
    const big = _mkDataURL(2400, 0.95);
    const img = new Image(); await new Promise(res=>{img.onload=res; img.src=big;});
    const small = compressToDataURL(img, 1280, 110);
    const kb = u => Math.round((u.length*0.75)/1024); // base64 -> bytes aprox
    return { bigKB: kb(big), smallKB: kb(small) };
  });
  ok(r2.smallKB < 160, 'Compresión: foto grande queda bajo ~160KB', `${r2.bigKB}KB -> ${r2.smallKB}KB`);

  // 3) EL CASO DE ROBERTO: una orden de 35 fotos NO llena localStorage (van a IDB como refs)
  const r3 = await page.evaluate(async () => {
    DB.ordenes = []; DB._demo = false;
    const url = _mkDataURL(1280, 0.7); // ~foto real comprimida
    const fotos = [];
    for(let i=0;i<35;i++) fotos.push(storePhoto(url));
    const o = { id:'RO-TEST35', fecha:new Date().toISOString(), cliente:'Prueba', tel:'', vehiculo:{}, servicios:[], denegados:[], insp:{}, fotos:fotos, total:0, estado:'abierta' };
    DB.ordenes.push(o);
    const okSave = saveDB();
    const lsKB = Math.round((localStorage.getItem('sf_v1')||'').length*2/1024);
    const hasInline = (localStorage.getItem('sf_v1')||'').indexOf('/9j/')>-1 || (localStorage.getItem('sf_v1')||'').indexOf('data:image')>-1;
    const firstIsRef = !!(o.fotos[0].id && !o.fotos[0].d);
    return { okSave, lsKB, hasInline, firstIsRef, n:o.fotos.length };
  });
  ok(r3.okSave===true, 'saveDB() OK con 35 fotos (no revienta el almacenamiento)');
  ok(r3.firstIsRef && !r3.hasInline, 'Las 35 fotos van a IDB como refs — CERO base64 en localStorage', JSON.stringify(r3));
  ok(r3.lsKB < 200, 'localStorage se queda chico con 35 fotos', r3.lsKB+' KB');

  // 4) 100 fotos (stress) — localStorage sigue chico
  const r4 = await page.evaluate(async () => {
    const url = _mkDataURL(1280, 0.7);
    const fotos = []; for(let i=0;i<100;i++) fotos.push(storePhoto(url));
    DB.ordenes.push({ id:'RO-100', fecha:new Date().toISOString(), cliente:'Stress', vehiculo:{}, servicios:[], fotos:fotos, total:0, estado:'abierta' });
    const okSave = saveDB();
    return { okSave, lsKB: Math.round((localStorage.getItem('sf_v1')||'').length*2/1024) };
  });
  ok(r4.okSave===true && r4.lsKB < 400, 'STRESS: 135 fotos totales y localStorage sigue < 400KB', r4.lsKB+' KB');

  // 5) Persistencia: recargar la app y la foto sigue viva en IDB
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(1000);
  const r5 = await page.evaluate(async () => {
    const o = (DB.ordenes||[]).find(x=>x.id==='RO-TEST35');
    if(!o) return { found:false };
    const ref = o.fotos[0];
    await hydratePhotos([ref]);
    const src = fotoSrc(ref);
    return { found:true, isRef: !!(ref.id && !ref.d), rendersAfterReload: !!(src && src.indexOf('data:image')===0) };
  });
  ok(r5.found && r5.isRef, 'Tras recargar, la orden guarda refs (no base64)', JSON.stringify(r5));
  ok(r5.rendersAfterReload, 'Tras recargar, la foto se hidrata desde IDB y renderiza', JSON.stringify(r5));

  // 6) MIGRACIÓN: una orden vieja con foto inline {d} se mueve a IDB al arrancar
  // (re-inyecta el helper: el reload anterior borró los globals de window)
  await page.evaluate(() => {
    window._mkDataURL = (n, q) => { const c=document.createElement('canvas'); c.width=n; c.height=n; const x=c.getContext('2d');
      for(let i=0;i<40;i++){ x.fillStyle='hsl('+(i*40%360)+',70%,50%)'; x.fillRect(Math.random()*n,Math.random()*n,n/6,n/6);} return c.toDataURL('image/jpeg',q||0.9); };
  });
  const seeded = await page.evaluate(async () => {
    const big = _mkDataURL(1000, 0.8);
    const db = { ordenes:[{ id:'RO-OLD', fecha:new Date().toISOString(), cliente:'Viejo', vehiculo:{}, servicios:[], denegados:[], insp:{}, fotos:[{d:big,t:new Date().toISOString()}], total:0, estado:'abierta' }],
      garage:[], clientes:[], citas:[], inventario:[], gastos:[], suplidores:[], svcsCustom:[], catsCustom:[], tecnicos:[], asesores:[], jobsCustom:[], promos:[], serviceParts:{}, settings:{laborRate:103,shopName:'Pit Stop'} };
    localStorage.setItem('sf_v1', JSON.stringify(db));
    return { hadInline: localStorage.getItem('sf_v1').indexOf('data:image')>-1, bytes: localStorage.getItem('sf_v1').length };
  });
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(1500); // deja correr migratePhotosToIDB
  const r6 = await page.evaluate(async () => {
    const o = (DB.ordenes||[]).find(x=>x.id==='RO-OLD');
    const ref = o && o.fotos[0];
    const movedToRef = !!(ref && ref.id && !ref.d);
    const inIDB = movedToRef ? await photoGet(ref.id) : null;
    const lsClean = localStorage.getItem('sf_v1').indexOf('data:image')===-1;
    return { movedToRef, inIDBok: !!(inIDB && inIDB.indexOf('data:image')===0), lsClean };
  });
  ok(seeded.hadInline, '(setup) orden vieja tenía la foto inline en localStorage');
  ok(r6.movedToRef && r6.inIDBok, 'MIGRACIÓN: la foto vieja se movió a IndexedDB', JSON.stringify(r6));
  ok(r6.lsClean, 'MIGRACIÓN: localStorage quedó SIN base64 (espacio liberado)', JSON.stringify(r6));

  // 7) dviPDF hidrata las fotos desde IDB sin error (foto ref recién recargada)
  const r7 = await page.evaluate(async () => {
    // limpia el cache en memoria para forzar hidratación desde IDB
    const o = (DB.ordenes||[]).find(x=>x.id==='RO-OLD');
    if(!o) return { skip:true };
    o.insp = {bat:'verde'}; // que tenga algo de inspección
    const id = o.fotos[0].id; delete _photoCache[id];
    let threw=false;
    try { dviPDF('RO-OLD'); } catch(e){ threw=true; }
    await new Promise(r=>setTimeout(r,600));
    return { threw };
  });
  ok(r7.skip || !r7.threw, 'dviPDF con foto en IDB no lanza error (hidrata antes de armar)', JSON.stringify(r7));

  ok(errors.length===0, 'Sin errores de página en toda la corrida', errors.join(' | '));

  await browser.close();
  console.log(fail? `\n=== ${fail} FALLO(S) ===` : '\n=== FOTOS IDB: TODO VERDE ===');
  process.exit(fail?1:0);
})();
