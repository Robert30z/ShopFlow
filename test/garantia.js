// LA GARANTÍA DE LA PIEZA — el caso real del 28-jul.
// ---------------------------------------------------------------------------
// Roberto le vendió y le instaló una batería a una clienta. La batería trae 5 años de
// garantía DEL FABRICANTE, pero a través de él (él la compró y la revendió). Preguntó dos cosas:
//   1. Si en 3 años la batería falla, ¿puede encontrar el # de invoice que entró?
//   2. ¿Cómo pone en la factura que un trabajo fue por garantía?
// Antes de este batch: (1) el dato se guardaba pero el buscador NO llegaba a las piezas —
// buscar el invoice daba CERO; (2) no existía "garantía", solo "cortesía", que contablemente
// es otra cosa (regalo vs costo de calidad) y le ensuciaba las finanzas.
// Usage:  python -m http.server 8931  (raíz del repo) + node garantia.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');
const money = t => Number(String(t || '').replace(/[^0-9.\-]/g, '')) || 0;

let cola = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => {
    const r = cola.length ? cola.shift() : null;
    if (d.type() === 'prompt') await d.accept(r === null ? '' : String(r));
    else if (r === false) await d.dismiss();
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const irHome = async () => {
    for (let i = 0; i < 4; i++) {
      if (await page.locator('#home.v').count()) break;
      const b = page.locator('.tb-back:visible').first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(300); } else break;
    }
    await page.waitForTimeout(200);
  };

  // ================= LA VENTA DE HOY: batería con 5 años =================
  await page.click('#home .mc');
  await page.waitForTimeout(400);
  await page.fill('#c-n', 'Carmen Rivera');
  await page.fill('#c-t', '787-555-3344');
  await page.fill('#v-y', '2016');
  await page.fill('#v-ma', 'Toyota');
  await page.fill('#v-mo', 'Corolla');
  await page.fill('#v-t', 'IAB-330');
  await page.click('#ro-next'); await page.waitForTimeout(250);
  await page.click('#ro-next'); await page.waitForTimeout(250);
  cola = ['Cambio de batería', '45'];
  await page.click('#pan-2 button:has-text("Servicio manual")');
  await page.waitForTimeout(400);

  // La pieza, por el formulario de verdad (modal de piezas del servicio)
  await page.click('#pan-2 button:has-text("Agregar piezas")');
  await page.waitForTimeout(500);
  await page.fill('#pp-name', 'Batería Duralast Gold 35-DLG');
  await page.fill('#pp-num', '35-DLG');
  await page.fill('#pp-sup', 'AutoZone Bayamón');
  await page.fill('#pp-cost', '129.99');
  await page.fill('#pp-sell', '185');
  await page.fill('#pp-receipt', 'ADV-789012');
  await page.fill('#pp-date', '2026-07-28');
  await page.selectOption('#pp-warr', '60');            // 5 años
  await page.waitForTimeout(300);

  const vence = await ev(page, `return (document.getElementById('pp-warr-hasta')||{}).value;`);
  yes('Al escoger "5 años" la app enseña HASTA CUÁNDO cubre', /2031/.test(vence || ''), vence);

  await page.click('#parts-modal button:has-text("Agregar pieza"), #parts-modal .btn.p');
  await page.waitForTimeout(600);
  const guardada = await ev(page, `
    var p=((RO.servicios[0]||{}).parts||[])[0]||{};
    return { name:p.name, receipt:p.receipt, meses:p.warrantyMonths, hasta:garantiaHasta(p), viva:garantiaVigente(p) };`);
  is('La pieza guarda el invoice y los meses de garantía', { r: guardada.receipt, m: guardada.meses }, { r: 'ADV-789012', m: 60 });
  is('Y calcula sola el vencimiento (28-jul-2026 + 60 meses)', guardada.hasta, '2031-07-28');
  yes('La garantía está vigente hoy', guardada.viva);

  await page.click('#parts-modal button[onclick="closePartsModal()"]');
  await page.waitForTimeout(400);

  // Cerrar la orden y cobrarla normal
  for (let i = 0; i < 6; i++) { await page.click('#ro-next'); await page.waitForTimeout(250); }
  await ev(page, `var s=document.getElementById('est-estado');if(s){s.value='pagado';s.dispatchEvent(new Event('change'));}return 1;`);
  await page.waitForTimeout(200);
  cola = [];
  await page.click('#pan-8 button:has-text("Guardar orden completa")');
  await page.waitForTimeout(900);
  const venta = await ev(page, `var o=DB.ordenes[0];return { id:o.id, total:o.total, estado:o.estado };`);
  yes('La venta se cobra normal (la garantía no la hace gratis)', venta.total > 200, venta);
  const roVenta = venta.id;

  // ================= PREGUNTA 1: ¿la encuentro en 3 años? =================
  await irHome();
  await ev(page, `go('ordenes');renderOrdenes();return 1;`);
  await page.waitForTimeout(400);
  const buscar = async q => {
    await page.fill('#ord-q', q);
    await page.waitForTimeout(400);
    return ev(page, `return { n:(document.getElementById('ordenes-body')||{}).querySelectorAll('.ro-card, [onclick^="openRODetail"]').length,
      txt:((document.getElementById('ord-ct')||{}).textContent||'') };`);
  };
  is('Buscando el # de INVOICE del suplidor sale la orden', (await buscar('ADV-789012')).txt, '1 ord.');
  is('Buscando el nombre de la pieza también', (await buscar('duralast')).txt, '1 ord.');
  is('Y buscando el # de parte', (await buscar('35-DLG')).txt, '1 ord.');
  is('Y por el suplidor (todas las de AutoZone)', (await buscar('autozone')).txt, '1 ord.');
  is('Lo que no existe sigue sin salir', (await buscar('bateria optima')).txt, '0 ord.');
  await page.fill('#ord-q', '');
  await page.waitForTimeout(300);

  // ================= PREGUNTA 2: marcar el reclamo como GARANTÍA =================
  // 3 años después la batería falla: se hace una orden nueva, sin cobrar, amarrada a la original.
  await irHome();
  await page.click('#home .mc');
  await page.waitForTimeout(400);
  await page.fill('#c-n', 'Carmen Rivera');
  await page.waitForTimeout(400);
  await page.fill('#v-y', '2016');
  await page.fill('#v-ma', 'Toyota');
  await page.fill('#v-mo', 'Corolla');
  await page.fill('#v-t', 'IAB-330');
  await page.click('#ro-next'); await page.waitForTimeout(250);
  await page.click('#ro-next'); await page.waitForTimeout(250);
  cola = ['Reemplazo de batería por garantía', '45'];
  await page.click('#pan-2 button:has-text("Servicio manual")');
  await page.waitForTimeout(300);
  await page.click('#ro-next');   // → estimado
  await page.waitForTimeout(500);

  const antes = await ev(page, `return { tot:(document.getElementById('est-tot')||{}).textContent };`);
  yes('Sin marcar nada, el estimado cobra normal', money(antes.tot) > 0, antes.tot);

  await page.check('#est-gar');
  await page.waitForTimeout(400);
  const opciones = await ev(page, `
    var s=document.getElementById('est-gar-ro');
    return { n:s.options.length, txt:Array.prototype.map.call(s.options,function(o){return o.text;}) };`);
  yes('Ofrece la orden anterior de ESA clienta para amarrar la garantía',
      opciones.txt.some(t => t.indexOf(roVenta) >= 0), opciones.txt);

  await page.selectOption('#est-gar-ro', roVenta);
  await page.fill('#est-gar-m', 'Batería Duralast 35-DLG, invoice ADV-789012 — falló dentro de los 5 años');
  await page.waitForTimeout(400);
  const conGar = await ev(page, `return { tot:(document.getElementById('est-tot')||{}).textContent,
    ivu:(document.getElementById('est-ivu')||{}).textContent, roTot:RO.total, gar:RO.garantia, cort:RO.cortesia,
    breakdown:(document.getElementById('est-breakdown')||{}).innerText };`);
  num('Marcado como garantía, el cliente paga $0', money(conGar.tot), 0);
  num('Y no se le cobra IVU sobre nada', money(conGar.ivu), 0);
  yes('El desglose dice GARANTÍA, no "cortesía"', /Garant/i.test(conGar.breakdown) && !/Cortes/i.test(conGar.breakdown), conGar.breakdown);

  // Cortesía y garantía se excluyen
  await page.check('#est-cort');
  await page.waitForTimeout(300);
  const excl = await ev(page, `return { gar:RO.garantia, cort:RO.cortesia, ck:document.getElementById('est-gar').checked };`);
  is('Marcar cortesía apaga la garantía (no pueden ir juntas)', { g: excl.gar, c: excl.cort, ck: excl.ck }, { g: false, c: true, ck: false });
  await page.uncheck('#est-cort');
  await page.waitForTimeout(200);
  await page.check('#est-gar');
  await page.waitForTimeout(300);
  await page.selectOption('#est-gar-ro', roVenta);
  await page.fill('#est-gar-m', 'Batería Duralast 35-DLG, invoice ADV-789012 — falló dentro de los 5 años');
  await page.waitForTimeout(300);

  // Guardar: no debe pedir "motivo de cortesía" ni dejarla como cortesía
  for (let i = 0; i < 5; i++) { await page.click('#ro-next'); await page.waitForTimeout(250); }
  cola = [];
  await page.click('#pan-8 button:has-text("Guardar orden completa")');
  await page.waitForTimeout(900);
  const gRO = await ev(page, `
    var o=DB.ordenes.slice().sort(function(a,b){return new Date(b.fecha)-new Date(a.fecha);})[0];
    return { id:o.id, total:o.total, estado:o.estado, pago:o.pago, gar:!!o.garantia, cort:!!o.cortesia,
             garRO:o.garantiaRO, garVal:o.garantiaValor, cortVal:o.cortesiaValor,
             pagos:(o.pagos||[]).length };`);
  is('La orden de garantía queda en $0, pagada, y marcada como garantía',
     { t: gRO.total, e: gRO.estado, g: gRO.gar, c: gRO.cort }, { t: 0, e: 'pagado', g: true, c: false });
  is('El método de pago dice "Garantía", no "Cortesía"', gRO.pago, 'Garantía');
  is('Queda amarrada a la orden original', gRO.garRO, roVenta);
  yes('El valor cubierto se guarda en garantiaValor, NO en cortesiaValor', gRO.garVal > 0 && !gRO.cortVal, { gar: gRO.garVal, cort: gRO.cortVal });
  is('Y NO entra un cobro falso al libro de pagos', gRO.pagos, 0);

  // ================= QUE LOS NÚMEROS CUADREN =================
  const caja = await ev(page, `
    var hoy=rangoHoy?rangoHoy():null;
    var cob=(typeof cobradoEnRango==='function')?cobradoEnRango(new Date(new Date().setHours(0,0,0,0)),new Date(Date.now()+86400000)):null;
    var csv=buildContableCSV(new Date().getFullYear()+'-'+('0'+(new Date().getMonth()+1)).slice(-2));
    return { cobrado:cob, csv:csv };`);
  const lineas = caja.csv.split('\n');
  const hdr = lineas[1];
  yes('El CSV del contable trae columna Garantia aparte de Cortesia', /Cortesia,Garantia/.test(hdr), hdr);
  const filaG = lineas.find(l => l.indexOf(gRO.id) === 0 || l.indexOf(',' + gRO.id + ',') > 0);
  yes('La orden de garantía sale en el CSV con su motivo', filaG && /ADV-789012/.test(filaG), filaG);
  yes('Y la columna de cortesía de esa fila queda VACÍA', filaG && !/Cortes/i.test(filaG), filaG);
  // cobradoEnRango devuelve {total, porMetodo}
  num('El dinero cobrado hoy es solo el de la venta real (la garantía no inventa ingreso)',
      (caja.cobrado && caja.cobrado.total), venta.total);
  yes('Y el desglose por método no tiene un renglón "Garantía"',
      !Object.keys((caja.cobrado && caja.cobrado.porMetodo) || {}).some(k => /garant/i.test(k)),
      (caja.cobrado || {}).porMetodo);

  // La factura del cliente (link de WhatsApp) y el PDF
  const cliente = await ev(page, `
    var o=DB.ordenes.find(function(x){return x.id==='${gRO.id}';});
    var url=linkCliente?linkCliente(o):'';
    return { url:url };`).catch(() => ({ url: '' }));

  const pdf = await ev(page, `
    var o=DB.ordenes.find(function(x){return x.id==='${gRO.id}';});
    RO=JSON.parse(JSON.stringify(o));
    var antes=(DB.bitacora||[]).length;
    try{ exportPDF(); }catch(e){ return {err:String(e)}; }
    return { ok:true };`);
  yes('La factura PDF de una orden por garantía se genera sin romperse', !pdf.err, pdf.err);

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nGARANTÍA — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
