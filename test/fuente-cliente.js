// "¿Cómo nos encontró?" en Nueva RO (v42, 28-oct). Pedido del Boss: medir de dónde salen los clientes.
// Usage:  python -m http.server 8931   (raíz del repo) + node fuente-cliente.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => go('ro'));
  await page.waitForTimeout(800);

  // 1. Los 7 botones salen en el paso del cliente, y nada viene marcado
  let r = await page.evaluate(() => ({ n: document.querySelectorAll('#ro-fuente button').length, fuente: RO.fuente,
    marcados: document.querySelectorAll('#ro-fuente button.blue').length }));
  r.n === 7 && r.fuente === '' && r.marcados === 0 ? ok('Salen 7 botones y ninguno marcado', r) : no('Salen 7 botones y ninguno marcado', r);

  // 2. Tocar uno lo marca y lo guarda en la orden
  await page.locator('#ro-fuente button', { hasText: 'Grupo de FB' }).click();
  r = await page.evaluate(() => ({ fuente: RO.fuente, marcado: [...document.querySelectorAll('#ro-fuente button.blue')].map(b => b.innerText) }));
  r.fuente === 'Grupo de FB' && r.marcado.join() === 'Grupo de FB' ? ok('Tocar "Grupo de FB" lo marca', r) : no('Tocar "Grupo de FB" lo marca', r);

  // 3. Tocar otro cambia; tocar el mismo otra vez lo quita
  await page.locator('#ro-fuente button', { hasText: 'Página FB' }).click();
  let a = await page.evaluate(() => RO.fuente);
  await page.locator('#ro-fuente button', { hasText: 'Página FB' }).click();
  let b = await page.evaluate(() => RO.fuente);
  a === 'Página FB' && b === '' ? ok('Cambiar y quitar funciona', { a, b }) : no('Cambiar y quitar funciona', { a, b });

  // 4. Se guarda con la orden y vuelve a salir marcado al reabrir el paso
  await page.locator('#ro-fuente button', { hasText: 'Referido' }).click();
  r = await page.evaluate(() => {
    RO.cliente = 'Prueba Fuente'; upsertRO();
    const o = DB.ordenes.find(x => x.cliente === 'Prueba Fuente');
    document.getElementById('ro-fuente').innerHTML = ''; fillROInputs();
    return { guardado: o && o.fuente, remarcado: [...document.querySelectorAll('#ro-fuente button.blue')].map(b => b.innerText).join() };
  });
  r.guardado === 'Referido' && r.remarcado === 'Referido' ? ok('Se guarda en la orden y se vuelve a pintar', r) : no('Se guarda en la orden y se vuelve a pintar', r);

  // 5. Los botones se pueden tocar con el dedo (44 px)
  const alto = await page.locator('#ro-fuente button').first().evaluate(e => e.getBoundingClientRect().height);
  alto >= 44 ? ok('Botones de 44 px o más', alto) : no('Botones de 44 px o más', alto);

  errs.length ? no('Sin errores de JS', errs) : ok('Sin errores de JS');
  await page.screenshot({ path: __dirname + '/fuente-cliente.png' });
  await browser.close();
  console.log(`\n${pass} pasan, ${fail} fallan`);
  process.exit(fail ? 1 : 0);
})();
