// UN COBRO ES UN HECHO CON FECHA — Y NO SE PUEDE PERDER AL SINCRONIZAR.
// Batch 16 (27-jul). `abonado` decía CUÁNTO pero nunca CUÁNDO ni CÓMO: "Cobrado hoy" contaba la
// orden completa el día que se saldaba, así que si el martes te abonó $50 y el jueves los otros
// $38, el jueves marcaba $88 y el martes $0 — imposible cuadrar la caja al cierre, y sin forma
// de separar ATH de efectivo.
// Y el hallazgo que salió auditando el merge: con dos equipos, cobrar $50 en el iPad y $38 en el
// iPhone sobre la misma orden hacía que el merge se quedara con UNA versión entera de la orden y
// **uno de los dos cobros desaparecía sin dejar rastro**. Las listas append-only (pagos y
// versiones de factura) se unen por id, nunca se reemplazan.
// Usage:  python -m http.server 8931   (raíz del repo) + node libro-pagos.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. DOS ABONOS EN DÍAS DISTINTOS: la caja de hoy es la de hoy ----------
  const caja = await page.evaluate(() => {
    const ayer = new Date(Date.now() - 86400000).toISOString();
    DB.ordenes = [{
      id: 'RO-700', fecha: ayer, cliente: 'Luis', tel: '', vehiculo: {},
      servicios: [{ id: 's1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
      denegados: [], insp: {}, total: 223, estado: 'pendiente', abonado: 0, pago: 'ATH Móvil',
      pagos: [{ id: 'PG-a', ts: ayer, monto: 50, metodo: 'Cash' }]
    }];
    DB.ordenes[0].abonado = sumaPagos(DB.ordenes[0]);
    saveDB({ force: true });
    const op = window.prompt, oa = window.alert;
    let n = 0;
    window.prompt = () => (++n === 1 ? '38' : 'ATH Móvil');   // monto, luego método
    window.alert = () => { };
    registrarAbono('RO-700');
    window.prompt = op; window.alert = oa;
    const o = DB.ordenes[0];
    const st = buildEquipoStats();
    return {
      renglones: (o.pagos || []).length, abonado: o.abonado, balance: balanceRO(o),
      cobradoHoy: st.hoy.cobrado, porMetodo: st.hoy.porMetodo, porCobrar: st.hoy.pendiente
    };
  });
  is('el abono nuevo es un renglón más del libro', caja.renglones, 2);
  num('abonado = suma del libro ($50 + $38)', caja.abonado, 88);
  num('balance = total − lo recibido', caja.balance, 135);
  num('"Cobrado hoy" cuenta SOLO lo que entró hoy ($38, no los $50 de ayer)', caja.cobradoHoy, 38);
  is('y lo separa por método para cuadrar la caja', caja.porMetodo, { 'ATH Móvil': 38 });
  num('"Por cobrar" sigue siendo el balance', caja.porCobrar, 135);

  // ---------- 2. UN ABONO DE UN EQUIPO VIEJO NO SE PIERDE ----------
  const viejo = await page.evaluate(() => {
    DB.ordenes = [{
      id: 'RO-701', fecha: new Date().toISOString(), cliente: 'Ana', tel: '', vehiculo: {},
      servicios: [{ id: 's1', n: 'Aceite', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }],
      denegados: [], insp: {}, total: 223, estado: 'pendiente', abonado: 100, pago: 'Cash'
      // sin `pagos`: viene de un equipo con la versión anterior
    }];
    saveDB({ force: true });
    const op = window.prompt, oa = window.alert;
    let n = 0;
    window.prompt = () => (++n === 1 ? '123' : 'Cash');
    window.alert = () => { };
    registrarAbono('RO-701');
    window.prompt = op; window.alert = oa;
    const o = DB.ordenes[0];
    return { abonado: o.abonado, renglones: (o.pagos || []).length, estado: o.estado, sellada: facturaSellada(o) };
  });
  num('el abono anterior NO se borra al recalcular ($100 + $123)', viejo.abonado, 223);
  is('se respalda como renglón "de antes" + el nuevo', viejo.renglones, 2);
  is('y al saldar queda pagada y sellada', [viejo.estado, viejo.sellada], ['pagado', true]);

  // ---------- 3. DOS EQUIPOS COBRAN LA MISMA ORDEN: no se pierde ningún pago ----------
  const merge = await page.evaluate(() => {
    const base = {
      id: 'RO-702', fecha: new Date().toISOString(), cliente: 'Pedro', tel: '', vehiculo: {},
      servicios: [{ id: 's1', n: 'Suspensión', p: 400, ep: 400, qty: 1, parts: [], laborHours: 0 }],
      denegados: [], insp: {}, total: 446, estado: 'pendiente', pago: 'Cash'
    };
    const ipad = JSON.parse(JSON.stringify(base));
    ipad.pagos = [{ id: 'PG-ipad', ts: '2026-07-27T14:00:00.000Z', monto: 50, metodo: 'Cash' }];
    ipad.abonado = 50; ipad._editedAt = '2026-07-27T14:00:00.000Z';
    const iphone = JSON.parse(JSON.stringify(base));
    iphone.pagos = [{ id: 'PG-iphone', ts: '2026-07-27T16:00:00.000Z', monto: 38, metodo: 'ATH Móvil' }];
    iphone.abonado = 38; iphone._editedAt = '2026-07-27T16:00:00.000Z';   // el iPhone editó después
    const out = mergeDB({ ordenes: [ipad], settings: {} }, { ordenes: [iphone], settings: {} });
    const o = out.ordenes[0];
    return {
      renglones: (o.pagos || []).length,
      ids: (o.pagos || []).map(p => p.id),
      abonado: o.abonado,
      montos: (o.pagos || []).map(p => p.monto)
    };
  });
  is('el merge conserva los DOS cobros', merge.renglones, 2);
  is('cada uno con su id (unión, no reemplazo)', merge.ids.sort(), ['PG-ipad', 'PG-iphone']);
  num('y el abonado suma los dos ($50 + $38)', merge.abonado, 88);

  // ---------- 4. LAS VERSIONES DE UNA FACTURA REABIERTA TAMPOCO SE PIERDEN ----------
  const vers = await page.evaluate(() => {
    const base = { id: 'RO-703', fecha: new Date().toISOString(), cliente: 'Sara', vehiculo: {}, servicios: [], denegados: [], insp: {}, total: 100, estado: 'pendiente' };
    const a = JSON.parse(JSON.stringify(base));
    a._versiones = [{ ts: '2026-07-27T10:00:00.000Z', motivo: 'error en el total', version: { total: 80 } }];
    a._editedAt = '2026-07-27T10:00:00.000Z';
    const b = JSON.parse(JSON.stringify(base));
    b._versiones = [{ ts: '2026-07-27T12:00:00.000Z', motivo: 'faltaba una pieza', version: { total: 90 } }];
    b._editedAt = '2026-07-27T12:00:00.000Z';
    const out = mergeDB({ ordenes: [a], settings: {} }, { ordenes: [b], settings: {} });
    return (out.ordenes[0]._versiones || []).map(v => v.motivo);
  });
  is('las dos versiones congeladas sobreviven al merge', vers, ['error en el total', 'faltaba una pieza']);

  // ---------- 5. APROBACIÓN DEL ESTIMADO ----------
  const ap = await page.evaluate(() => {
    DB.ordenes = [{
      id: 'RO-704', fecha: new Date().toISOString(), cliente: 'Marta', tel: '', vehiculo: {},
      servicios: [{ id: 's1', uid: 'u1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
      denegados: [{ nombre: 'Rotores', precio: 150 }], insp: {}, total: 223, estado: 'pendiente'
    }];
    saveDB({ force: true });
    const op = window.prompt, oc = window.confirm, oa = window.alert;
    window.prompt = () => 'WhatsApp'; window.confirm = () => true; window.alert = () => { };
    aprobarEstimado('RO-704');
    const o = DB.ordenes[0];
    const antes = { ts: !!o.aprob.ts, canal: o.aprob.canal, total: o.aprob.total, desfasada: aprobDesfasada(o) };
    apruebaDen('RO-704', 0);            // el trabajo crece DESPUÉS de aprobado
    window.prompt = op; window.confirm = oc; window.alert = oa;
    return { antes: antes, totalNuevo: DB.ordenes[0].total, desfasadaDespues: aprobDesfasada(DB.ordenes[0]),
             bita: (DB.bitacora || []).some(b => b.tipo === 'estimado-aprobado') };
  });
  is('la aprobación queda con fecha, canal y monto', [ap.antes.ts, ap.antes.canal, ap.antes.total], [true, 'WhatsApp', 223]);
  is('recién aprobada no está desfasada', ap.antes.desfasada, false);
  num('al aprobar un denegado el total sube', ap.totalNuevo, 390.25);
  is('la app AVISA que el trabajo cambió después de aprobado', ap.desfasadaDespues, true);
  is('y queda en la bitácora', ap.bita, true);

  // ---------- 6. EL INVENTARIO NO MIENTE ----------
  const inv = await page.evaluate(() => {
    DB.inventario = [{ id: 'INV-1', nombre: 'Bujía NGK', sku: 'NGK123', qty: 10, min: 2, costo: 4, precio: 9 }];
    saveDB({ force: true });
    go('ro');
    RO.id = 'RO-800'; RO.cliente = 'Test';
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Tune up', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }];
    openPartsModalRO(0);
    const fill = (n, q) => {
      document.getElementById('pp-name').value = n;
      document.getElementById('pp-num').value = 'NGK123';
      document.getElementById('pp-cost').value = '4';
      document.getElementById('pp-qty').value = String(q);
      document.getElementById('pp-sell').value = '9';
    };
    fill('Bujía NGK', 4); savePartRO();
    const trasAgregar = DB.inventario[0].qty;
    // editar de 4 a 6 tiene que sacar 2 más
    editPartRO(0); fill('Bujía NGK', 6); savePartRO();
    const trasEditar = DB.inventario[0].qty;
    const oc = window.confirm; window.confirm = () => true;
    deletePartRO(0);
    window.confirm = oc;
    return { trasAgregar: trasAgregar, trasEditar: trasEditar, trasBorrar: DB.inventario[0].qty };
  });
  is('agregar 4 bujías las saca del estante (10 → 6)', inv.trasAgregar, 6);
  is('cambiar de 4 a 6 saca 2 más (6 → 4)', inv.trasEditar, 4);
  is('borrar la pieza las DEVUELVE al estante (4 → 10)', inv.trasBorrar, 10);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
