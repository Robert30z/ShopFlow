// La factura tiene que CUADRAR: Subtotal - Descuento + IVU = Total.
// Bug encontrado en la auditoría (2026-07-27): la pantalla de detalle de orden sacaba el
// subtotal SOLO de los servicios, ignorando mano de obra y piezas, y calculaba el IVU sobre
// esa base parcial sin restar el descuento. En cualquier orden con labor o piezas los
// números no cuadraban con el Total de al lado. El PDF del cliente y la planilla de IVU
// del mes SÍ estaban bien — el error vivía solo en la pantalla que Roberto usa para revisar.
// Usage:  python -m http.server 8931   (raíz del repo) + node factura-cuadra.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const money = t => { const m = (t || '').match(/\$([\d,]+\.\d{2})/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; };

// Orden realista: un servicio + 2h de labor + una pieza con markup, y 10% de descuento.
// A mano:  servicio 120 + labor 2×103=206 + pieza 85  = 411
//          descuento 10% = 41.10  ->  base 369.90  ->  IVU 42.54  ->  total 412.44
const ORDEN = {
  id: 'RO-TEST-1', fecha: '2026-07-27', cliente: 'Prueba Factura', estado: 'pagado', pago: 'Cash',
  vehiculo: { year: '2024', make: 'Kia', model: 'Soul' },
  servicios: [{ n: 'Diagnóstico eléctrico', ep: 120, qty: 1, laborHours: 2, parts: [{ name: 'Batería', cost: 60, sellPrice: 85, qty: 1 }] }],
  descuento: 10, descTipo: '%', descValor: 41.10, total: 412.44, insp: {}, denegados: []
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const leido = await page.evaluate(o => {
    DB.settings.laborRate = 103;
    DB.ordenes = DB.ordenes.filter(x => x.id !== o.id).concat([o]);
    openRODetail(o.id);
    // Cada fila es un .er / .tot-bar con dos spans (etiqueta y monto): hay que leer la
    // fila entera, porque innerText del contenedor los parte en líneas distintas.
    const fila = et => {
      const r = [].slice.call(document.querySelectorAll('#ro-detail-body .er, #ro-detail-body .tot-bar'))
        .find(x => x.innerText.replace(/\s+/g, ' ').trim().indexOf(et) === 0);
      return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
    };
    return { subtotal: fila('Subtotal'), ivu: fila('IVU'), total: fila('Total'), desc: fila('Descuento') };
  }, ORDEN);

  const sub = money(leido.subtotal), ivu = money(leido.ivu), tot = money(leido.total), desc = money(leido.desc);

  // 1. El subtotal incluye labor y piezas, no solo el servicio
  sub === 411 ? ok('Subtotal incluye servicio + mano de obra + piezas', { sub })
              : no('Subtotal incluye servicio + mano de obra + piezas', { sub, esperado: 411, leido: leido.subtotal });

  // 2. El IVU se calcula sobre la base DESPUÉS del descuento
  Math.abs(ivu - 42.54) < 0.02 ? ok('IVU 11.5% sobre la base con descuento aplicado', { ivu })
                               : no('IVU 11.5% sobre la base con descuento aplicado', { ivu, esperado: 42.54 });

  // 3. LA PRUEBA QUE IMPORTA: la factura cuadra sola
  const cuadra = sub !== null && ivu !== null && tot !== null && Math.abs((sub - (desc || 0) + ivu) - tot) < 0.02;
  cuadra ? ok('Subtotal − Descuento + IVU = Total', { sub, desc, ivu, tot })
         : no('Subtotal − Descuento + IVU = Total', { sub, desc, ivu, tot, suma: sub - (desc || 0) + ivu });

  // 4. El total mostrado es el que se cobró de verdad
  tot === 412.44 ? ok('El Total mostrado es el que cobró calcEst', { tot })
                 : no('El Total mostrado es el que cobró calcEst', { tot, esperado: 412.44 });

  // 5. Cortesía: el cliente paga $0 y el IVU es $0
  const cort = await page.evaluate(() => {
    const o = DB.ordenes.find(x => x.id === 'RO-TEST-1');
    o.cortesia = true; o.cortesiaValor = 411; o.total = 0;
    openRODetail(o.id);
    // Cada fila es un .er / .tot-bar con dos spans (etiqueta y monto): hay que leer la
    // fila entera, porque innerText del contenedor los parte en líneas distintas.
    const fila = et => {
      const r = [].slice.call(document.querySelectorAll('#ro-detail-body .er, #ro-detail-body .tot-bar'))
        .find(x => x.innerText.replace(/\s+/g, ' ').trim().indexOf(et) === 0);
      return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
    };
    return { ivu: fila('IVU'), total: fila('Total') };
  });
  money(cort.ivu) === 0 && money(cort.total) === 0
    ? ok('Cortesía del taller: IVU $0 y Total $0', cort)
    : no('Cortesía del taller: IVU $0 y Total $0', cort);

  errs.length === 0 ? ok('Sin errores de JavaScript') : no('Sin errores de JavaScript', errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
