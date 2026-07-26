// ShopFlow — pruebas de la FUNDACIÓN DE INTEGRIDAD (las 4 reglas de la casa).
// 1. nada se destruye (papelera)  2. todo queda escrito (bitácora)
// 3. saveDB rechaza un guardado que pierda datos  4. hay copias locales para volver atrás
// Además: "cobrar y cerrar" la orden abierta, que es lo que hacía que trabajo cobrado no
// apareciera en ninguna finanza.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8931/index.html';
let fail = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  let respuestas = [];   // cola de respuestas para prompt(); confirm() se acepta siempre
  page.on('pageerror', e => errors.push('pageerror: '+e.message.slice(0,180)));
  page.on('console', m => { if(m.type()==='error' && !/cdn|favicon|Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0,180)); });
  page.on('dialog', async d => {
    dialogs.push(d.type()+': '+d.message().slice(0,110));
    if(d.type()==='prompt'){ const v = respuestas.length?respuestas.shift():''; await d.accept(v).catch(()=>{}); }
    else await d.accept().catch(()=>{});
  });

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(1200);

  // ---------- fixture: una orden real, con fotos y firma ----------
  await page.evaluate(async () => {
    window._mkFoto = () => { const c=document.createElement('canvas'); c.width=c.height=60; const x=c.getContext('2d');
      x.fillStyle='#c00'; x.fillRect(0,0,60,60); return c.toDataURL('image/jpeg',0.7); };
    const f1 = await storePhoto(window._mkFoto());
    const f2 = await storePhoto(window._mkFoto());
    DB.ordenes = [{
      id:'RO-100', fecha:new Date().toISOString(), cliente:'Cliente Prueba', tel:'7875551234',
      vehiculo:{year:'2020',make:'Kia',model:'Forte',tag:'ABC123',vin:'X',odoIn:'1000'},
      fotos:[f1,f2], sigData:{sig2:'data:image/png;base64,AAA'}, sigTimes:{sig2:new Date().toISOString()},
      servicios:[{id:'a1',n:'Aceite',p:100,qty:1,ep:100,parts:[]}], denegados:[], insp:{},
      total:111.50, estado:'pagado', pago:'ATH Móvil', abonado:111.50
    }];
    DB.garage = [{id:'G-100',roId:'RO-100',cliente:'Cliente Prueba',estado:'ready',log:[]}];
    DB.clientes = [{id:'C-100',nombre:'Cliente Prueba',tel:'7875551234'}];
    DB.papelera = []; DB.bitacora = [];
    saveDB({force:true});
  });
  const base = await page.evaluate(() => ({ n:DB.ordenes.length, fotos:censo(DB).fotos, firmas:censo(DB).firmas }));
  ok(base.n===1 && base.fotos===2 && base.firmas===1, 'fixture listo: 1 orden, 2 fotos, 1 firma', JSON.stringify(base));

  // ================= REGLA 3: el guard rechaza pérdidas =================
  // (a) quitar una orden a mano, sin papelera
  const g1 = await page.evaluate(() => {
    DB.ordenes = [];
    const r = saveDB();
    const disco = JSON.parse(localStorage.getItem('sf_v1'));
    return { devolvio:r, enMemoria:DB.ordenes.length, enDisco:disco.ordenes.length };
  });
  ok(g1.devolvio===false, '⭐ el guard BLOQUEA quitar una orden sin pasar por la papelera');
  ok(g1.enDisco===1, 'el disco conserva la orden (no se escribió nada)', 'disco='+g1.enDisco);
  ok(g1.enMemoria===1, '⭐ y deshace el cambio en memoria (la app no queda inservible)', 'memoria='+g1.enMemoria);

  // (b) tras un bloqueo, un guardado legítimo SIGUE funcionando (esto era el fallo de diseño)
  const g2 = await page.evaluate(() => {
    DB.clientes.push({id:'C-101',nombre:'Otro'});
    const r = saveDB();
    return { devolvio:r, disco:(JSON.parse(localStorage.getItem('sf_v1')).clientes||[]).length };
  });
  ok(g2.devolvio===true && g2.disco===2, '⭐ después de un bloqueo se puede seguir trabajando', JSON.stringify(g2));

  // (c) perder fotos de una orden guardada
  const g3 = await page.evaluate(() => {
    DB.ordenes[0].fotos = [];
    const r = saveDB();
    return { devolvio:r, memoria:(DB.ordenes[0].fotos||[]).length,
             disco:(JSON.parse(localStorage.getItem('sf_v1')).ordenes[0].fotos||[]).length };
  });
  ok(g3.devolvio===false && g3.disco===2 && g3.memoria===2, '⭐ el guard BLOQUEA perder fotos de una orden', JSON.stringify(g3));

  // (d) perder la firma del cliente (el respaldo legal)
  const g4 = await page.evaluate(() => {
    delete DB.ordenes[0].sigData;
    const r = saveDB();
    return { devolvio:r, disco:!!JSON.parse(localStorage.getItem('sf_v1')).ordenes[0].sigData };
  });
  ok(g4.devolvio===false && g4.disco===true, '⭐ el guard BLOQUEA perder la firma del cliente', JSON.stringify(g4));

  // (e) quitar una foto A PROPÓSITO sí se permite (baja declarada)
  const g5 = await page.evaluate(() => {
    autorizarBajaFoto('RO-100');
    DB.ordenes[0].fotos.pop();
    const r = saveDB();
    return { devolvio:r, disco:(JSON.parse(localStorage.getItem('sf_v1')).ordenes[0].fotos||[]).length };
  });
  ok(g5.devolvio===true && g5.disco===1, 'quitar una foto a propósito SÍ se permite (no estorba el trabajo)', JSON.stringify(g5));

  // ================= REGLA 1: nada se destruye =================
  // OJO: si el evaluate que dispara un prompt devuelve una promesa, el prompt regresa null.
  // Siempre: un evaluate para la accion, esperar, y otro evaluate para leer.
  respuestas = ['duplicada'];
  await page.evaluate(() => { pedirBorrarRO('RO-100'); });
  await page.waitForTimeout(600);
  const p1 = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const p = (d.papelera||[])[0]||{};
    return { ordenes:d.ordenes.length, pap:(d.papelera||[]).length, id:p.id, fotos:(p.fotos||[]).length,
        firma:!!(p.sigData&&p.sigData.sig2), motivo:p._delMotivo, garageGuardado:(p._garage||[]).length,
        garageActivo:(d.garage||[]).filter(g=>g.roId==='RO-100').length, total:p.total };
  });
  ok(p1.ordenes===0 && p1.pap===1 && p1.id==='RO-100', '⭐ borrar manda el expediente a la PAPELERA, no lo destruye', JSON.stringify({o:p1.ordenes,pap:p1.pap}));
  ok(p1.fotos===1 && p1.firma && p1.total===111.5, 'en la papelera va COMPLETO: fotos, firma y total', p1.fotos+' fotos, firma '+p1.firma);
  ok(p1.motivo==='duplicada', 'el motivo queda guardado', p1.motivo);
  ok(p1.garageActivo===0 && p1.garageGuardado===1, 'el carro sale del garage pero se guarda para poder devolverlo');

  // las fotos NO se borran de IndexedDB al eliminar la orden
  const p2 = await page.evaluate(async () => {
    const f = JSON.parse(localStorage.getItem('sf_v1')).papelera[0].fotos[0];
    const u = await photoResolve(f);
    return !!(u && u.indexOf('data:image')===0);
  });
  ok(p2, '⭐ las fotos del expediente borrado SIGUEN existiendo (no se destruyeron)');

  // purgar antes de 30 días no se permite
  const p3 = await page.evaluate(() => { const r = purgarDePapelera('RO-100');
    return { r, pap:(JSON.parse(localStorage.getItem('sf_v1')).papelera||[]).length }; });
  ok(p3.r===false && p3.pap===1, 'borrar para siempre NO se permite antes de los 30 días', JSON.stringify(p3));

  // restaurar devuelve todo
  const p4 = await page.evaluate(() => {
    restaurarDePapelera('RO-100');
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const o = (d.ordenes||[]).find(x=>x.id==='RO-100')||{};
    return { ordenes:d.ordenes.length, pap:(d.papelera||[]).length, fotos:(o.fotos||[]).length,
             firma:!!(o.sigData&&o.sigData.sig2), total:o.total,
             garage:(d.garage||[]).filter(g=>g.roId==='RO-100').length,
             limpio:!('_delAt' in o) && !('_garage' in o) };
  });
  ok(p4.ordenes===1 && p4.pap===0, '⭐ restaurar devuelve el expediente a la lista activa', JSON.stringify({o:p4.ordenes,pap:p4.pap}));
  ok(p4.fotos===1 && p4.firma && p4.total===111.5 && p4.garage===1, 'vuelve COMPLETO: fotos, firma, total y su carro al garage');
  ok(p4.limpio, 'no quedan marcas internas de la papelera en la orden restaurada');

  // una orden en papelera que reaparece por sincronización se vuelve a quitar
  const p5 = await page.evaluate(() => {
    deleteRO('RO-100','prueba de reconciliación');
    // simula que otro equipo la manda de vuelta (mergeDB une por id)
    DB.ordenes.push(JSON.parse(JSON.stringify(DB.papelera[0])));
    const quitadas = reconciliarPapelera();
    return { quitadas, ordenes:DB.ordenes.length, pap:DB.papelera.length };
  });
  ok(p5.quitadas===1 && p5.ordenes===0, '⭐ un expediente borrado no revive por sincronización', JSON.stringify(p5));
  await page.evaluate(() => { restaurarDePapelera('RO-100'); });

  // ================= REGLA 2: todo queda escrito =================
  const b1 = await page.evaluate(() => {
    const t = (DB.bitacora||[]).map(e=>e.tipo);
    return { total:(DB.bitacora||[]).length, tipos:t,
             tieneBorrado:t.includes('orden-a-papelera'), tieneRestaurado:t.includes('orden-restaurada'),
             tieneBloqueo:t.includes('guardado-bloqueado'),
             conFecha:(DB.bitacora||[]).every(e=>!!e.ts && !!e.dev && !!e.id) };
  });
  ok(b1.tieneBorrado && b1.tieneRestaurado, '⭐ la bitácora anota los borrados y las restauraciones', b1.total+' eventos');
  ok(b1.conFecha, 'cada evento lleva fecha, equipo e id único');

  // el aviso de un guardado bloqueado sobrevive a la recarga (gaveta aparte)
  const b2 = await page.evaluate(() => {
    const antes = JSON.parse(localStorage.getItem('sf_alertas')||'[]').length;
    DB.ordenes = []; saveDB();
    return { antes, despues: JSON.parse(localStorage.getItem('sf_alertas')||'[]').length };
  });
  ok(b2.despues > b2.antes, '⭐ el bloqueo queda escrito fuera de sf_v1 (sobrevive la recarga)', JSON.stringify(b2));
  await page.reload({ waitUntil:'load' }); await page.waitForTimeout(1500);
  const b3 = await page.evaluate(() => ({
    recogido:(DB.bitacora||[]).some(e=>e.tipo==='guardado-bloqueado'),
    gavetaVacia:JSON.parse(localStorage.getItem('sf_alertas')||'[]').length===0,
    ordenes:DB.ordenes.length }));
  ok(b3.recogido && b3.gavetaVacia, 'al arrancar, el aviso pasa a la bitácora y la gaveta se limpia');
  ok(b3.ordenes===1, 'y la orden sigue ahí después de recargar', 'ordenes='+b3.ordenes);

  // ================= REGLA 4: copias locales =================
  const s1 = await page.evaluate(async () => {
    await snapGuardar();
    const l = await snapList();
    return { n:l.length, primera:l[0]?{n:l[0].n,fotos:l[0].fotos,firmas:l[0].firmas,tieneData:!!l[0].data}:null };
  });
  ok(s1.n>=1 && s1.primera && s1.primera.n===1, '⭐ se guarda una copia local en IndexedDB', JSON.stringify(s1.primera));
  ok(s1.primera && !!s1.primera.tieneData, 'la copia lleva los datos completos para poder volver');

  // volver a una copia anterior: se hace un cambio, se vuelve atrás, y el cambio desaparece
  const conCambio = await page.evaluate(async () => {
    const l0 = await snapList();
    window._idViejo = l0[0].id;
    DB.clientes.push({id:'C-999',nombre:'Añadido después de la copia'});
    saveDB();
    return DB.clientes.length;
  });
  await page.evaluate(() => { restaurarSnapshot(window._idViejo); });
  await page.waitForTimeout(1200);
  const s2 = await page.evaluate(() => ({ conCambio:null, ahora:DB.clientes.length,
      hayC999:(DB.clientes||[]).some(c=>c.id==='C-999') }));
  s2.conCambio = conCambio;
  ok(s2.ahora === s2.conCambio-1 && !s2.hayC999, '⭐ volver a una copia deshace lo hecho después', JSON.stringify(s2));
  const s3 = await page.evaluate(async () => (await snapList()).length);
  ok(s3>=2, 'antes de volver atrás guarda copia del estado actual (también se puede deshacer)', s3+' copias');

  // los secretos del equipo no viajan en las copias
  const s4 = await page.evaluate(async () => {
    DB.settings.aiKey='sk-secreto'; DB.settings.backup={repo:'r',token:'t'}; saveDB();
    await snapGuardar();
    const l = await snapList();
    return { ai:!!(l[0].data.settings||{}).aiKey, bk:!!(l[0].data.settings||{}).backup,
             sigueEnLaApp:!!DB.settings.aiKey };
  });
  ok(!s4.ai && !s4.bk && s4.sigueEnLaApp, 'las copias NO guardan la key de IA ni el token', JSON.stringify(s4));

  // ================= COBRAR Y CERRAR =================
  await page.evaluate(() => {
    DB.ordenes=[{ id:'RO-200', fecha:new Date().toISOString(), cliente:'Abierta Prueba', tel:'7875550000',
      vehiculo:{year:'2019',make:'Honda',model:'Civic',tag:'XYZ'}, fotos:[], servicios:[{id:'a1',n:'Frenos',p:200,qty:1,ep:200,parts:[]}],
      denegados:[], insp:{}, total:200, estado:'abierta' }];
    DB.garage=[{id:'G-200',roId:'RO-200',cliente:'Abierta Prueba',estado:'working',log:[]}];
    saveDB({force:true});
  });
  // una orden ABIERTA no cuenta en las ventas: eso era el problema de dinero
  const f0 = await page.evaluate(() => {
    const hoy = DB.ordenes.filter(o=>new Date(o.fecha).toDateString()===new Date().toDateString());
    return { cuentaAbierta: hoy.reduce((s,o)=>s+(o.estado==='abierta'?0:(o.total||0)),0) };
  });
  ok(f0.cuentaAbierta===0, 'una orden ABIERTA no suma en las ventas del día (el problema a resolver)');

  respuestas = ['ATH Móvil','200'];
  await page.evaluate(() => { cobrarYCerrar('RO-200'); });
  await page.waitForTimeout(700);
  const c1 = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const o = d.ordenes.find(x=>x.id==='RO-200');
    const g = (d.garage||[]).find(x=>x.roId==='RO-200');
    const hoy = d.ordenes.filter(x=>new Date(x.fecha).toDateString()===new Date().toDateString());
    return { estado:o.estado, pago:o.pago, abonado:o.abonado, pagadoFecha:!!o.pagadoFecha,
               garage:g&&g.estado, ventas:hoy.reduce((s,x)=>s+(x.estado==='abierta'?0:(x.total||0)),0) };
  });
  ok(c1.estado==='pagado' && c1.abonado===200 && c1.pagadoFecha, '⭐ "cobrar y cerrar" cierra la orden abierta como PAGADA', JSON.stringify({e:c1.estado,ab:c1.abonado}));
  ok(c1.pago==='ATH Móvil', 'guarda el método de pago', c1.pago);
  ok(c1.ventas===200, '⭐ y AHORA SÍ cuenta en las ventas del día', '$'+c1.ventas);
  ok(c1.garage==='entregado' || c1.garage==='ready', 'el carro se movió en el garage', c1.garage);

  // pago parcial → queda pendiente con balance
  await page.evaluate(() => {
    DB.ordenes=[{ id:'RO-300', fecha:new Date().toISOString(), cliente:'Abono Prueba', tel:'',
      vehiculo:{}, fotos:[], servicios:[{id:'a1',n:'X',p:100,qty:1,ep:100,parts:[]}], denegados:[], insp:{},
      total:100, estado:'abierta' }];
    DB.garage=[]; saveDB({force:true});
  });
  respuestas = ['Cash','40'];
  await page.evaluate(() => { cobrarYCerrar('RO-300'); });
  await page.waitForTimeout(700);
  const c2 = await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('sf_v1')).ordenes.find(x=>x.id==='RO-300');
    return { estado:o.estado, abonado:o.abonado, balance:(o.total||0)-(o.abonado||0) };
  });
  ok(c2.estado==='pendiente' && c2.abonado===40 && c2.balance===60, '⭐ un abono parcial deja la orden PENDIENTE con su balance', JSON.stringify(c2));

  // un monto que no se entiende no cambia nada
  await page.evaluate(() => { DB.ordenes[0].estado='abierta'; DB.ordenes[0].abonado=0; saveDB({force:true}); });
  respuestas = ['Cash','abc'];
  await page.evaluate(() => { cobrarYCerrar('RO-300'); });
  await page.waitForTimeout(600);
  const c3 = await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('sf_v1')).ordenes.find(x=>x.id==='RO-300');
    return { estado:o.estado, abonado:o.abonado };
  });
  ok(c3.estado==='abierta' && c3.abonado===0, 'un monto que no se entiende no cambia nada', JSON.stringify(c3));

  // ================= AVISO DE ÓRDENES ABIERTAS EN EL HOME =================
  const h1 = await page.evaluate(() => {
    go('home'); renderAbiertas();
    const el = document.getElementById('home-abiertas');
    return { visible: el.style.display!=='none', texto: el.innerText.slice(0,160) };
  });
  ok(h1.visible && /abierta/i.test(h1.texto), 'el home avisa de las órdenes abiertas sin cobrar', h1.texto.split('\n')[0]);

  // ================= mergeDB lleva papelera y bitácora entre equipos =================
  const m1 = await page.evaluate(() => {
    const local = { ordenes:[{id:'A',fotos:[]}], papelera:[{id:'P1',_delAt:'2026-07-01'}],
                    bitacora:[{id:'e1',ts:'2026-07-01T00:00:00Z',tipo:'x'}], settings:{} };
    const remoto = { ordenes:[{id:'B',fotos:[]}], papelera:[{id:'P2',_delAt:'2026-07-02'}],
                     bitacora:[{id:'e2',ts:'2026-07-02T00:00:00Z',tipo:'y'},{id:'e1',ts:'2026-07-01T00:00:00Z',tipo:'x'}], settings:{} };
    const out = mergeDB(local, remoto);
    return { ordenes:out.ordenes.length, pap:(out.papelera||[]).map(p=>p.id).sort().join(','),
             bita:(out.bitacora||[]).map(e=>e.id).join(','), sinDuplicados:(out.bitacora||[]).length===2 };
  });
  ok(m1.ordenes===2 && m1.pap==='P1,P2', '⭐ al sincronizar, la papelera de los dos equipos se une', JSON.stringify(m1));
  ok(m1.sinDuplicados && m1.bita==='e1,e2', 'la bitácora se une por fecha y sin duplicados', m1.bita);

  // ================= la verificación de verdad =================
  const v1 = await page.evaluate(() => {
    DB.ordenes=[{id:'RO-400',fotos:[{id:'ph-x',t:'now'},{id:'ph-y',t:'now',sp:'uid/ph-y.jpg'}],sigData:{},servicios:[],denegados:[],insp:{},total:0,estado:'pagado',fecha:new Date().toISOString()}];
    saveDB({force:true});
    return { sinSubir: fotosSinSubir() };
  });
  ok(v1.sinSubir===1, 'cuenta bien las fotos que viven solo en este equipo', v1.sinSubir+' sin subir');

  ok(errors.length===0, 'cero errores de página en toda la corrida', errors.slice(0,3).join(' | '));

  await browser.close();
  console.log(fail ? `\n${fail} FALLO(S)` : '\n=== FUNDACIÓN: TODO VERDE ===');
  process.exit(fail?1:0);
})();
