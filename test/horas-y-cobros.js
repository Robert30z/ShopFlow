// LAS HORAS QUE SE COBRARON Y LA PLATA QUE ENTRÓ DE VERDAD.
// ---------------------------------------------------------------------------
// Dos hallazgos del 28-jul, los dos de la misma familia: un número que se ve en una pantalla
// y NO es el mismo número en la otra.
//
// 1. HORAS FACTURADAS INFLADAS POR LA CANTIDAD. Un renglón "Amortiguador ×2 · 1h" se cobra
//    $100 de labor (la factura, el PDF y el link del cliente multiplican el PRECIO por la
//    cantidad, nunca las horas) pero los KPIs contaban 1h × 2 = 2 horas. La MISMA tarjeta de
//    la orden decía "Mano de obra: 1h × $100 = $100.00" y justo debajo "FACTURADAS 2.00 h".
//    Consecuencia real: su $/hora salía a la MITAD (ventas ÷ horas infladas), que es
//    exactamente el número con el que decide si sube la tarifa o si un técnico rinde.
//
// 2. COBRAR MÁS QUE EL BALANCE. Escribir $500 en una orden de $111.50 lo aceptaba callado:
//    "Cobrado hoy" marcaba $500, el P&L (que cuenta el total de la orden) marcaba $111.50, y
//    la caja del día no cerraba por $388.50 que nunca entraron. Un cero de más al teclear era
//    suficiente. Ahora avisa, apunta solo el balance y el resto queda como vuelto.
// Usage:  python -m http.server 8931   (raíz del repo) + node horas-y-cobros.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. HORAS: LAS QUE SE COBRARON ----------
  const horas = await page.evaluate(() => {
    DB.settings.laborRate = 100;
    DB.tecnicos = [{ id: 'TEC-1', nombre: 'Luis', com: 0, activo: true, creado: new Date().toISOString() }];
    DB.asesores = [{ id: 'ASE-1', nombre: 'Marta', activo: true, creado: new Date().toISOString() }];
    const rate = 100;
    DB.ordenes = [{
      id: 'RO-77', fecha: new Date().toISOString(), cliente: 'Prueba', tel: '', vehiculo: {},
      servicios: [{ id: 's1', uid: 'u1', n: 'Amortiguador', p: 120, ep: 120, qty: 2, laborHours: 1,
        parts: [{ name: 'amortiguador', cost: 40, sellPrice: 80, qty: 2 }] }],
      denegados: [], insp: {}, fotos: [], total: 0, estado: 'pagado', abonado: 0, pagos: [],
      tecnico: 'TEC-1', asesor: 'ASE-1'
    }];
    const o = DB.ordenes[0];
    // el mismo cálculo que hace la factura: precio × cantidad + labor + piezas
    const sub = o.servicios.reduce((a, s) => a + (s.ep * (s.qty || 1)) + ((s.laborHours || 0) * rate) +
      s.parts.reduce((x, pp) => x + pp.sellPrice * pp.qty, 0), 0);
    o.total = Math.round(sub * 1.115 * 100) / 100;
    o.pagos = [{ id: 'p1', ts: new Date().toISOString(), monto: o.total, metodo: 'ATH Móvil' }];
    o.abonado = o.total; o.pagadoFecha = new Date().toISOString();
    saveDB({ force: true });
    openRODetail('RO-77');
    const lin = document.getElementById('ro-detail-body').innerText.split('\n');
    const iFact = lin.findIndex(x => /FACTURADAS/.test(x));
    const st = buildEquipoStats();
    return {
      sub, total: o.total,
      laborEnFactura: (lin.find(x => /Mano de obra/.test(x)) || ''),
      facturadasEnPantalla: iFact >= 0 ? lin.slice(iFact, iFact + 2).join(' ') : '',
      horasFact: _horasFactDe(o),
      dolHora: st.dolHora,
      asesor: (st.ases || []).map(a => ({ n: a.nombre, laborH: a.laborH, labor: a.labor }))
    };
  });
  num('El subtotal cobra el precio ×2 pero la labor una sola vez', horas.sub, 500);
  yes('La factura dice 1h de mano de obra', /1h × \$100 = \$100\.00/.test(horas.laborEnFactura), horas.laborEnFactura);
  num('⭐ Y las "horas facturadas" son ESA hora, no dos', horas.horasFact, 1);
  yes('La tarjeta de la orden ya no se contradice a sí misma', /1\.00 h/.test(horas.facturadasEnPantalla), horas.facturadasEnPantalla);
  num('⭐ El $/hora del taller sale del dinero real (no a la mitad)', horas.dolHora.ventasHora, 500);
  is('Y el asesor tampoco cobra horas que nadie facturó',
    horas.asesor.map(a => ({ h: a.laborH, l: a.labor })), [{ h: 1, l: 100 }]);

  // ---------- 2. COBRAR MÁS QUE EL BALANCE ----------
  const sobre = await page.evaluate(() => {
    DB.ordenes = [{ id: 'RO-9', fecha: new Date().toISOString(), cliente: 'Cliente', tel: '', vehiculo: {},
      servicios: [{ id: 's1', uid: 'u1', n: 'Servicio', p: 100, ep: 100, qty: 1, laborHours: 0, parts: [] }],
      denegados: [], insp: {}, fotos: [], total: 111.5, estado: 'pendiente', abonado: 0, pagos: [] }];
    saveDB({ force: true });
    const op = window.prompt, oa = window.alert, oc = window.confirm;
    let n = 0, avisos = [];
    window.prompt = () => (++n === 1 ? '500' : 'Cash');       // un cero de más
    window.alert = m => avisos.push(String(m));
    window.confirm = m => { avisos.push(String(m)); return true; };   // acepta apuntar el balance
    registrarAbono('RO-9');
    window.prompt = op; window.alert = oa; window.confirm = oc;
    const o = DB.ordenes[0];
    const st = buildEquipoStats();
    return { abonado: o.abonado, balance: balanceRO(o), estado: o.estado,
      pagos: (o.pagos || []).map(p => ({ m: p.monto, v: p.vuelto || 0 })),
      cobradoHoy: st.hoy.cobrado, avisos: avisos.join(' || ') };
  });
  yes('⭐ Avisa que escribiste más que el balance', /balance es \$111\.50/.test(sobre.avisos) && /vuelto/i.test(sobre.avisos), sobre.avisos.slice(0, 160));
  num('Se apunta el balance, no lo que se tecleó', sobre.abonado, 111.5);
  is('El renglón guarda cuánto fue vuelto (queda el rastro)', sobre.pagos, [{ m: 111.5, v: 388.5 }]);
  num('⭐ "Cobrado hoy" cuadra con la orden', sobre.cobradoHoy, 111.5);
  is('Y la orden queda saldada', { e: sobre.estado, b: sobre.balance }, { e: 'pagado', b: 0 });

  // ---------- 3. CANCELAR EL AVISO NO COBRA NADA ----------
  const cancela = await page.evaluate(() => {
    DB.ordenes = [{ id: 'RO-10', fecha: new Date().toISOString(), cliente: 'C2', tel: '', vehiculo: {},
      servicios: [{ id: 's1', uid: 'u1', n: 'S', p: 100, ep: 100, qty: 1, laborHours: 0, parts: [] }],
      denegados: [], insp: {}, fotos: [], total: 111.5, estado: 'pendiente', abonado: 0, pagos: [] }];
    saveDB({ force: true });
    const op = window.prompt, oc = window.confirm, oa = window.alert;
    let n = 0;
    window.prompt = () => (++n === 1 ? '500' : 'Cash');
    window.confirm = () => false;                              // "voy a corregir el monto"
    window.alert = () => { };
    registrarAbono('RO-10');
    window.prompt = op; window.confirm = oc; window.alert = oa;
    const o = DB.ordenes[0];
    return { abonado: o.abonado, pagos: (o.pagos || []).length, estado: o.estado };
  });
  is('Si cancelas, no se apunta nada', cancela, { abonado: 0, pagos: 0, estado: 'pendiente' });

  // ---------- 4. UN ABONO NORMAL SIGUE FUNCIONANDO IGUAL ----------
  const normal = await page.evaluate(() => {
    DB.ordenes = [{ id: 'RO-11', fecha: new Date().toISOString(), cliente: 'C3', tel: '', vehiculo: {},
      servicios: [{ id: 's1', uid: 'u1', n: 'S', p: 200, ep: 200, qty: 1, laborHours: 0, parts: [] }],
      denegados: [], insp: {}, fotos: [], total: 223, estado: 'pendiente', abonado: 0, pagos: [] }];
    saveDB({ force: true });
    const op = window.prompt, oa = window.alert; let n = 0;
    window.prompt = () => (++n === 1 ? '100' : 'ATH Móvil');
    window.alert = () => { };
    registrarAbono('RO-11');
    window.prompt = op; window.alert = oa;
    const o = DB.ordenes[0];
    return { abonado: o.abonado, balance: balanceRO(o), estado: o.estado, vuelto: (o.pagos[0] || {}).vuelto };
  });
  is('El abono parcial de siempre no cambió', normal, { abonado: 100, balance: 123, estado: 'pendiente', vuelto: undefined });

  is('Sin errores de JavaScript', errs, []);
  await browser.close();
  console.log('\n' + (fail ? `❌ ${fail} FALLOS de ${pass + fail}` : `TODO VERDE — ${pass} pass / 0 fail`));
  process.exit(fail ? 1 : 0);
})();
