// EL SERVICE WORKER NO GUARDA UNA PAGINA DE ERROR COMO LA APP (Codex 16-nov #11, arreglado 18-nov).
// Antes: si GitHub Pages daba un 503 un momento, ese error reemplazaba index.html en el cache y,
// sin internet, la app abria la pagina de error en vez de ShopFlow.
// Usage:  python -m http.server 8931 (raiz del repo) + node sw-no-guarda-error.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let fail = 0;
const check = (ok, n, d) => { console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); if (!ok) fail++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);   // ahora la pagina pasa por el SW
  const leer = () => page.evaluate(async () => { const ks = await caches.keys(); for (const k of ks) { const r = await (await caches.open(k)).match('./index.html'); if (r) return (await r.text()).slice(0, 4000); } return ''; });
  const bueno = await leer();
  check(bueno.includes('ShopFlow'), 'el shell bueno quedo en el cache', bueno.length);
  // el servidor "se cae": el navegador recibe 503 para la app
  await ctx.route('**/index.html', r => r.fulfill({ status: 503, contentType: 'text/html', body: '<h1>503 Service Unavailable</h1>' }));
  await page.goto(BASE, { waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(1500);
  await ctx.unroute('**/index.html');
  const despues = await leer();
  check(despues.includes('ShopFlow') && !despues.includes('503 Service'), 'un 503 NO reemplaza el shell bueno del cache');
  await browser.close();
  console.log(fail ? '\n' + fail + ' FALLO(S)' : '\nTODO VERDE'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
