// Un formulario a medias NO se puede perder.
// Nació de un caso real (2026-07-27): Roberto estaba llenando una cita nueva, salió a
// WhatsApp a buscar los datos del cliente, y al volver el formulario estaba EN BLANCO.
// Dos causas distintas, las dos se prueban aquí:
//   1. syncPull() -> rerenderCurrent() -> innerHTML nuevo borraba lo tecleado.
//   2. iOS mata Safari en segundo plano y la página recarga desde cero.
// Usage:  python -m http.server 8931   (raíz del repo) + node campos-a-medias.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

const CITA = { 'ct-n': 'Migdalia Cotto', 'ct-t': '787-555-0134', 'ct-v': '2024 Kia Soul', 'ct-s': 'No prende, luces del dash', 'ct-d': 'Urb. Rexville, Bayamón' };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const fill = async () => page.evaluate(c => {
    go('citas');
    Object.keys(c).forEach(id => { document.getElementById(id).value = c[id]; });
  }, CITA);
  const read = async () => page.evaluate(ids => {
    const o = {}; ids.forEach(id => { const el = document.getElementById(id); o[id] = el ? el.value : null; });
    return o;
  }, Object.keys(CITA));
  const same = got => Object.keys(CITA).every(k => got[k] === CITA[k]);

  // --- 1. EL BUG ORIGINAL: la nube re-renderiza mientras escribes ---
  await fill();
  await page.evaluate(() => rerenderCurrent());
  let r = await read();
  same(r) ? ok('rerenderCurrent (sync de la nube) NO borra el formulario', r)
          : no('rerenderCurrent (sync de la nube) NO borra el formulario', r);

  // --- 2. Volver de WhatsApp: la página se esconde y vuelve, y sync corre ---
  await fill();
  await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 60));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    rerenderCurrent();                       // lo que dispara el syncPull al volver
  });
  r = await read();
  same(r) ? ok('Salir a WhatsApp y volver: el formulario sigue lleno', r)
          : no('Salir a WhatsApp y volver: el formulario sigue lleno', r);

  // --- 3. iOS mató la app: recarga completa de la página ---
  await fill();
  await page.evaluate(() => saveFields());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1700);
  await page.evaluate(() => go('citas'));
  r = await read();
  same(r) ? ok('iOS mata la app y recarga: los campos vuelven llenos', r)
          : no('iOS mata la app y recarga: los campos vuelven llenos', r);

  // --- 4. Al agendar de verdad, el borrador se retira (no reaparece la cita vieja) ---
  await page.evaluate(() => { document.getElementById('ct-f').value = '2030-01-15'; saveCita(); });
  await page.waitForTimeout(200);
  r = await read();
  const guardada = await page.evaluate(() => DB.citas.some(c => c.cliente === 'Migdalia Cotto'));
  const vacio = Object.keys(CITA).every(k => !r[k]);
  guardada && vacio ? ok('Al agendar: la cita entra en DB y el formulario queda limpio')
                    : no('Al agendar: la cita entra en DB y el formulario queda limpio', { guardada, r });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1700);
  await page.evaluate(() => go('citas'));
  r = await read();
  Object.keys(CITA).every(k => !r[k]) ? ok('Tras recargar, el borrador ya retirado no revive')
                                      : no('Tras recargar, el borrador ya retirado no revive', r);

  // --- 4b. Tras agendar, el formulario abre en HOY ---
  const hoy = await page.evaluate(() => localDateStr());
  let fecha = await page.evaluate(() => document.getElementById('ct-f').value);
  fecha === hoy ? ok('Tras agendar, la fecha vuelve a HOY', { fecha })
                : no('Tras agendar, la fecha vuelve a HOY', { fecha, hoy });

  // --- 4c. Una fecha YA PASADA nunca revive (agendar en el día equivocado sería peor
  //         que perder el dato: la cita se pierde de la agenda sin que nadie lo note) ---
  // El borrador se inyecta DESPUÉS de recargar: al recargar, pagehide guarda los campos
  // que hay en pantalla y pisaría lo inyectado (que es justo lo que debe hacer).
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1700);
  await page.evaluate(() => {
    localStorage.setItem('sf_fields', JSON.stringify({ v: { 'ct-n': 'Cliente viejo', 'ct-f': '2020-03-01' }, ts: Date.now() }));
    go('citas');
  });
  const rev = await page.evaluate(() => ({ n: document.getElementById('ct-n').value, f: document.getElementById('ct-f').value }));
  rev.n === 'Cliente viejo' && rev.f !== '2020-03-01'
    ? ok('El nombre a medias vuelve, pero una fecha pasada NO', rev)
    : no('El nombre a medias vuelve, pero una fecha pasada NO', rev);
  await page.evaluate(() => { localStorage.removeItem('sf_fields'); document.getElementById('ct-n').value = ''; });

  // --- 5. Los buscadores NO se guardan entre sesiones (un filtro viejo esconde datos) ---
  await page.evaluate(() => { go('inventario'); const q = document.getElementById('inv-q'); if (q) q.value = 'bujia'; saveFields(); });
  let persistido = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_fields') || '{"v":{}}');
    return Object.keys(d.v || {});
  });
  !persistido.includes('inv-q') ? ok('El buscador no se persiste entre sesiones', persistido)
                                : no('El buscador no se persiste entre sesiones', persistido);

  // --- 6. Un formulario distinto (inventario) también queda protegido ---
  await page.evaluate(() => { go('inventario'); const el = document.getElementById('inv-fn'); if (el) el.value = 'Filtro de aceite K&N'; rerenderCurrent(); });
  const inv = await page.evaluate(() => { const el = document.getElementById('inv-fn'); return el ? el.value : null; });
  inv === 'Filtro de aceite K&N' ? ok('Inventario: el arreglo es general, no solo para citas', { inv })
                                 : no('Inventario: el arreglo es general, no solo para citas', { inv });

  // --- 7. Nada se rompió por el camino ---
  errs.length === 0 ? ok('Sin errores de JavaScript') : no('Sin errores de JavaScript', errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
