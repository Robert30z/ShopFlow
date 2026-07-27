// LO TECLEADO EN UN MODAL TAMPOCO SE PUEDE PERDER.
// Auditoría 2026-07-27 (parte 2), bug 5. El arreglo del 27-jul por la mañana (snapFields/
// restoreFields) solo cubría los campos que viven DENTRO de una página (`.pg.v`). Los dos
// formularios más largos de la app son modales al final del body y quedaron fuera:
//   · piezas de la orden (nombre, # parte, suplidor, costo, cantidad, venta, recibo, fecha)
//   · inventario (11 campos)
// O sea: escribir una pieza parado en el mostrador del suplidor, salir a WhatsApp o contestar
// una llamada, iOS mata Safari, y al volver todo en blanco — exactamente el caso que reventó.
// Lo que NO puede pasar: que un borrador se meta en el servicio o la pieza equivocada.
// Usage:  python -m http.server 8931   (raíz del repo) + node campos-modal.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));

const PIEZA = { 'pp-name': 'Pastillas delanteras cerámicas Akebono', 'pp-num': 'ACT1210', 'pp-sup': 'Advance Auto Parts', 'pp-cost': '38.50', 'pp-qty': '2', 'pp-sell': '72.00', 'pp-receipt': 'ADV-789012' };
const INV = { 'inv-fn': 'Filtro de aceite Fram PH3593A', 'inv-sku': 'PH3593A', 'inv-brand': 'Fram', 'inv-cost': '4.25', 'inv-price': '9.99', 'inv-qty': '12', 'inv-loc': 'Estante A3', 'inv-sup': 'AutoZone' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const read = ids => page.evaluate(list => {
    const o = {}; list.forEach(id => { const el = document.getElementById(id); o[id] = el ? el.value : null; });
    return o;
  }, ids);

  // ---------- 1. NINGÚN CAMPO DE FORMULARIO SE QUEDA FUERA DE LA RED ----------
  const fuera = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[id],textarea[id],select[id]').forEach(el => {
      if (el.type === 'file' || el.type === 'checkbox' || el.type === 'radio') return;
      if (el.closest('.pg')) return;                                  // cubierto por snapFields
      if (el.closest('#parts-modal') || el.closest('#inv-modal')) return; // cubierto por el borrador de modal
      out.push(el.id);
    });
    return out;
  });
  is('no queda ningún campo de formulario fuera de la red', fuera, []);

  // ---------- 2. PIEZAS DE UNA ORDEN: iOS mata la app a media pieza ----------
  await page.evaluate(p => {
    go('ro');
    RO.id = 'RO-99';
    RO.cliente = 'Migdalia Cotto';
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Frenos delanteros', p: 139, ep: 139, qty: 1, parts: [], laborHours: 0 },
                    { id: 's2', uid: 'u2', n: 'Cambio de aceite', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }];
    openPartsModalRO(0);
    Object.keys(p).forEach(id => { document.getElementById(id).value = p[id]; });
    saveFields();          // lo que dispara iOS al mandar Safari al fondo (visibilitychange)
  }, PIEZA);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);

  // al volver, el modal está cerrado: el borrador espera a que se abra EL MISMO
  const otroSvc = await page.evaluate(() => {
    go('ro');
    RO.id = 'RO-99';
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Frenos delanteros', p: 139, ep: 139, qty: 1, parts: [], laborHours: 0 },
                    { id: 's2', uid: 'u2', n: 'Cambio de aceite', p: 100, ep: 100, qty: 1, parts: [], laborHours: 0 }];
    openPartsModalRO(1);   // OTRO servicio: aquí NO se puede reponer nada
    return document.getElementById('pp-name').value;
  });
  is('el borrador NO se mete en el servicio equivocado', otroSvc, '');

  // se cierra el modal a mano (sin clearModalFields) para simular que solo cambió de servicio
  await page.evaluate(() => {
    document.getElementById('parts-modal').style.display = 'none';
    openPartsModalRO(0);
  });
  const got = await read(Object.keys(PIEZA));
  Object.keys(PIEZA).every(k => got[k] === PIEZA[k])
    ? ok('la pieza a medias vuelve completa al reabrir el mismo servicio', got)
    : no('la pieza a medias vuelve completa al reabrir el mismo servicio', got);

  const totales = await page.evaluate(() => ({ tcost: document.getElementById('pp-tcost').textContent, tsell: document.getElementById('pp-tsell').textContent }));
  is('los totales de la pieza se recalculan al reponer', totales, { tcost: '$77.00', tsell: '$144.00' });

  // guardar la pieza descarta el borrador
  const trasGuardar = await page.evaluate(() => {
    savePartRO();
    const s = localStorage.getItem('sf_fields');
    const d = s ? JSON.parse(s) : null;
    return { partes: RO.servicios[0].parts.length, borrador: d && d.m ? d.m.ctx : null, campo: document.getElementById('pp-name').value };
  });
  is('la pieza queda guardada en la orden', trasGuardar.partes, 1);
  is('y el borrador se descarta al guardarla', [trasGuardar.borrador, trasGuardar.campo], [null, '']);

  // ---------- 3. INVENTARIO: mismo trato ----------
  await page.evaluate(v => {
    go('inventario');
    openAddInv();
    Object.keys(v).forEach(id => { document.getElementById(id).value = v[id]; });
    saveFields();
  }, INV);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1600);
  await page.evaluate(() => { go('inventario'); openAddInv(); });
  const gotInv = await read(Object.keys(INV));
  Object.keys(INV).every(k => gotInv[k] === INV[k])
    ? ok('la pieza de inventario a medias vuelve completa', gotInv)
    : no('la pieza de inventario a medias vuelve completa', gotInv);

  const cerrar = await page.evaluate(() => {
    closeInvModal();                    // cerrar a propósito = abandonar
    openAddInv();
    return document.getElementById('inv-fn').value;
  });
  is('cerrar el modal a propósito descarta el borrador', cerrar, '');

  // ---------- 4. LO DE LA PÁGINA SIGUE FUNCIONANDO (no se rompió el arreglo anterior) ----------
  const cita = await page.evaluate(() => {
    go('citas');
    document.getElementById('ct-n').value = 'Pedro Santos';
    document.getElementById('ct-t').value = '787-555-9090';
    saveFields();
    rerenderCurrent();
    return { n: document.getElementById('ct-n').value, t: document.getElementById('ct-t').value };
  });
  is('el formulario de cita sigue protegido', cita, { n: 'Pedro Santos', t: '787-555-9090' });

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
