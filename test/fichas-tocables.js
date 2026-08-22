// LAS FICHAS DE ARRIBA SE TOCAN Y TE LLEVAN A DONDE ES.
// Lo pidió Roberto el 22-ago-2026: "que las letras grandes de x cobrar hoy taller que están
// en la parte de arriba los pueda tocar y me lleven a donde es".
//
// Dos cosas se prueban:
//   1. CADA ficha del home navega a SU pantalla: Hoy -> Historial (resumen del día),
//      Taller -> Garage, x Cobrar -> Órdenes y Ordenes -> Órdenes.
//   2. CON LAS LETRAS GRANDES DEL SISTEMA las fichas siguen enteras y tocables: simulando el
//      escalado como en letras-grandes.js (multiplicar cada font-size calculado), el grid no
//      se sale de la pantalla y el click sigue funcionando.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node fichas-tocables.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' - ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' - ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  // Un teléfono de verdad, que es donde él la usa.
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // --- 1. CADA FICHA A SU PANTALLA ---
  const mapa = [
    ['h-hoy', 'historial'],
    ['h-taller', 'garage'],
    ['h-cobrar', 'ordenes'],
    ['h-ords', 'ordenes']
  ];
  for (const [id, destino] of mapa) {
    await page.evaluate(() => go('home'));
    await page.waitForTimeout(150);
    await page.click('#' + id);
    await page.waitForTimeout(250);
    const r = await page.evaluate(([destino]) => {
      const dest = document.getElementById(destino);
      return { va: !!(dest && dest.classList.contains('v')), homeFuera: !document.getElementById('home').classList.contains('v') };
    }, [destino]);
    if (r.va && r.homeFuera) ok('ficha #' + id + ' lleva a ' + destino, r);
    else no('ficha #' + id + ' NO lleva a ' + destino, r);
  }

  // --- 2. CON LETRAS GRANDES SIGUEN ENTERAS Y TOCABLES ---
  await page.evaluate(() => go('home'));
  await page.waitForTimeout(200);
  const m = await page.evaluate(() => {
    document.querySelectorAll('*').forEach(function (el) {
      if (!el._fsBase) el._fsBase = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (el._fsBase) el.style.fontSize = (el._fsBase * 2) + 'px';
    });
    var grid = document.getElementById('h-hoy').parentElement.parentElement; // .sg de las fichas
    var gr = grid.getBoundingClientRect();
    return {
      anchoGrid: Math.round(gr.width),
      anchoVentana: window.innerWidth,
      cortado: Math.round(gr.right - window.innerWidth), // >0 = se sale por la derecha
      filas: getComputedStyle(grid).gridTemplateRows.split(' ').length,
      cols: getComputedStyle(grid).gridTemplateColumns.split(' ').length
    };
  });
  if (m.cortado <= 0) ok('a 2x de letra el grid de fichas NO se corta por la derecha', m);
  else no('a 2x de letra el grid de fichas se SALE por la derecha', m);

  // El click sobrevive al escalado (el bloque no se reconstruye: los ids persisten).
  await page.click('#h-cobrar');
  await page.waitForTimeout(250);
  const r2 = await page.evaluate(() => ({
    va: document.getElementById('ordenes').classList.contains('v'),
    homeFuera: !document.getElementById('home').classList.contains('v')
  }));
  if (r2.va && r2.homeFuera) ok('a 2x de letra la ficha #h-cobrar SÍ navega a ordenes', r2);
  else no('a 2x de letra la ficha #h-cobrar dejó de navegar', r2);

  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(function (el) { el.style.fontSize = ''; });
  });

  if (errs.length) no('errores de JS en consola', errs); else ok('sin errores de JS');
  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' - ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) process.exitCode = 1;
  if (fail) process.exitCode = 1;
  await browser.close();
})();
