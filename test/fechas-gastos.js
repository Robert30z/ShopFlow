// Un gasto cae en el MES en que se registró — en Puerto Rico, no en UTC.
// Bug de auditoría (2026-07-27): la fecha de un gasto se guarda como "YYYY-MM-DD" (viene
// de un <input type="date">). Pasada cruda a new Date() se lee como MEDIANOCHE UTC, que en
// PR (UTC-4) cae el día anterior a las 8:00 PM. Resultado: un gasto del día 1 se contaba en
// el MES PASADO en el P&L y en la lista mensual — pero el CSV del contable sí lo ponía bien
// (ese ya usaba T12:00:00). O sea: la app y el contable no cuadraban.
// Segundo bug del mismo origen: la fecha por defecto del formulario salía de toISOString(),
// así que un gasto registrado de noche nacía fechado MAÑANA.
// Usage:  python -m http.server 8931   (raíz del repo) + node fechas-gastos.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  // Zona horaria de Puerto Rico: sin esto el bug no se reproduce en una máquina en UTC.
  const ctx = await browser.newContext({ timezoneId: 'America/Puerto_Rico' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // --- 1. El día 1 de un mes pertenece a ESE mes, no al anterior ---
  const r1 = await page.evaluate(() => {
    const d = dDia('2026-08-01');
    return { mes: d.getMonth(), anio: d.getFullYear(), dia: d.getDate() };
  });
  r1.mes === 7 && r1.dia === 1
    ? ok('Un gasto del 1-ago cuenta en AGOSTO', r1)
    : no('Un gasto del 1-ago cuenta en AGOSTO', { ...r1, esperado: 'mes 7, dia 1' });

  // --- 2. El P&L del mes y el CSV del contable dan el MISMO total ---
  const r2 = await page.evaluate(() => {
    const hoy = new Date();
    const y = hoy.getFullYear(), m = hoy.getMonth();
    const primero = y + '-' + ('0' + (m + 1)).slice(-2) + '-01';
    DB.gastos = [{ id: 'G-TEST', desc: 'Prueba dia 1', cat: 'Otro', monto: 500, fecha: primero }];
    const enPL = DB.gastos.filter(g => { const d = dDia(g.fecha); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((s, g) => s + g.monto, 0);
    const csv = buildContableCSV(y + '-' + ('0' + (m + 1)).slice(-2));
    const linea = csv.split('\n').find(l => l.indexOf('Prueba dia 1') >= 0);
    return { enPL, enCSV: !!linea, primero };
  });
  r2.enPL === 500 && r2.enCSV
    ? ok('El gasto del día 1 sale igual en el P&L y en el CSV del contable', r2)
    : no('El gasto del día 1 sale igual en el P&L y en el CSV del contable', r2);

  // --- 3. De noche en PR, el formulario propone HOY y no mañana ---
  const r3 = await page.evaluate(() => {
    go('finanzas'); renderGas();
    const el = document.getElementById('gf');
    return { propuesta: el ? el.value : null, hoyLocal: localDateStr() };
  });
  r3.propuesta === r3.hoyLocal
    ? ok('La fecha por defecto del gasto es HOY en hora de PR', r3)
    : no('La fecha por defecto del gasto es HOY en hora de PR', r3);

  // --- 4. Las fechas de ORDEN son timestamp completo: no se tocan y siguen exactas ---
  const r4 = await page.evaluate(() => {
    const iso = new Date().toISOString();
    return { igual: dDia(iso).getTime() === new Date(iso).getTime() };
  });
  r4.igual ? ok('El helper no altera las fechas de orden (timestamp completo)', r4)
           : no('El helper no altera las fechas de orden (timestamp completo)', r4);

  errs.length === 0 ? ok('Sin errores de JavaScript') : no('Sin errores de JavaScript', errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
