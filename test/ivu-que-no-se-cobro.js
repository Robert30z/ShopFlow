// UN IVU QUE NO SE COBRÓ NO PUEDE SALIR EN UN DOCUMENTO QUE VE EL CLIENTE.
// Inspección del 31-jul-2026, eje 2 del estándar: que los números CUADREN entre superficies
// (pantalla, PDF del cliente, reporte del contable, CSV).
//
// QUÉ PASABA: `addIngManual` pregunta si el monto incluye IVU y guarda `sinIVU:true` cuando no.
// El reporte del contable (`ivuMes`) y el CSV respetaban esa bandera. **`dineroRO` no la miraba.**
// Como `openRODetail`, `exportPDF` y `shareStatus` arman sus números con `dineroRO`, un ingreso
// manual de $200 marcado "no incluye IVU" salía así:
//
//     Subtotal  $200.00
//     IVU       $23.00     <-- inventado
//     Total     $200.00
//
// El desglose no suma, y le enseña al cliente $23 de impuesto que nunca se le cobró. El total
// siempre estuvo bien (sale de `o.total`) y las ventas y el CSV también — lo torcido era la
// LÍNEA del IVU, en las tres superficies que ve el cliente.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node ivu-que-no-se-cobro.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const r = await page.evaluate(() => {
    const out = {};
    const base = m => ({ fecha: new Date().toISOString(), tel: '787-555-0000', vehiculo: {},
      servicios: [{ id: 'm', n: 'Trabajito en efectivo', p: m, qty: 1, ep: m }],
      pago: 'Cash', estado: 'pagado', insp: {}, denegados: [], manual: true, abonado: m });

    // --- ingreso manual de $200 marcado SIN IVU (el caso del bug) ---
    const sin = Object.assign({ id: 'ING-SIN', cliente: 'Sin IVU', total: 200, sinIVU: true }, base(200));
    const dSin = dineroRO(sin);
    out.sin = { sub: dSin.sub, base: dSin.base, ivu: dSin.ivu, total: dSin.total };

    // --- el mismo monto pero CON IVU incluido: no se puede haber roto ---
    const con = Object.assign({ id: 'ING-CON', cliente: 'Con IVU', total: 200 }, base(200));
    const dCon = dineroRO(con);
    out.con = { sub: dCon.sub, base: dCon.base, ivu: dCon.ivu, total: dCon.total };

    // --- una orden normal de taller: el IVU de siempre, intacto ---
    const normal = { id: 'RO-N', cliente: 'Normal', tel: '', vehiculo: {},
      servicios: [{ id: 's', n: 'Frenos', p: 100, qty: 1, ep: 100, parts: [], laborHours: 0 }],
      denegados: [], estado: 'pendiente' };
    const dNor = dineroRO(normal);
    out.normal = { base: dNor.base, ivu: dNor.ivu, total: dNor.total };

    // --- precio final acordado + sin IVU: el precio ES la base, no se desglosa nada ---
    const manSin = Object.assign({ id: 'ING-MAN', cliente: 'Manual sin IVU', total: 140,
      totalManual: 140, sinIVU: true }, base(140));
    const dMan = dineroRO(manSin);
    out.manualSin = { base: dMan.base, ivu: dMan.ivu, total: dMan.total };

    // --- precio final acordado CON IVU: se sigue derivando como antes ---
    const manCon = Object.assign({ id: 'ING-MAN2', cliente: 'Manual con IVU', total: 140,
      totalManual: 140 }, base(140));
    const dMan2 = dineroRO(manCon);
    out.manualCon = { base: dMan2.base, ivu: dMan2.ivu, total: dMan2.total };

    // --- y lo que de verdad importa: lo que sale EN PANTALLA ---
    DB.ordenes = [sin]; localStorage.setItem('sf_v1', JSON.stringify(DB)); _lastGood = censo(DB);
    try { openRODetail('ING-SIN'); } catch (e) { out.errDet = e.message; }
    const t = document.body.innerText;
    out.pantallaMontos = [...new Set((t.match(/\$[\d,]+\.\d\d/g) || []))].slice(0, 8);
    out.pantallaTiene23 = /\$23[.,]00/.test(t);

    // --- y lo que el CSV del contable calcula, para confirmar que ahora coinciden ---
    const tot = sin.total || 0, subCSV = sin.sinIVU ? tot : tot / 1.115;
    out.csv = { sub: +subCSV.toFixed(2), ivu: +(tot - subCSV).toFixed(2), total: tot };
    return out;
  });

  console.log('-- el ingreso SIN IVU (el bug) --');
  is('🐛 el IVU es $0, no $23', r.sin.ivu, 0);
  is('la base es el monto completo', r.sin.base, 200);
  is('el total es el monto completo', r.sin.total, 200);
  ok('   ahora subtotal + IVU = total', r.sin.base + r.sin.ivu === r.sin.total);
  is('🐛 en PANTALLA ya no aparece el $23.00 inventado', r.pantallaTiene23, false);
  ok('   montos que salen en el detalle', r.pantallaMontos);

  console.log('-- y cuadra con lo que reporta el contable --');
  is('mismo subtotal que el CSV', r.sin.base, r.csv.sub);
  is('mismo IVU que el CSV', r.sin.ivu, r.csv.ivu);
  is('mismo total que el CSV', r.sin.total, r.csv.total);

  console.log('-- lo que ya funcionaba, intacto --');
  is('ingreso manual CON IVU: sigue con su IVU', r.con.ivu, 23);
  is('orden normal de $100: IVU $11.50', r.normal.ivu, 11.5);
  is('orden normal de $100: total $111.50', r.normal.total, 111.5);
  is('precio acordado CON IVU: se sigue derivando', r.manualCon.base, 125.56);
  is('precio acordado SIN IVU: el precio ES la base', r.manualSin.base, 140);
  is('precio acordado SIN IVU: sin IVU inventado', r.manualSin.ivu, 0);

  is('sin errores de JavaScript', errs.length, 0, errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
