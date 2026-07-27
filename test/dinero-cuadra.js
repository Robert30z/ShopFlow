// EL MISMO DINERO TIENE QUE DAR IGUAL EN TODAS LAS PANTALLAS.
// Auditoría 2026-07-27 (parte 2). Dos bugs reales encontrados sondeando la app:
//   1. El P&L contaba las órdenes ABIERTAS y el CSV del contable no. Con una orden abierta de
//      $557.50, "Ingresos brutos" del mes decía $1,115.00 y el CSV que él le manda al contable
//      decía $557.50 — y la línea "de esto, IVU cobrado" (que sí las excluía) contradecía al
//      número que tenía justo encima. La app le promete en el home y en el detalle que
//      "mientras estén abiertas no cuentan en tus ventas ni en el IVU".
//   2. El "Por cobrar" del home sumaba el TOTAL de las pendientes IGNORANDO los abonos:
//      un cliente que abonó $200 de $446 salía como $446 en el home y $246 en Cierre de hoy
//      y en el detalle de la orden.
// Usage:  python -m http.server 8931   (raíz del repo) + node dinero-cuadra.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const eq = (n, got, exp) => (Math.abs(got - exp) < 0.01 ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    const hoy = new Date().toISOString();
    const ym = hoy.slice(0, 7);
    const svc = (n, p) => [{ id: 's1', uid: 'u1', n: n, p: p, ep: p, qty: 1, parts: [], laborHours: 0 }];
    DB.ordenes = [
      // cobrada del todo
      { id: 'RO-100', fecha: hoy, cliente: 'Cerrada', tel: '', vehiculo: {}, servicios: svc('Aceite', 100), denegados: [], insp: {}, total: 111.50, estado: 'pagado', abonado: 111.50, pago: 'ATH Móvil' },
      // ABIERTA: trabajo hecho que todavía no es dinero
      { id: 'RO-101', fecha: hoy, cliente: 'Abierta', tel: '', vehiculo: {}, servicios: svc('Frenos', 500), denegados: [], insp: {}, total: 557.50, estado: 'abierta', pago: 'ATH Móvil' },
      // pendiente con abono parcial
      { id: 'RO-102', fecha: hoy, cliente: 'Abono', tel: '', vehiculo: {}, servicios: svc('Alternador', 400), denegados: [], insp: {}, total: 446.00, estado: 'pendiente', abonado: 200, pago: 'Cash' }
    ];
    DB.gastos = [];
    saveDB({ force: true });
    renderPL();
    const txt = document.getElementById('f-pl').innerText;
    const grab = re => { const m = txt.match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
    const csv = buildContableCSV(ym).split('\n').filter(l => l.startsWith(',,,,,,TOTAL'))[0].split(',');
    renderHome();
    const eqs = buildEquipoStats();
    return {
      plIngresos: grab(/Ingresos brutos\s*\$([\d.,]+)/),
      plIVU: grab(/IVU cobrado \(11\.5%\)\s*\$([\d.,]+)/),
      plOrdenes: grab(/Órdenes\s*(\d+)/),
      csvSub: parseFloat(csv[7]), csvIVU: parseFloat(csv[8]), csvTotal: parseFloat(csv[9]),
      homeCobrar: parseFloat(document.getElementById('h-cobrar').textContent.replace(/[$,]/g, '')),
      homeHoy: parseFloat(document.getElementById('h-hoy').textContent.replace(/[$,]/g, '')),
      eqCobrar: eqs.hoy.pendiente,
      eqVendido: eqs.hoy.vendido,
      balDetalle: balanceRO(DB.ordenes[2]),
      flota: (function () { DB.ordenes[2].empresa = 'Transporte X'; return flotaStats('Transporte X').pendiente; })()
    };
  });

  // --- 1. LAS ABIERTAS NO CUENTAN, Y EL P&L CUADRA CON EL CSV DEL CONTABLE ---
  eq('P&L "Ingresos brutos" = TOTAL del CSV del contable', r.plIngresos, r.csvTotal);
  eq('P&L Ingresos deja fuera la orden ABIERTA ($557.50)', r.plIngresos, 557.50);
  eq('P&L "IVU cobrado" = IVU del CSV', r.plIVU, r.csvIVU);
  eq('Subtotal + IVU del CSV = Ingresos del P&L', r.csvSub + r.csvIVU, r.plIngresos);
  eq('Conteo de órdenes del P&L excluye la abierta', r.plOrdenes, 2);
  eq('Ventas de hoy del home = vendido de Cierre de hoy', r.homeHoy, Math.round(r.eqVendido));

  // --- 2. "POR COBRAR" ES EL BALANCE, NO EL TOTAL ---
  eq('Home "Por cobrar" resta el abono ($446 − $200)', r.homeCobrar, 246);
  eq('Home "Por cobrar" = Cierre de hoy "Por cobrar"', r.homeCobrar, r.eqCobrar);
  eq('Home "Por cobrar" = balance del detalle de la orden', r.homeCobrar, r.balDetalle);
  eq('Estado de cuenta de flota usa el mismo balance', r.flota, 246);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
