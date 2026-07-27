// EL CANDADO PROTEGE, PERO NO PUEDE PARALIZAR EL TRABAJO — Y TIENE QUE ENGANCHARSE SIEMPRE.
// Auditoría 2026-07-27 (parte 2). Dos bugs reales:
//   3. Con la factura sellada, el botón "Cliente aprobó — mover a servicios" (el upsell de los
//      denegados, o sea la venta que viene DESPUÉS) mutaba la orden, el guard rechazaba el
//      guardado y salía "🛑 GUARDADO BLOQUEADO — se detectó una pérdida de datos": un aviso
//      falso (no se perdió nada) y sin salida. La venta quedaba imposible.
//   4. De los cuatro caminos que dejan una orden en PAGADO, solo dos sellaban la factura.
//      El principal — terminar el asistente con estado Pagado — NO sellaba, así que el candado
//      legal casi nunca se activaba en el uso normal. `registrarAbono` al saldar tampoco.
// Usage:  python -m http.server 8931   (raíz del repo) + node factura-editable.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.01 ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // --- 3. FACTURA SELLADA + EL CLIENTE APRUEBA UN DENEGADO ---
  const ap = await page.evaluate(() => {
    DB.ordenes = [{
      id: 'RO-200', fecha: new Date().toISOString(), cliente: 'Migdalia', tel: '7875550134',
      vehiculo: { year: '2020', make: 'Kia', model: 'Forte' },
      servicios: [{ id: 's1', uid: 'u1', n: 'Aceite', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }],
      denegados: [{ nombre: 'Gomas delanteras', precio: 240 }], insp: {},
      total: 111.50, estado: 'pagado', abonado: 111.50, pago: 'ATH Móvil'
    }];
    sellarFactura(DB.ordenes[0]);
    saveDB({ force: true });
    const bitAntes = (DB.bitacora || []).length;
    let alertMsg = null;
    const oa = window.alert, oc = window.confirm;
    window.alert = m => { alertMsg = m; };
    window.confirm = () => true;               // él dice "sí, el cliente aprobó" y "sí, reabrir"
    try { apruebaDen('RO-200', 0); } catch (e) { alertMsg = 'EXCEPCION: ' + e.message; }
    window.alert = oa; window.confirm = oc;
    const o = DB.ordenes.find(x => x.id === 'RO-200');
    const disco = JSON.parse(localStorage.getItem('sf_v1')).ordenes.find(x => x.id === 'RO-200');
    return {
      alert: alertMsg,
      denegados: (o.denegados || []).length,
      servicios: (o.servicios || []).length,
      total: o.total, estado: o.estado, abonado: o.abonado,
      versiones: (o._versiones || []).length,
      versionTotal: ((o._versiones || [])[0] || {}).version ? o._versiones[0].version.total : null,
      sellada: facturaSellada(o),
      totalEnDisco: disco ? disco.total : null,
      bitacoraNueva: (DB.bitacora || []).length - bitAntes,
      tipos: (DB.bitacora || []).slice(-2).map(b => b.tipo)
    };
  });
  is('aprobar un denegado en factura sellada NO da aviso de pérdida de datos', ap.alert, null);
  is('el denegado se movió a servicios', [ap.denegados, ap.servicios], [0, 2]);
  num('el total se recalculó ($100 + $240 + IVU)', ap.total, 379.10);
  num('lo ya cobrado queda como abono del total nuevo', ap.abonado, 111.50);
  is('la orden vuelve a PENDIENTE por la diferencia', ap.estado, 'pendiente');
  num('el cambio SÍ llegó al disco', ap.totalEnDisco, 379.10);
  is('la factura quedó reabierta (se volverá a sellar al cobrar)', ap.sellada, false);
  is('la versión cerrada quedó congelada', ap.versiones, 1);
  num('la versión congelada conserva la factura original de $111.50', ap.versionTotal, 111.50);
  is('quedó rastro en la bitácora (reapertura + aprobación)', ap.tipos, ['factura-reabierta', 'denegado-aprobado']);

  // --- 4a. ABONO QUE SALDA -> PAGADO Y SELLADA ---
  const ab = await page.evaluate(() => {
    DB.ordenes = [{
      id: 'RO-300', fecha: new Date().toISOString(), cliente: 'Luis', tel: '', vehiculo: {},
      servicios: [{ id: 's1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
      denegados: [], insp: {}, total: 223.00, estado: 'pendiente', abonado: 100, pago: 'Cash'
    }];
    saveDB({ force: true });
    const op = window.prompt, oa = window.alert;
    window.prompt = () => '123'; window.alert = () => { };
    try { registrarAbono('RO-300'); } catch (e) { }
    window.prompt = op; window.alert = oa;
    const o = DB.ordenes[0];
    return { estado: o.estado, abonado: o.abonado, sellada: facturaSellada(o), sello: (o._cerrada || {}).total };
  });
  is('el abono que salda deja la orden PAGADA', ab.estado, 'pagado');
  num('abonado = total', ab.abonado, 223);
  is('el abono que salda SELLA la factura (igual que "marcar pagado")', ab.sellada, true);
  num('el sello guarda el total cobrado', ab.sello, 223);

  // --- 4b. TERMINAR EL ASISTENTE EN PAGADO -> SELLADA (el camino principal) ---
  const wiz = await page.evaluate(() => {
    DB.ordenes = []; saveDB({ force: true });
    go('ro');
    RO.cliente = 'Ana Rivera'; RO.tel = '7875551122';
    RO.vehiculo = { year: '2019', make: 'Toyota', model: 'Corolla', tag: 'ABC123', color: '', odoIn: '50000', odoOut: '', vin: '' };
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Cambio de aceite', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }];
    const sel = document.getElementById('est-estado'); if (sel) sel.value = 'pagado';
    const oa = window.alert; window.alert = () => { };
    try { saveRO(); } catch (e) { }
    window.alert = oa;
    const o = DB.ordenes[DB.ordenes.length - 1];
    return { estado: o.estado, sellada: facturaSellada(o), fpOk: fpFactura(o) === (o._cerrada || {}).fp, total: o.total };
  });
  is('la orden terminada en el asistente como PAGADO queda SELLADA', wiz.sellada, true);
  is('el sello coincide con el contenido de la factura', wiz.fpOk, true);
  is('estado pagado', wiz.estado, 'pagado');

  // --- 4c. UNA ORDEN SELLADA NO SE PUEDE ALTERAR POR DEBAJO (el candado sigue vivo) ---
  const guard = await page.evaluate(() => {
    const o = DB.ordenes[DB.ordenes.length - 1];
    o.total = 1;                                  // alteración a pelo, sin reabrir
    let msg = null; const oa = window.alert; window.alert = m => { msg = m; };
    const r = saveDB();
    window.alert = oa;
    const disco = JSON.parse(localStorage.getItem('sf_v1')).ordenes.slice(-1)[0];
    return { guardo: r, bloqueado: /CERRADA/.test(msg || ''), totalEnDisco: disco.total, totalEnMemoria: DB.ordenes.slice(-1)[0].total };
  });
  is('alterar a pelo una factura sellada sigue BLOQUEADO', [guard.guardo, guard.bloqueado], [false, true]);
  is('y la memoria vuelve al último estado bueno', guard.totalEnMemoria, guard.totalEnDisco);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
