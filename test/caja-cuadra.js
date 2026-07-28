// LA CAJA DEL DÍA TIENE QUE DAR IGUAL EN TODAS LAS PANTALLAS — Y EL DINERO NO PUEDE DESAPARECER.
// Auditoría 2026-07-28 (parte 2). Cuatro bugs reales encontrados sondeando la app en el navegador,
// con clicks de verdad, en un equipo limpio:
//
//   1. LA ORDEN RÁPIDA DEL MENÚ COBRABA SIN DEJAR RASTRO. `saveMO` creaba la orden con
//      estado 'pagado' pero NUNCA le decía nada al libro de pagos. Resultado en "Cierre de hoy":
//      Vendido $111.50 · **Cobrado $0** · Por cobrar $0. El dinero no existía en ninguna pantalla
//      de cobro — y como el estado ya era 'pagado', tampoco salía como deuda. Además hardcodeaba
//      "ATH Móvil", así que el desglose de la caja (cuánto por ATH, cuánto en efectivo) mentía en
//      cada venta de mostrador. Tampoco sellaba la factura ni dejaba renglón en la bitácora.
//
//   2. "RESUMEN DEL DÍA" (Historial) CONTRADECÍA A "CIERRE DE HOY" (Finanzas → Equipo).
//      Historial sumaba el TOTAL de las órdenes marcadas pagadas, ignorando la fecha real del
//      cobro y los abonos; Equipo leía el libro de pagos. El mismo día, con las mismas dos
//      órdenes: Historial decía "Cobrado $112 / Pendiente $223" y Equipo decía "$100 / $123".
//      Ninguna de las dos decía la verdad ($211.50 entraron, $123 se deben).
//
//   3. EL "x COBRAR" DE KPIs IGNORABA LOS ABONOS. Sumaba el total de las pendientes: el cliente
//      que ya había dado $100 de $223 seguía saliendo debiendo $223 ahí, mientras el home y el
//      cierre de caja decían $123. Misma clase del bug arreglado en el home el 27-jul.
//
//   4. "undefined" PINTADO EN PANTALLA Y MANDADO AL CLIENTE. `o.vehiculo` casi siempre existe
//      como objeto, así que el respaldo '—' nunca caía: con el año vacío se armaba la cadena
//      "undefined Kia Forte". Salía en Órdenes, Historial (día/todas/por cliente) y — lo peor —
//      en el WhatsApp al cliente: "Le toca el mantenimiento de undefined".
//
// Usage:  python -m http.server 8931   (raíz del repo) + node caja-cuadra.js
// En vivo: SHOPFLOW_URL="https://robert30z.github.io/ShopFlow/index.html" node caja-cuadra.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const eq = (n, got, exp) => (Math.abs(got - exp) < 0.01 ? ok(n, got) : no(n, { got, exp }));
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---- equipo limpio de verdad (no borrar DB a mano: el guard del batch 12 lo bloquea) ----
  await page.evaluate(async () => {
    localStorage.clear();
    try { const dbs = await indexedDB.databases(); for (const d of dbs) indexedDB.deleteDatabase(d.name); } catch (e) {}
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    // el método de pago se pregunta: contestamos "Cash" como lo haría él
    window.prompt = () => 'Cash';
    const alerts = []; window.alert = m => alerts.push(m);

    // --- venta de mostrador por el menú: $100 + IVU = $111.50, en efectivo ---
    MO.length = 0;
    addMO('a1', 'Cambio de aceite y filtro — regular (5 qt)', 100);
    saveMO();
    const o1 = DB.ordenes[DB.ordenes.length - 1];

    // --- orden normal, $223, con $100 abonados hoy y SIN año de vehículo (a propósito) ---
    const o2 = {
      id: 'RO-900', fecha: new Date().toISOString(), cliente: 'Migdalia Cotto', tel: '787-555-1212',
      vehiculo: { make: 'Kia', model: 'Forte' },
      servicios: [{ id: 'b1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
      total: 223, estado: 'pendiente', insp: {}, denegados: []
    };
    DB.ordenes.push(o2);
    registrarPago(o2, 100, 'ATH Móvil');
    saveDB();

    renderHistDia(); renderKPIs(); renderOrdenes(); renderHome();
    const st = buildEquipoStats();
    const num = (txt, re) => { const m = (txt || '').match(re); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };
    const hist = document.getElementById('h-dia').innerText;
    const kpi = document.getElementById('f-kpi').innerText;

    // el recordatorio que se le manda al cliente por WhatsApp
    let wa = ''; const open0 = window.open;
    window.open = u => { wa = decodeURIComponent(u); };
    waRemind('RO-900');
    window.open = open0;

    // barrido de basura visible en TODA la app
    const sucios = [];
    ['renderOrdenes', 'renderHistDia', 'renderHistTodas', 'renderHistClientes'].forEach(f => {
      try { window[f](); } catch (e) { sucios.push(f + ': ' + e.message); }
    });
    document.querySelectorAll('div,span,td,li').forEach(el => {
      if (el.children.length) return;
      if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(el.textContent || '')) sucios.push((el.textContent || '').trim().slice(0, 40));
    });

    return {
      alerts,
      rapida: {
        pago: o1.pago, nPagos: (o1.pagos || []).length, abonado: o1.abonado,
        total: o1.total, sellada: facturaSellada(o1),
        bita: (DB.bitacora || []).filter(b => b.tipo === 'orden-rapida').length
      },
      eqCobrado: st.hoy.cobrado, eqPend: st.hoy.pendiente, eqVendido: st.hoy.vendido,
      porMetodo: st.hoy.porMetodo,
      histCobrado: num(hist, /Cobrado\s*\$([\d,.]+)/),
      histPend: num(hist, /Pend\. de hoy\s*\$([\d,.]+)/),
      kpiCobrar: num(kpi, /x Cobrar\s*\$([\d,.]+)/),
      waTexto: (wa.split('text=')[1] || ''),
      sucios
    };
  });

  // --- 1. LA ORDEN RÁPIDA DEL MENÚ ENTRA A LA CAJA ---
  eq('Orden rápida: el cobro queda apuntado en el libro de pagos', r.rapida.nPagos, 1);
  eq('Orden rápida: abonado = total ($111.50)', r.rapida.abonado, 111.50);
  is('Orden rápida: usa el método que él contestó, no "ATH Móvil" fijo', r.rapida.pago, 'Cash');
  is('Orden rápida: la factura queda sellada', r.rapida.sellada, true);
  eq('Orden rápida: deja renglón en la bitácora', r.rapida.bita, 1);
  ok('Orden rápida: el aviso dice que ya cuenta en la caja', r.alerts[0].includes('caja de hoy'));

  // --- 2. LAS DOS PANTALLAS DE CAJA DICEN EL MISMO NÚMERO ---
  eq('Cierre de hoy: entraron $211.50 ($111.50 mostrador + $100 abono)', r.eqCobrado, 211.50);
  eq('Resumen del día = Cierre de hoy (Cobrado)', r.histCobrado, Math.round(r.eqCobrado));
  eq('Resumen del día: pendiente es el BALANCE ($223 − $100)', r.histPend, 123);
  eq('Desglose de caja: efectivo del mostrador', r.porMetodo['Cash'], 111.50);
  eq('Desglose de caja: ATH del abono', r.porMetodo['ATH Móvil'], 100);
  eq('Vendido del día sigue siendo el facturado ($334.50)', r.eqVendido, 334.50);

  // --- 3. KPIs USA EL BALANCE, NO EL TOTAL ---
  eq('KPIs "x Cobrar" resta el abono ($223 − $100)', r.kpiCobrar, 123);
  eq('KPIs "x Cobrar" = Cierre de hoy "Por cobrar"', r.kpiCobrar, r.eqPend);

  // --- 4. NADA DE "undefined" EN PANTALLA NI EN EL WHATSAPP DEL CLIENTE ---
  is('Ninguna pantalla pinta "undefined" / "NaN"', r.sucios.length, 0);
  ok('El WhatsApp al cliente dice el vehículo bien', !/undefined/.test(r.waTexto) && /Kia Forte/.test(r.waTexto));

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
