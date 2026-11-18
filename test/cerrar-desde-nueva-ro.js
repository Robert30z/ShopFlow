// CERRAR LA ORDEN DESDE DONDE SE CREO (Boss, 18-nov-2026: "dame la opcion para cuando termine el carro
// poder finalizar el RO desde el mismo sitio que lo creo"; pidio las dos: A y B).
//   A) Al abrir Nueva RO salen las ordenes ABIERTAS con "Cobrar y cerrar" (solo paso 1 de una orden nueva).
//   B) Dentro del asistente, con la orden ya guardada como ABIERTA, sale "Terminé: cobrar y cerrar" en cualquier paso.
// Lo que se vigila: que el boton salga cuando debe y NO cuando no, que cierre de verdad (pagado, en la caja),
// y que cancelar el cobro no cierre nada.
// Usage:  python -m http.server 8931   (raiz del repo) + node cerrar-desde-nueva-ro.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let fail = 0;
const check = (ok, n, d) => { console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); if (!ok) fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; let respuestas = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 200)));
  // prompts del cobro: metodo y monto; confirms: aceptar. Si respuestas trae null, se cancela.
  page.on('dialog', async d => {
    if (d.type() === 'prompt') { const r = respuestas.shift(); if (r === null) await d.dismiss(); else await d.accept(r === undefined ? d.defaultValue() : r); }
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);

  const vis = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, sel);

  // --- Orden nueva, sin abiertas: ni A ni B ---
  await page.evaluate(() => go('ro')); await page.waitForTimeout(400);
  check(!(await vis('#ro-abiertas')), 'A: sin ordenes abiertas no sale el cuadro');
  check(!(await vis('#ro-terminar')), 'B: orden nueva sin guardar no trae el boton de cerrar');

  // --- Llenar y guardar como ABIERTA ---
  await page.fill('#c-n', 'Cliente Prueba');
  await page.evaluate(() => { gotoStep(2); });
  await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first().click();
  await page.evaluate(() => saveOpenRO()); await page.waitForTimeout(500);
  const id = await page.evaluate(() => RO.id);
  check(await vis('#ro-terminar'), 'B: guardada como ABIERTA sale "Terminé: cobrar y cerrar"', id);
  await page.evaluate(() => gotoStep(5)); await page.waitForTimeout(200);
  check(await vis('#ro-terminar'), 'B: sigue saliendo en otro paso (5)');

  // --- B cancelado: no cierra nada ---
  respuestas = [null];
  await page.click('#ro-terminar'); await page.waitForTimeout(500);
  check(await page.evaluate(i => DB.ordenes.find(o => o.id === i).estado, id) === 'abierta', 'B: cancelar el cobro deja la orden ABIERTA');
  check(await vis('#ro-terminar'), 'B: tras cancelar sigues en el asistente con el boton');

  // --- Otra orden nueva: A la ensena ---
  await page.evaluate(() => go('home')); await page.waitForTimeout(200);
  await page.evaluate(() => go('ro')); await page.waitForTimeout(400);
  check(await vis('#ro-abiertas'), 'A: al abrir Nueva RO sale el cuadro de abiertas');
  check((await page.textContent('#ro-abiertas')).includes(id), 'A: la orden abierta sale en la lista', id);
  check(!(await vis('#ro-terminar')), 'B: en la orden nueva NO sale el boton de cerrar');
  await page.evaluate(() => gotoStep(1)); await page.waitForTimeout(200);
  check(!(await vis('#ro-abiertas')), 'A: en el paso 2 el cuadro ya no estorba');
  await page.evaluate(() => gotoStep(0)); await page.waitForTimeout(200);

  // --- A: cobrar y cerrar ---
  respuestas = ['Cash', undefined];
  await page.locator('#ro-abiertas button', { hasText: 'Cobrar y cerrar' }).first().click(); await page.waitForTimeout(700);
  const o = await page.evaluate(i => { const x = DB.ordenes.find(o => o.id === i); return { estado: x.estado, abonado: x.abonado, total: x.total, pago: x.pago }; }, id);
  check(o.estado === 'pagado' && Math.abs(o.abonado - o.total) < 0.01, 'A: la orden queda PAGADA y cobrada completa', o);
  check(await page.evaluate(() => document.getElementById('ro-detail').classList.contains('v')), 'A: termina en el detalle de la orden');

  // --- B de punta a punta: otra orden, guardar abierta, cerrar desde el asistente ---
  await page.evaluate(() => go('ro')); await page.waitForTimeout(400);
  check(!(await vis('#ro-abiertas')), 'A: ya sin abiertas, el cuadro se va');
  await page.fill('#c-n', 'Cliente Dos');
  await page.evaluate(() => gotoStep(2)); await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first().click();
  await page.evaluate(() => saveOpenRO()); await page.waitForTimeout(500);
  const id2 = await page.evaluate(() => RO.id);
  respuestas = ['ATH Móvil', undefined];
  await page.click('#ro-terminar'); await page.waitForTimeout(700);
  const o2 = await page.evaluate(i => { const x = DB.ordenes.find(o => o.id === i); return { estado: x.estado, abonado: x.abonado, total: x.total }; }, id2);
  check(o2.estado === 'pagado' && o2.total > 0 && Math.abs(o2.abonado - o2.total) < 0.01, 'B: cerrada desde el asistente queda PAGADA', o2);
  check(await page.evaluate(() => { try { return !localStorage.getItem('sf_draft'); } catch (e) { return true; } }), 'B: no queda borrador colgando');
  check(await page.evaluate(i => DB.ordenes.filter(o => o.id === i).length, id2) === 1, 'B: no se duplica la orden');

  // --- Codex 18-nov: un boton viejo NO vuelve a cobrar una orden ya cerrada ---
  const antes = await page.evaluate(i => JSON.stringify(DB.ordenes.find(o => o.id === i)), id);
  respuestas = ['Cash', undefined];
  await page.evaluate(i => cerrarAbiertaDesdeLista(i), id); await page.waitForTimeout(300);
  check(await page.evaluate(i => JSON.stringify(DB.ordenes.find(o => o.id === i)), id) === antes, 'Codex: cobrar desde un cuadro viejo no toca una orden ya PAGADA');

  // --- Codex 18-nov: B no cierra una orden sin servicios ---
  await page.evaluate(() => go('ro')); await page.waitForTimeout(400);
  await page.fill('#c-n', 'Sin Servicios');
  await page.evaluate(() => saveOpenRO()); await page.waitForTimeout(400);
  const id3 = await page.evaluate(() => RO.id);
  await page.click('#ro-terminar'); await page.waitForTimeout(400);
  check(await page.evaluate(i => DB.ordenes.find(o => o.id === i).estado, id3) === 'abierta', 'Codex: B no cierra una orden sin servicios');

  check(errs.length === 0, 'Sin errores de JS', errs);
  await browser.close();
  console.log(fail ? '\n' + fail + ' FALLO(S)' : '\nTODO VERDE');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
