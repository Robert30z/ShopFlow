// UNA ORDEN DE REPARACIÓN COMPLETA, DE PUNTA A PUNTA, TOCANDO LA APP DE VERDAD.
// ---------------------------------------------------------------------------
// Las otras pruebas llaman funciones sueltas; esta hace lo que hace Roberto un martes:
// equipo limpio (contexto nuevo = incógnito, sin datos ni sesión) → Nueva RO → cliente,
// vehículo, fotos, servicios con labor y piezas, estimado, firma, inspección, denegados,
// firma final, guardar → factura → PDF → link al cliente → cobrar → cuadrar la caja.
// Si algo se rompe en el camino REAL, se rompe aquí.
// Usage:  python -m http.server 8931   (raíz del repo) + node orden-completa.js
//         contra el sitio en vivo: SHOPFLOW_URL="https://robert30z.github.io/ShopFlow/index.html" node orden-completa.js
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

// JPEG mínimo de verdad (1x1) para el input de fotos
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

// Los prompts/confirms se contestan en orden con esta cola
let cola = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();     // ← contexto nuevo: sin localStorage, sin sesión, sin SW
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

  // ---------- ARRANQUE EN EQUIPO LIMPIO ----------
  const arranque = await ev(page, `return {
    ordenes: (DB.ordenes||[]).length, demo: !!DB._demo,
    home: !!document.querySelector('#home.v'), titulo: (document.getElementById('hdate')||{}).textContent };`);
  is('Equipo limpio: abre en el home, sin órdenes y sin modo demo', { o: arranque.ordenes, d: arranque.demo, h: arranque.home }, { o: 0, d: false, h: true });

  // ---------- PASO 1: CLIENTE Y VEHÍCULO ----------
  await page.click('#home .mc');                         // "Nueva RO"
  await page.waitForTimeout(400);
  await page.fill('#c-n', 'Ramón Figueroa');
  await page.fill('#c-t', '787-555-1212');
  await page.fill('#v-y', '2018');
  await page.fill('#v-ma', 'Honda');
  await page.fill('#v-mo', 'Civic');
  await page.fill('#v-t', 'HZK-411');
  await page.fill('#v-c', 'Gris');
  await page.fill('#v-o1', '128450');
  await page.fill('#v-q', 'Chilla al frenar y se siente vibración en el guía.');
  const paso1 = await ev(page, `return { cliente: RO.cliente, tel: RO.tel, veh: RO.vehiculo, queja: RO.queja, id: RO.id };`);
  is('Lo tecleado llega a la orden', { c: paso1.cliente, t: paso1.tel, y: paso1.veh.year, ma: paso1.veh.make, tag: paso1.veh.tag }, { c: 'Ramón Figueroa', t: '787-555-1212', y: '2018', ma: 'Honda', tag: 'HZK-411' });

  // ---------- PASO 2: FOTOS DEL ANTES ----------
  await page.click('#ro-next');
  await page.waitForTimeout(300);
  await page.setInputFiles('#pan-1 input[type=file]', [
    { name: 'entrada1.jpg', mimeType: 'image/jpeg', buffer: JPEG },
    { name: 'entrada2.jpg', mimeType: 'image/jpeg', buffer: JPEG }
  ]);
  await page.waitForTimeout(1200);
  const fotos = await ev(page, `return { n: (RO.fotos||[]).length, refs: (RO.fotos||[]).every(f => f && f.id && !String(f.t||'').startsWith('data:')),
    lbl: (document.getElementById('photo-count-lbl')||{}).textContent };`);
  is('Entran 2 fotos y quedan como referencia (no base64 en localStorage)', { n: fotos.n, refs: fotos.refs }, { n: 2, refs: true });

  // ---------- PASO 3: SERVICIOS (catálogo + manual + labor + pieza) ----------
  await page.click('#ro-next');
  await page.waitForTimeout(300);
  await page.fill('#ro-sq', 'freno');
  await page.waitForTimeout(250);
  const hayCatalogo = await page.locator('#ro-sl .svc-row button').count();
  if (hayCatalogo) { await page.locator('#ro-sl .svc-row button').first().click(); await page.waitForTimeout(200); }
  cola = ['Diagnóstico de vibración', '60'];             // addManualSvc: nombre y precio
  await page.click('#pan-2 button:has-text("Servicio manual")');
  await page.waitForTimeout(300);
  const servicios = await ev(page, `return { n: (RO.servicios||[]).length, nombres: (RO.servicios||[]).map(s=>s.n),
    sub: (document.getElementById('ro-sub')||{}).textContent };`);
  yes('Se añaden servicios desde el catálogo y a mano', servicios.n >= 2, servicios.nombres);

  // labor y pieza sobre el primer servicio (el camino donde antes no cuadraba la factura)
  const conPiezas = await ev(page, `
    RO.servicios[0].laborHours = 1.5;
    RO.servicios[0].parts = [{ name: 'Pastillas cerámicas', partNum: 'D1521', supplier: 'AutoZone', cost: 38, sellPrice: 72, qty: 1, receipt: '' }];
    renderROSO();
    return { sub: (document.getElementById('ro-sub')||{}).textContent, rate: DB.settings.laborRate,
             precios: RO.servicios.map(s => ({ n: s.n, ep: s.ep, h: s.laborHours, pz: (s.parts||[]).length })) };`);
  yes('El subtotal del paso de servicios ya cuenta labor y piezas', money(conPiezas.sub) > 0, conPiezas.sub);

  // ---------- PASO 4: ESTIMADO — que los números cuadren ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  const est = await ev(page, `return { sub: (document.getElementById('est-sub')||{}).textContent,
    ivu: (document.getElementById('est-ivu')||{}).textContent, tot: (document.getElementById('est-tot')||{}).textContent,
    roTotal: RO.total };`);
  const eSub = money(est.sub), eIvu = money(est.ivu), eTot = money(est.tot);
  num('Estimado: Subtotal + IVU = Total', eSub + eIvu, eTot);
  num('IVU = 11.5% del subtotal', eIvu, Math.round(eSub * 0.115 * 100) / 100);
  num('El total de la pantalla es el total de la orden', est.roTotal, eTot);

  // ---------- PASO 5: FIRMA DE AUTORIZACIÓN ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  const firmar = async sel => {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.move(b.x + 40, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 120, b.y + b.height / 2 - 25, { steps: 8 });
    await page.mouse.move(b.x + 220, b.y + b.height / 2 + 20, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  await firmar('#sig-1');
  yes('La firma de autorización queda capturada', await ev(page, `return !!RO.sig1;`));

  // ---------- PASO 6: INSPECCIÓN (35 puntos) ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  const verdes = await page.locator('.ibt[id^="ibv-"]').count();
  for (let i = 0; i < Math.min(6, verdes); i++) await page.locator('.ibt[id^="ibv-"]').nth(i).click();
  await page.locator('.ibt[id^="ibr-"]').nth(6).click();        // otro ítem en rojo → cae en denegados
  await page.locator('.ibt[id^="iba-"]').nth(7).click();        // otro en amarillo
  await page.fill('#insp-gen', 'Gomas delanteras al 40%. Batería con 2 años. Se recomienda alineamiento.');
  const insp = await ev(page, `return { total: Object.keys(RO.insp||{}).length,
    rojos: Object.values(RO.insp||{}).filter(v=>v==='rojo').length, gen: (RO.inspGeneral||'').length,
    badges: (document.getElementById('insp-b')||{}).innerText };`);
  is('La inspección registra los 8 puntos marcados', insp.total, 8);
  yes('Y cuenta al menos un crítico', insp.rojos >= 1);

  // ---------- PASO 7: DENEGADOS ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  await page.fill('#den-n', 'Cambio de gomas delanteras');
  await page.fill('#den-p', '320');
  await page.selectOption('#den-u', 'urgente');
  await page.fill('#den-nota', 'Al 40%, riesgo en carretera mojada.');
  await page.click('#pan-6 button:has-text("Registrar denegado")');
  await page.waitForTimeout(300);
  const den = await ev(page, `
    const manual = (RO.denegados||[]).find(d => /gomas/i.test(d.nombre||d.n||''));
    return { n: (RO.denegados||[]).length, manual: manual||null, auto: (RO.denegados||[]).filter(d=>d.auto).length };`);
  yes('El denegado manual queda con su precio y su urgencia', den.manual && den.manual.precio === 320 && den.manual.urgencia === 'urgente', den.manual);
  yes('Y el ítem en rojo de la inspección cae solo en denegados', den.auto >= 1, { total: den.n, auto: den.auto });

  // ---------- PASO 8: FIRMA FINAL ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  await firmar('#sig-2');
  yes('La firma final queda capturada', await ev(page, `return !!RO.sig2;`));

  // ---------- PASO 9: CIERRE Y GUARDADO ----------
  await page.click('#ro-next');
  await page.waitForTimeout(400);
  cola = [true];
  await page.click('#pan-8 button:has-text("Guardar orden completa")');
  await page.waitForTimeout(1200);
  const guardada = await ev(page, `
    const o = (DB.ordenes||[])[0] || null;
    return o ? { id: o.id, cliente: o.cliente, total: o.total, estado: o.estado, servicios: (o.servicios||[]).length,
      fotos: (o.fotos||[]).length, firma1: !!o.sig1, firma2: !!o.sig2, den: (o.denegados||[]).length,
      insp: Object.keys(o.insp||{}).length, garage: (DB.garage||[]).some(g=>g.roId===o.id),
      cliGuardado: (DB.clientes||[]).length, bitacora: (DB.bitacora||[]).length } : null;`);
  yes('La orden se guardó completa', !!guardada, guardada);
  if (guardada) {
    num('Con el mismo total que mostró el estimado', guardada.total, eTot);
    is('Con sus fotos, sus dos firmas, su inspección y su denegado',
      { f: guardada.fotos, s1: guardada.firma1, s2: guardada.firma2, d: guardada.den >= 2, i: guardada.insp >= 8 },
      { f: 2, s1: true, s2: true, d: true, i: true });
    yes('Entra al garage activo', guardada.garage);
    yes('Y el cliente queda en la libreta', guardada.cliGuardado >= 1, guardada.cliGuardado);
  }

  // ---------- LA FACTURA QUE ÉL MIRA ----------
  const detalle = await ev(page, `
    const o = DB.ordenes[0]; openRODetail(o.id);
    const t = document.getElementById('ro-detail-body').innerText;
    const g = r => { const m = t.match(r); return m ? Number(m[1].replace(/,/g,'')) : null; };
    return { sub: g(/Subtotal\\s*\\$([\\d.,]+)/), ivu: g(/IVU \\(11\\.5%\\)\\s*\\$([\\d.,]+)/), tot: g(/Total\\s*\\$([\\d.,]+)/),
             texto: t.slice(0, 400) };`);
  num('Detalle de la orden: Subtotal + IVU = Total', (detalle.sub || 0) + (detalle.ivu || 0), detalle.tot || 0);
  num('Y ese total es el mismo del estimado', detalle.tot, eTot);

  // ---------- EL PDF DEL CLIENTE ----------
  const pdf = await ev(page, `
    let err = '', magic = '', size = 0, ctx = null;
    try {
      reExportPDF(DB.ordenes[0].id);
      const b = window._pdfBlob;
      if (b) { size = b.size; magic = String.fromCharCode.apply(null, new Uint8Array(await b.arrayBuffer()).slice(0,5)); }
      ctx = window._pdfCtx;
    } catch(e) { err = String(e && e.message || e); }
    return { err, magic, size, ctx };`);
  is('El PDF de la factura se genera y es un PDF de verdad', { magic: pdf.magic, err: pdf.err }, { magic: '%PDF-', err: '' });
  yes('Con el cliente y el total congelados en el PDF', pdf.ctx && pdf.ctx.cliente === 'Ramón Figueroa', pdf.ctx);
  yes('Y pesa lo que pesa un recibo con fotos', pdf.size > 10000, { kb: Math.round(pdf.size / 1024) });

  // ---------- EL LINK QUE VE EL CLIENTE ----------
  const linkUrl = await ev(page, `
    const abiertos = []; window.open = u => { abiertos.push(u); return { focus(){} }; };
    shareStatus(DB.ordenes[0].id);
    return new Promise(r => setTimeout(() => r(decodeURIComponent(abiertos[0]||'')), 400));`);
  const hash = (linkUrl.split('#s=')[1] || '');
  yes('Se genera el link de estado para el cliente', hash.length > 20, { kb: (hash.length / 1024).toFixed(1) });
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.goto(BASE + '#s=' + hash, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const vistaCliente = await p2.evaluate(() => document.body.innerText);
  const cTot = money((vistaCliente.match(/Total\s*\$([\d.,]+)/) || [])[1]);
  num('⭐ Lo que ve el cliente cuadra con lo que dice la factura', cTot, eTot);
  yes('Y ve el desglose con IVU (no un total que sale de la nada)', /IVU \(11\.5%\)/.test(vistaCliente));
  yes('Ve su recomendado con nombre y precio', /gomas delanteras/i.test(vistaCliente) && /320/.test(vistaCliente));
  await p2.close();

  // ---------- COBRAR ----------
  cola = ['150', 'ATH Móvil', true];                    // abono parcial
  const cobro1 = await ev(page, `
    const o = DB.ordenes[0]; registrarAbono(o.id);
    return new Promise(r => setTimeout(() => { const x = DB.ordenes[0];
      r({ abonado: x.abonado, pagos: (x.pagos||[]).length, estado: x.estado, balance: balanceRO(x) }); }, 600));`);
  num('Abono parcial de $150 registrado', cobro1.abonado, 150);
  is('Queda renglón en el libro de pagos y la orden sigue pendiente', { p: cobro1.pagos, e: cobro1.estado }, { p: 1, e: 'pendiente' });
  num('El balance es total − abonado', cobro1.balance, eTot - 150);

  cola = ['Cash'];                                     // markPaid pregunta el método
  const cobro2 = await ev(page, `
    const o = DB.ordenes[0]; markPaid(o.id);
    return new Promise(r => setTimeout(() => { const x = DB.ordenes[0];
      r({ estado: x.estado, abonado: x.abonado, pagos: (x.pagos||[]).length, sellada: facturaSellada(x),
          intacta: facturaIntacta(x), balance: balanceRO(x) }); }, 700));`);
  is('Al saldar: PAGADO, factura sellada y balance en cero',
    { e: cobro2.estado, s: cobro2.sellada, i: cobro2.intacta, b: cobro2.balance }, { e: 'pagado', s: true, i: true, b: 0 });
  num('El libro de pagos suma el total cobrado', cobro2.abonado, eTot);
  is('Y quedaron los dos cobros por separado (caja cuadrable)', cobro2.pagos, 2);

  // ---------- QUE LA CAJA CUADRE ----------
  const caja = await ev(page, `
    const st = buildEquipoStats();
    const pl = (function(){ try { renderPL(); } catch(e) {} return (document.getElementById('finanzas')||{}).innerText || ''; })();
    const hoy = new Date(); const ym = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0');
    const csv = (typeof buildContableCSV === 'function') ? buildContableCSV(ym) : '';
    return { cobradoHoy: st.hoy.cobrado, porMetodo: st.hoy.porMetodo, pendiente: st.hoy.pendiente,
             pl: pl.slice(0, 600), csvTieneOrden: csv.indexOf(DB.ordenes[0].id) >= 0 };`);
  num('"Cobrado hoy" = lo que entró hoy', caja.cobradoHoy, eTot);
  is('⭐ Desglosado por método de verdad (ATH y efectivo por separado)',
    { ath: Math.round((caja.porMetodo['ATH Móvil']||0)*100)/100, cash: Math.round((caja.porMetodo['Cash']||0)*100)/100 },
    { ath: 150, cash: Math.round((eTot - 150) * 100) / 100 });
  num('No queda nada por cobrar', caja.pendiente, 0);

  // ---------- EL RASTRO LEGAL ----------
  const rastro = await ev(page, `
    const tipos = (DB.bitacora||[]).map(b => b.tipo);
    return { tipos: Array.from(new Set(tipos)), n: tipos.length, papelera: (DB.papelera||[]).length };`);
  yes('La bitácora guardó el rastro de la orden y del cobro', rastro.n >= 2, rastro.tipos);

  // ---------- DESPUÉS DE RECARGAR (lo que pasa de verdad al día siguiente) ----------
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);
  const tras = await ev(page, `
    const o = (DB.ordenes||[])[0] || {};
    let fotosVisibles = 0;
    try { const r = await Promise.all((o.fotos||[]).map(f => photoResolve(f))); fotosVisibles = r.filter(x => x && x.length > 20).length; } catch(e) {}
    return { ordenes: (DB.ordenes||[]).length, total: o.total, estado: o.estado, abonado: o.abonado,
             fotos: (o.fotos||[]).length, fotosVisibles: fotosVisibles, firma: !!o.sig1, sellada: facturaSellada(o) };`);
  is('Tras recargar: la orden sigue completa, cobrada y sellada',
    { n: tras.ordenes, e: tras.estado, s: tras.sellada, f: tras.firma }, { n: 1, e: 'pagado', s: true, f: true });
  num('Con su total intacto', tras.total, eTot);
  is('Y las fotos se vuelven a ver desde IndexedDB', { g: tras.fotos, v: tras.fotosVisibles }, { g: 2, v: 2 });

  is('Sin errores de JavaScript en toda la corrida', errs, []);
  is('Sin errores en la página del cliente', errs2, []);

  await browser.close();
  console.log('\n' + (fail ? `❌ ${fail} FALLOS de ${pass + fail}` : `ORDEN COMPLETA — ${pass} pass / 0 fail`));
  process.exit(fail ? 1 : 0);
})();
