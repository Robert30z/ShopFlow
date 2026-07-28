// LA APP ABIERTA DOS VECES EN EL MISMO EQUIPO NO SE PUEDE PISAR A SÍ MISMA.
// Batch 17 (27-jul), sonda creativa. Escenario real y nada raro: la PWA instalada en el iPad Y
// Safari con la app abierta, o dos ventanas. Medido antes del arreglo:
//   pestaña A crea una orden y guarda (disco: 2 órdenes) → pestaña B, que cargó ANTES y no sabe
//   nada, cambia el teléfono en Ajustes y guarda → disco queda con 1 orden. **La orden de A
//   desaparece sin un solo aviso** y saveDB devuelve éxito.
// El guard no lo veía: compara contra su propia memoria, no contra lo que hay escrito en disco.
// Usage:  python -m http.server 8931   (raíz del repo) + node dos-pestanas.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();          // MISMO equipo = mismo localStorage
  const A = await ctx.newPage(), B = await ctx.newPage();
  const errs = [];
  A.on('pageerror', e => errs.push('A: ' + e.message));
  B.on('pageerror', e => errs.push('B: ' + e.message));

  await A.goto(BASE, { waitUntil: 'load' }); await A.waitForTimeout(1400);
  await A.evaluate(() => {
    DB.ordenes = [{ id: 'RO-1', fecha: new Date().toISOString(), cliente: 'Base', vehiculo: {}, servicios: [], denegados: [], insp: {}, total: 100, estado: 'pendiente' }];
    DB.clientes = []; DB.papelera = []; saveDB({ force: true });
  });
  // B abre la app AHORA (ve 1 orden) y se queda abierta en Ajustes
  await B.goto(BASE, { waitUntil: 'load' }); await B.waitForTimeout(1400);

  // A atiende un cliente: crea orden con firma y fotos, y cobra
  await A.evaluate(() => {
    DB.ordenes.push({ id: 'RO-2', fecha: new Date().toISOString(), cliente: 'Cliente de la pestaña A',
      tel: '7875551234', vehiculo: { year: '2020', make: 'Kia', model: 'Forte' },
      servicios: [{ id: 's1', uid: 'u1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
      denegados: [], insp: {}, total: 223, estado: 'pendiente',
      sigData: { sig1: 'data:image/png;base64,AAA' }, fotos: [],
      pagos: [{ id: 'PG-A', ts: new Date().toISOString(), monto: 100, metodo: 'ATH Móvil' }], abonado: 100 });
    saveDB();
  });

  // B guarda un cambio inocente sin saber nada de RO-2
  const r = await B.evaluate(() => {
    DB.settings.shopPhone = '787-000-0000';
    const guardo = saveDB();
    const disco = JSON.parse(localStorage.getItem('sf_v1') || '{}');
    const ro2 = (disco.ordenes || []).find(o => o.id === 'RO-2');
    return {
      guardo: guardo,
      ids: (disco.ordenes || []).map(o => o.id),
      ro2Existe: !!ro2,
      ro2Firma: !!(ro2 && ro2.sigData && ro2.sigData.sig1),
      ro2Pagos: ((ro2 || {}).pagos || []).length,
      telefonoDeB: (disco.settings || {}).shopPhone,
      bitacora: (disco.bitacora || []).some(x => x.tipo === 'otra-pestana')
    };
  });
  is('el guardado de la otra pestaña funciona', r.guardo, true);
  is('la orden creada en la pestaña A SOBREVIVE', r.ro2Existe, true);
  is('las dos órdenes quedan en disco', r.ids.sort(), ['RO-1', 'RO-2']);
  is('con su firma intacta', r.ro2Firma, true);
  is('y su pago intacto', r.ro2Pagos, 1);
  is('el cambio de la pestaña B también se guarda', r.telefonoDeB, '787-000-0000');
  is('queda anotado en la bitácora que hubo dos ventanas', r.bitacora, true);

  // Y al revés: A guarda después de que B escribió
  const r2 = await A.evaluate(() => {
    DB.ordenes.push({ id: 'RO-3', fecha: new Date().toISOString(), cliente: 'Otra de A', vehiculo: {}, servicios: [], denegados: [], insp: {}, total: 50, estado: 'pendiente' });
    saveDB();
    const disco = JSON.parse(localStorage.getItem('sf_v1') || '{}');
    return { ids: (disco.ordenes || []).map(o => o.id).sort(), tel: (disco.settings || {}).shopPhone };
  });
  is('A guarda después y no pierde lo de B', r2.ids, ['RO-1', 'RO-2', 'RO-3']);
  is('el ajuste que hizo B sigue puesto', r2.tel, '787-000-0000');

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
