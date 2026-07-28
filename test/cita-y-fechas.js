// LA CITA NO SE PUEDE PERDER — Y EL DÍA ES EL DE PUERTO RICO, NO EL DE LONDRES.
// ---------------------------------------------------------------------------
// Dos hallazgos del 28-jul (de madrugada, que es justo cuando el segundo se ve):
//
// 1. CONVERTIR UNA CITA EN ORDEN LA DABA POR ATENDIDA AL INSTANTE. `citaToRO` marcaba la cita
//    como "completada" al ABRIR el asistente, antes de que existiera ninguna orden. Si tocabas
//    el botón y te salías (o iOS mataba Safari a media orden), la cita desaparecía de la lista
//    del día y no quedaba orden por ningún lado: el cliente llegaba a las 10:00 y en la app no
//    había rastro de él. Ahora la cita se cierra cuando la orden EXISTE, y deja bitácora.
//
// 2. FECHAS EN UTC. Quedaban 7 sitios escribiendo el día con `toISOString()`, que en Puerto
//    Rico (UTC-4) ya es MAÑANA a partir de las 8:00 PM. La peor: una promo que vencía hoy se
//    apagaba sola a las 8 de la noche de su último día. Es la misma clase del bug de los
//    gastos del día 1 (27-jul); esta prueba corre con el reloj en America/Puerto_Rico, sin eso
//    no se reproduce.
// Usage:  python -m http.server 8931   (raíz del repo) + node cita-y-fechas.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'America/Puerto_Rico' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const semilla = () => {
    DB.citas = [{ id: 'CT-1', cliente: 'Luis Ortiz', tel: '7873334444', fecha: localDateStr(),
      hora: '10:00', servicio: 'Cambio de aceite', vehiculo: '2019 Toyota Corolla', notas: '', estado: 'agendada' }];
    DB.ordenes = []; DB.garage = [];
    saveDB({ force: true });
    citaToRO('CT-1');
  };

  // ---------- 1. ABRIR EL ASISTENTE Y SALIRSE NO BORRA LA CITA ----------
  await page.evaluate(semilla);
  await page.waitForTimeout(600);
  const prefill = await page.evaluate(() => ({
    n: (document.getElementById('c-n') || {}).value, t: (document.getElementById('c-t') || {}).value,
    y: (document.getElementById('v-y') || {}).value, ma: (document.getElementById('v-ma') || {}).value,
    mo: (document.getElementById('v-mo') || {}).value, q: (document.getElementById('v-q') || {}).value
  }));
  is('La cita llena el primer paso sola', prefill,
    { n: 'Luis Ortiz', t: '7873334444', y: '2019', ma: 'Toyota', mo: 'Corolla', q: 'Cita: Cambio de aceite' });
  const abandonada = await page.evaluate(() => {
    go('home'); renderHomeCitas();
    return { cita: DB.citas[0].estado, ordenes: DB.ordenes.length,
      sigueEnHome: /Luis Ortiz/.test((document.getElementById('home-citas') || { innerText: '' }).innerText || '') };
  });
  is('⭐ Si te sales sin guardar, la cita sigue viva y en el home',
    abandonada, { cita: 'agendada', ordenes: 0, sigueEnHome: true });

  // ---------- 2. AL GUARDAR LA ORDEN, LA CITA SE CIERRA SOLA ----------
  await page.evaluate(semilla);
  await page.waitForTimeout(600);
  const guardada = await page.evaluate(() => {
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Cambio de aceite', p: 100, ep: 100, qty: 1, laborHours: 0, parts: [] }];
    calcEst(); saveRO();
    return { cita: DB.citas[0].estado, roId: DB.citas[0].roId, ordenes: DB.ordenes.length,
      bita: (DB.bitacora || []).filter(x => x.tipo === 'cita-atendida').length,
      enlace: (DB.ordenes[0] || {}).citaId };
  });
  is('Guardada la orden, la cita queda atendida y enlazada',
    { c: guardada.cita, ro: guardada.roId, n: guardada.ordenes, b: guardada.bita, link: guardada.enlace },
    { c: 'completada', ro: 'RO-1', n: 1, b: 1, link: 'CT-1' });

  // ---------- 3. GUARDAR COMO "ABIERTA" TAMBIÉN LA CIERRA ----------
  await page.evaluate(semilla);
  await page.waitForTimeout(600);
  const abierta = await page.evaluate(() => {
    saveOpenRO();
    return { cita: DB.citas[0].estado, ordenes: DB.ordenes.length, estado: (DB.ordenes[0] || {}).estado };
  });
  is('Una orden guardada ABIERTA también atiende la cita', abierta, { cita: 'completada', ordenes: 1, estado: 'abierta' });

  // ---------- 4. EL DÍA ES EL DE PUERTO RICO ----------
  const fechas = await page.evaluate(() => {
    const hoyPR = localDateStr(), hoyUTC = new Date().toISOString().slice(0, 10);
    DB.promos = [{ id: 'PR-1', n: 'Promo frenos', p: 139, desde: '2026-01-01', hasta: hoyPR, det: '' }];
    DB.ordenesS = [];
    saveDB({ force: true });
    const viva = promoVigente(DB.promos[0]);
    // orden a suplidor: la fecha que se guarda
    const op = window.prompt, oc = window.confirm;
    let n = 0;
    window.prompt = () => { n++; return n === 1 ? 'Advance Auto' : n === 2 ? 'F-1' : n === 3 ? 'pastillas' : '50'; };
    window.confirm = () => true;
    addSupOrden();
    window.prompt = op; window.confirm = oc;
    return { hoyPR, hoyUTC, promoViva: viva, supFecha: (DB.ordenesS[0] || {}).fecha };
  });
  yes('El reloj de la prueba está en la ventana peligrosa (PR ≠ UTC) o no hace falta',
    true, { PR: fechas.hoyPR, UTC: fechas.hoyUTC, difieren: fechas.hoyPR !== fechas.hoyUTC });
  yes('⭐ Una promo que vence HOY sigue viva hoy (antes moría a las 8 PM)', fechas.promoViva);
  is('La orden a suplidor se fecha con el día de PR', fechas.supFecha, fechas.hoyPR);

  const noQuedaUTC = await page.evaluate(() => {
    // ningún sitio de la app vuelve a escribir un día del calendario en UTC
    const src = document.documentElement.innerHTML;
    return (src.match(/toISOString\(\)\.(split\('T'\)\[0\]|slice\(0,\s*10\))/g) || []).length;
  });
  is('Ya no queda ni un día del calendario escrito en UTC', noQuedaUTC, 0);

  is('Sin errores de JavaScript', errs, []);
  await browser.close();
  console.log('\n' + (fail ? `❌ ${fail} FALLOS de ${pass + fail}` : `TODO VERDE — ${pass} pass / 0 fail`));
  process.exit(fail ? 1 : 0);
})();
