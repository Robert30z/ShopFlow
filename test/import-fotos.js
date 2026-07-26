// ShopFlow — prueba de IMPORTAR un respaldo con fotos base64 inline (el rescate del 07-26).
// El bug: importBackup hacía saveDB() con las fotos inline -> 4.6MB a localStorage -> "ALMACENAMIENTO
// LLENO" en Safari (~5MB) y el import fallaba. Ahora migra a IndexedDB ANTES de guardar.
// Verifica: import de un respaldo pesado entra completo, localStorage queda chiquito, las fotos
// viven en IDB y se pueden volver a ver, y los secretos del equipo (token de respaldo) sobreviven.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'http://localhost:8931/index.html';
let fail = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };

// Construye un respaldo realista: 1 orden con N fotos base64 inline de ~130KB cada una.
function makeHeavyBackup(nFotos){
  const blob = 'data:image/jpeg;base64,' + Buffer.from('J'.repeat(98000)).toString('base64'); // ~130KB
  const fotos = [];
  for(let i=0;i<nFotos;i++) fotos.push({ d: blob, t: '2026-07-24T13:5'+(i%10)+':00.000Z' });
  return {
    ordenes: [{
      id:'RO-2', fecha:'2026-07-24T13:50:06.825Z', cliente:'Migdalia Cotto', tel:'782334043', email:'',
      vehiculo:{ anio:'2020', marca:'Kia', modelo:'Forte', tablilla:'JLJ712', vin:'', color:'', millaje:'' },
      queja:'ACEITE BASICO', fotos:fotos, sig1:false, sig2:true, sigDen:false,
      sigData:{ sig2:'data:image/png;base64,'+Buffer.from('S'.repeat(400)).toString('base64') },
      sigTimes:{ sig2:'2026-07-24T14:00:00.000Z' }, terms:{v:3,fecha:'2026-07-03',text:'...'},
      auth1:null, insp:{}, servicios:[{nombre:'Cambio de aceite',precio:88.2,laborHours:0.5,parts:[]}],
      denegados:[{nombre:'Goma 1',precio:100},{nombre:'Goma 2',precio:100},{nombre:'Goma 3',precio:100},{nombre:'Goma 4',precio:100}],
      descuento:11, descTipo:'%', descMotivo:'', cortesia:false, cortesiaMotivo:'', empresa:'',
      pago:'ATH Móvil', estado:'pagado', nextDate:'2026-12-24', techNotes:'', total:88.2,
      descValor:9.78, cortesiaValor:0, inspGeneral:'UNIDAD REQUIERE 4 GOMAS', abonado:88.2,
      pagadoFecha:'2026-07-26T16:24:15.678519'
    }],
    clientes:[{ id:'C-1', nombre:'Migdalia Cotto', tel:'782334043', carros:[] }],
    garage:[{ id:'G-1', roId:'RO-2', cliente:'Migdalia Cotto', estado:'ready' }],
    gastos:[], suplidores:[], ordenesS:[], inventario:[], serviceParts:{}, citas:[], roCounter:2,
    settings:{ laborRate:103, shopName:'Pit Stop', shopPhone:'7874546513', shopAddress:'Bayamón, PR' },
    svcsCustom:[], catsCustom:[], tecnicos:[], tecCounter:0, asesores:[], aseCounter:0, jobsCustom:[], promos:[]
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0,200)));
  page.on('console', msg => { if(msg.type()==='error' && !/cdn|favicon|Failed to load resource/i.test(msg.text())) errors.push(msg.text().slice(0,160)); });
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message().slice(0,120)); await d.accept().catch(()=>{}); });

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(1000);

  // Escribe el respaldo pesado a un archivo temporal para el <input type=file> real
  const backup = makeHeavyBackup(35);
  const tmp = path.join(__dirname, '_tmp-rescate.json');
  fs.writeFileSync(tmp, JSON.stringify(backup));
  const mb = (fs.statSync(tmp).size/1048576).toFixed(2);
  ok(fs.statSync(tmp).size > 4*1048576, 'el respaldo de prueba es pesado de verdad', mb+' MB (como el rescate real)');

  // Simula un equipo que YA tiene el respaldo configurado (para probar que no se apaga)
  await page.evaluate(() => {
    DB.settings = DB.settings||{};
    DB.settings.backup = { repo:'Robert30z/shopflow-backup', token:'ghp_tokenDePrueba' };
    DB.settings.aiKey = 'sk-ant-pruebaAI';
    saveDB();
  });

  // 1) Importar: el input real dispara importBackup
  const input = page.locator('#import-file');
  ok(await input.count() > 0, 'existe el input de importar respaldo');
  await input.setInputFiles(tmp);
  await page.waitForTimeout(4000); // migración a IDB + saveDB + alert

  // 2) La orden entró completa
  const st = await page.evaluate(() => {
    const o = (DB.ordenes||[]).find(x => x.id==='RO-2');
    return {
      nOrdenes:(DB.ordenes||[]).length, nClientes:(DB.clientes||[]).length,
      cliente:o&&o.cliente, total:o&&o.total, estado:o&&o.estado, pago:o&&o.pago, abonado:o&&o.abonado,
      tablilla:o&&o.vehiculo&&o.vehiculo.tablilla, nFotos:o?(o.fotos||[]).length:0,
      denegados:o?(o.denegados||[]).length:0, firma:!!(o&&o.sigData&&o.sigData.sig2),
      garage:(DB.garage||[]).length, garageEstado:(DB.garage||[])[0]&&DB.garage[0].estado,
      // ¿quedaron refs (bien) o base64 inline (mal)?
      refs:o?(o.fotos||[]).filter(f=>f&&f.id&&!f.d).length:0,
      inline:o?(o.fotos||[]).filter(f=>(typeof f==='string')||(f&&f.d&&!f.id)).length:0,
      lsBytes:(localStorage.getItem('sf_v1')||'').length,
      token:(DB.settings.backup||{}).token, aiKey:DB.settings.aiKey
    };
  });

  ok(st.nOrdenes===1 && st.cliente==='Migdalia Cotto', 'la orden de Migdalia entró', st.cliente+' / '+st.nOrdenes+' orden');
  ok(st.total===88.2 && st.estado==='pagado' && st.abonado===88.2, 'cobrada completa y marcada pagada', '$'+st.total+' abonado $'+st.abonado);
  ok(/ATH/.test(st.pago||''), 'método de pago = ATH Móvil', st.pago);
  ok(st.tablilla==='JLJ712', 'el vehículo/tablilla sobrevive', st.tablilla);
  ok(st.garage===1 && st.garageEstado==='ready', 'el carro queda en el garage como listo', st.garageEstado);
  ok(st.denegados===4 && st.firma, 'denegados + firma del cliente intactos', st.denegados+' denegados, firma sí');
  ok(st.nFotos===35, 'las 35 fotos siguen en la orden', st.nFotos+' fotos');

  // 3) EL FIX: nada de base64 en localStorage
  ok(st.refs===35 && st.inline===0, 'las 35 fotos quedaron como REF (0 inline)', 'refs='+st.refs+' inline='+st.inline);
  ok(st.lsBytes < 300*1024, 'localStorage quedó chiquito (no revienta la cuota)', (st.lsBytes/1024).toFixed(1)+' KB (antes: '+mb+' MB)');

  // 4) Los secretos del equipo NO se apagaron al importar
  ok(st.token==='ghp_tokenDePrueba', 'el token de respaldo sobrevive al import', st.token);
  ok(st.aiKey==='sk-ant-pruebaAI', 'la key de IA sobrevive al import');

  // 5) Las fotos se pueden VOLVER A VER (round-trip desde IndexedDB)
  const back = await page.evaluate(async () => {
    const o = DB.ordenes.find(x=>x.id==='RO-2');
    const url = await photoResolve(o.fotos[0]);
    const url2 = await photoResolve(o.fotos[34]);
    return { ok1:!!(url&&url.indexOf('data:image')===0), len1:url?url.length:0,
             ok2:!!(url2&&url2.indexOf('data:image')===0) };
  });
  ok(back.ok1 && back.ok2, 'las fotos se recuperan desde IndexedDB (primera y última)', 'foto 1 = '+back.len1+' chars');

  // 6) Sobrevive una recarga (IDB es persistente, no memoria)
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(1800);
  const after = await page.evaluate(async () => {
    const o = (DB.ordenes||[]).find(x=>x.id==='RO-2');
    if(!o) return { gone:true };
    const url = await photoResolve(o.fotos[0]);
    return { cliente:o.cliente, nFotos:(o.fotos||[]).length, foto:!!(url&&url.indexOf('data:image')===0),
             lsBytes:(localStorage.getItem('sf_v1')||'').length };
  });
  ok(!after.gone && after.cliente==='Migdalia Cotto' && after.nFotos===35, 'tras recargar, la orden y sus fotos siguen ahí');
  ok(after.foto, 'tras recargar, la foto todavía se ve (IDB persistió)');
  ok(after.lsBytes < 300*1024, 'localStorage sigue chiquito tras recargar', (after.lsBytes/1024).toFixed(1)+' KB');

  // 7) El aviso de "sin respaldar" no debe quedarse rojo con el token puesto
  ok(dialogs.some(m => /import/i.test(m)), 'el import confirma al usuario', dialogs.filter(m=>/import/i.test(m))[0]||'');

  // 8) Un respaldo MALFORMADO (campo objeto donde va lista) no debe tumbar la app
  const bad = makeHeavyBackup(1);
  bad.svcsCustom = {}; bad.promos = {}; bad.ordenes = null; bad.roCounter = 'x'; bad.serviceParts = [];
  const tmpBad = path.join(__dirname, '_tmp-malo.json');
  fs.writeFileSync(tmpBad, JSON.stringify(bad));
  const errBefore = errors.length;
  await page.locator('#import-file').setInputFiles(tmpBad);
  await page.waitForTimeout(2500);
  const norm = await page.evaluate(() => {
    try{ renderCatalogAdmin(); go('ajustes'); go('home'); }catch(e){ return { threw:e.message }; }
    return { ordenes:Array.isArray(DB.ordenes), svcs:Array.isArray(DB.svcsCustom),
             promos:Array.isArray(DB.promos), sp:(DB.serviceParts&&!Array.isArray(DB.serviceParts)),
             counter:typeof DB.roCounter };
  });
  ok(!norm.threw && norm.ordenes && norm.svcs && norm.promos && norm.sp && norm.counter==='number',
     'un respaldo malformado se normaliza y no tumba la app', JSON.stringify(norm));
  ok(errors.length===errBefore, 'importar el malformado no generó errores de página', errors.slice(errBefore,errBefore+2).join(' | '));
  fs.unlinkSync(tmpBad);

  ok(errors.length===0, 'cero errores de página', errors.slice(0,3).join(' | '));

  fs.unlinkSync(tmp);
  await browser.close();
  console.log(fail ? `\n${fail} FALLO(S)` : '\nTODO VERDE');
  process.exit(fail ? 1 : 0);
})();
