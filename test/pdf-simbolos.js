// LOS SIMBOLOS NO PUEDEN DANAR UNA LINEA DEL PDF.
// Roberto lo vio el 2026-11-17 en la RO-9 real: "Estado: #ó PENDIENTE" y "Odometro: 324160 !' 324160 mi".
// Causa: la fuente de jsPDF (Helvetica / WinAnsi) no tiene flechas, palomitas ni emojis. Si una linea trae uno,
// jsPDF la escribe como UTF-16 y la linea entera sale con basura y las letras separadas.
// Arreglo: todo texto del PDF pasa por pdfSeguro() (nuevoPDF() envuelve doc.text y splitTextToSize).
//
// Usage:  python -m http.server 8931   (raiz del repo) + node pdf-simbolos.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  is('ningun PDF se crea sin pasar por nuevoPDF()', (html.match(/new window\.jspdf\.jsPDF\(\)/g) || []).length, 1);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.jspdf !== 'undefined', null, { timeout: 15000 });

  const r = await page.evaluate(() => {
    const out = {};
    out.estado = pdfSeguro('Método: ATH Móvil  ·  Estado: ⏳ PENDIENTE');
    out.odo = pdfSeguro('Odómetro: 324160 → 324160 mi');
    out.emoji = pdfSeguro('Cliente dice 🚗💨 que chilla ✓');
    out.acentos = pdfSeguro('Ñame, pingüino, cotización — “ok” • 30 días… $1,000');
    out.arr = pdfSeguro(['a → b', '✓ listo']);
    out.num = pdfSeguro(12);
    out.inicio = pdfSeguro('✓ PAGADO');
    out.doble = pdfSeguro('Método: X  ·  Estado: Y');
    out.sentido = pdfSeguro('❌ COMPRAR · Bobina 4Ω · Presión ≤ 30 psi · Dado 1⁄2 · motor↔transmisión');
    out.nfd = pdfSeguro('José Muñoz');
    out.raro = pdfSeguro('李 Lee');
    out.vieja = (function(){var d=nuevoPDF();d.text(14,20,'Estado: ⏳ PENDIENTE');return d.output().indexOf('(Estado: PENDIENTE)')>=0;})();
    // un PDF de verdad con lo peor: que no explote y que el texto salga en una sola pieza legible
    const doc = nuevoPDF();
    doc.text('Estado: ⏳ PENDIENTE 🚗', 14, 20);
    doc.text(['Odómetro: 1 → 2', 'ok'], 14, 30);
    const lineas = doc.splitTextToSize('Queja 🔥 '.repeat(30), 100);
    out.lineasSinEmoji = lineas.every(l => !/[\u{1F000}-\u{1FFFF}]/u.test(l));
    const raw = doc.output();
    out.rawTieneEstadoLimpio = raw.indexOf('(Estado: PENDIENTE)') >= 0;
    out.rawTieneOdo = raw.indexOf('(Od\\363metro: 1 -> 2)') >= 0 || raw.indexOf('(Odómetro: 1 -> 2)') >= 0;
    return out;
  });
  is('Estado sin reloj de arena', r.estado, 'Método: ATH Móvil  ·  Estado: PENDIENTE');
  is('Odometro con flecha de texto', r.odo, 'Odómetro: 324160 -> 324160 mi');
  is('emojis del cliente fuera, palomita = OK', r.emoji, 'Cliente dice que chilla OK');
  is('acentos, ñ, comillas, raya, punto y elipsis se quedan', r.acentos, 'Ñame, pingüino, cotización — “ok” • 30 días… $1,000');
  is('arreglos de lineas tambien', JSON.stringify(r.arr), JSON.stringify(['a -> b', 'OK listo']));
  is('numeros pasan igual', r.num, 12);
  is('palomita al principio = OK', r.inicio, 'OK PAGADO');
  is('los dobles espacios a proposito se quedan', r.doble, 'Método: X  ·  Estado: Y');
  is('lo que cambia el sentido no se borra', r.sentido, 'NO COMPRAR · Bobina 4ohm · Presión <= 30 psi · Dado 1/2 · motor<->transmisión');
  is('acentos sueltos se juntan (José Muñoz)', r.nfd, 'José Muñoz');
  is('letra que la fuente no tiene se marca con ?', r.raro, '? Lee');
  r.vieja ? ok('firma vieja text(x,y,txt) tambien se limpia') : no('firma vieja text(x,y,txt) sin limpiar');
  r.lineasSinEmoji ? ok('splitTextToSize sin emojis') : no('splitTextToSize dejo un emoji');
  r.rawTieneEstadoLimpio ? ok('el PDF escribe "Estado: PENDIENTE" en una pieza') : no('el PDF no trae "Estado: PENDIENTE" limpio');
  r.rawTieneOdo ? ok('el PDF escribe el odometro con ->') : no('el PDF no trae el odometro limpio');
  is('sin errores de pagina', errs.length, 0);

  await browser.close();
  console.log('\n' + pass + ' pasan, ' + fail + ' fallan');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
