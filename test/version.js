// LA VERSIÓN TIENE QUE SER VISIBLE Y TIENE QUE SER VERDAD.
// Roberto lo pidió el 2026-07-28: "anade en algun area que se pueda ver la version".
// El problema real: cuando se despliega un arreglo hay que decirle "recarga dos veces en el iPad",
// y él no tenía NINGUNA forma de saber si agarró. Recargaba y se quedaba con la duda.
//
// Esta prueba vigila dos cosas que se rompen solas con el tiempo:
//   1. `APP_V` (index.html) y `CACHE_V` (sw.js) tienen que decir lo MISMO. Si se desfasan, la app
//      le enseñaría una version que no es la que esta corriendo — peor que no enseñar nada.
//   2. La version sale en pantalla de verdad: pegada a la fecha del encabezado (visible desde
//      cualquier pantalla) y en Ajustes con el detalle.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node version.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  // --- 1. LOS DOS ARCHIVOS DICEN LO MISMO (esto no necesita navegador) ---
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const appV = (html.match(/var APP_V\s*=\s*'(v\d+)'/) || [])[1] || null;
  const swV = ((sw.match(/var CACHE_V\s*=\s*'shopflow-(v\d+)'/) || [])[1]) || null;
  ok('index.html declara APP_V', appV);
  ok('sw.js declara CACHE_V', swV);
  is('APP_V y CACHE_V cuadran (si esto falla, la app miente sobre su version)', appV, swV);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(async () => {
    const hdr = (document.getElementById('hdate') || {}).textContent || '';
    initAjustes();
    await new Promise(r => setTimeout(r, 700));
    const aj = (document.getElementById('set-version') || {}).innerText || '';
    const vi = await versionInfo();
    return { APP_V: window.APP_V, hdr, aj, vi, tieneBoton: typeof forzarActualizar };
  });

  // --- 2. SE VE EN PANTALLA ---
  is('La app expone APP_V', r.APP_V, appV);
  ok('El encabezado enseña la version junto a la fecha', r.hdr);
  is('...y es la version correcta', r.hdr.includes(appV), true);
  is('Ajustes enseña "Versión de la app"', r.aj.includes(appV), true);
  is('Ajustes enseña cual esta guardada en el equipo', /Guardada en el equipo/.test(r.aj), true);
  is('Ajustes enseña de que equipo se trata', r.aj.includes(r.vi.dev), true);
  is('Existe el boton que fuerza la actualizacion', r.tieneBoton, 'function');

  // --- 3. EL DIAGNOSTICO ES HONESTO ---
  // Sin service worker registrado (contexto de prueba) no hay cache: no debe gritar que esta viejo.
  is('Sin cache todavia, no inventa que esta desactualizado', r.vi.alDia, true);
  is('versionInfo reporta la version de la app', r.vi.app, appV);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
