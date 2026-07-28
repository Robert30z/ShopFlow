// EL BUSCADOR TIENE QUE ENCONTRAR — Y EL CATÁLOGO TIENE QUE ESTAR EN ESPAÑOL.
// ---------------------------------------------------------------------------
// Salió corriendo una orden completa como la corre Roberto (28-jul). En el paso de Servicios
// escribí "freno" y la pantalla se quedó EN BLANCO. Dos causas, las dos de fondo:
//  1. El catálogo de fábrica estaba en INGLÉS ("Front Brake Service", "Battery Replacement")
//     dentro de una app en español para un taller en Bayamón: "freno", "batería", "alternador"
//     y "goma" daban CERO resultados en las 10 categorías.
//  2. La caja que dice "Buscar servicio" solo buscaba dentro de la categoría ABIERTA. Con
//     "Aceite y filtro" al frente, buscar "freno" no podía encontrar nada aunque existiera —
//     y sin resultados no salía ni un mensaje: parecía que la app se colgó.
// Y de paso: el catálogo cotizaba el aceite a $45 cuando su precio real es $100 (el sintético
// $75 contra $140). Cotizar por el catálogo era regalar la mitad del trabajo.
// La búsqueda además ignora acentos EN TODAS PARTES: nadie escribe "batería" con tilde en un
// buscador, ni "Ramón" para buscar a Ramón.
// Usage:  python -m http.server 8931   (raíz del repo) + node buscador.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. EL CATÁLOGO DE FÁBRICA HABLA ESPAÑOL ----------
  const cat = await page.evaluate(() => {
    const todos = [];
    allCats().forEach(c => getSvcs(c.id).forEach(s => todos.push({ cat: c.l, n: s.n, p: s.p, id: s.id })));
    // Los nombres viejos, tal cual estaban. (Se dejan a propósito términos que en el taller se
    // dicen en inglés — "flush", "power steering", "tune-up" — pero siempre dentro de una frase
    // en español, para que la búsqueda los encuentre por los dos lados.)
    const viejos = ['Front Brake Service','Rear Brake Service','Brake Fluid Flush','Battery Replacement',
      'Alternator Replacement','Starter Replacement','Spark Plug Replacement','OBD-II Diagnostic',
      'Mantenimiento Basico de Aceite y Filtro','Tire Rotation','Mount & Balance','Pre-Purchase Inspection',
      'General Labor / Custom Job','Coolant Flush','Water Pump Replacement','Timing Belt Service',
      'Wheel Alignment (sublet)','A/C Service & Recharge','Transmission Fluid Service'];
    const ingles = todos.filter(s => viejos.indexOf(s.n) >= 0).map(s => s.n);
    return { total: todos.length, ingles: ingles,
      cats: allCats().map(c => c.l),
      aceiteReg: (todos.find(s => s.id === 'a1') || {}).p,
      aceiteSint: (todos.find(s => s.id === 'a2') || {}).p,
      diag: (todos.find(s => s.id === 'd1') || {}).p,
      bateria: (todos.find(s => s.id === 'e1') || {}).p,
      preCompra: (todos.find(s => s.id === 'd2') || {}).p };
  });
  is('Ni un servicio de fábrica quedó en inglés', cat.ingles, []);
  is('Las categorías también están en español', cat.cats.slice(0, 4), ['Aceite y filtro', 'Frenos', 'Suspensión', 'A/C']);
  // Los precios de la guía de Pit Stop (HQ\Pit Stop\PRECIOS-LABOR.md). El del aceite es regla dura:
  // "el aceite NUNCA se anuncia por debajo de $100/$140" — y el catálogo decía $45/$75.
  is('⭐ El aceite cotiza SU precio, no la mitad', { reg: cat.aceiteReg, sint: cat.aceiteSint }, { reg: 100, sint: 140 });
  is('Diagnóstico desde $60, batería desde $45, pre-compra desde $80',
    { d: cat.diag, b: cat.bateria, p: cat.preCompra }, { d: 60, b: 45, p: 80 });

  // ---------- 2. BUSCAR ENCUENTRA EN TODO EL CATÁLOGO ----------
  await page.click('#home .mc');
  await page.click('#ro-next'); await page.click('#ro-next');
  await page.waitForTimeout(400);
  const catInicial = await page.evaluate(() => activeCat);
  const buscar = async q => {
    await page.fill('#ro-sq', q);
    await page.waitForTimeout(180);
    return page.evaluate(() => ({
      n: document.querySelectorAll('#ro-sl .svc-row').length,
      txt: (document.getElementById('ro-sl').innerText || '').split('\n').slice(0, 2).join(' / ')
    }));
  };
  is('Se arranca en otra categoría (como llega el usuario)', catInicial, 'aceites');
  const freno = await buscar('freno');
  yes('⭐ "freno" encuentra los frenos aunque esté abierto "Aceite y filtro"', freno.n >= 4, freno);
  const bat = await buscar('bateria');
  yes('⭐ "bateria" sin tilde encuentra "batería"', bat.n >= 1, bat);
  const batTilde = await buscar('batería');
  yes('Y con tilde también', batTilde.n >= 1, batTilde);
  const mayus = await buscar('ACEITE');
  yes('En mayúsculas igual', mayus.n >= 2, mayus);
  const goma = await buscar('goma');
  yes('"goma" encuentra las de gomas (nadie busca "tire")', goma.n >= 2, goma);
  const alt = await buscar('alternador');
  yes('"alternador" aparece', alt.n >= 1, alt);
  const nada = await buscar('zzzz');
  is('Sin resultados NO se queda en blanco: lo dice y ofrece añadirlo a mano',
    { filas: nada.n, avisa: /Ningún servicio/i.test(nada.txt) }, { filas: 0, avisa: true });
  const vacio = await buscar('');
  yes('Con la caja vacía vuelve a la categoría abierta', vacio.n >= 1 && vacio.n < 20, vacio);

  // ---------- 3. LOS DEMÁS BUSCADORES TAMPOCO SE TRABAN CON LOS ACENTOS ----------
  const acentos = await page.evaluate(() => {
    DB.clientes = [{ id: 'c1', nombre: 'Ramón Núñez', tel: '7871112222', empresa: 'Pest Control Rivera' }];
    DB.ordenes = [{ id: 'RO-5', fecha: new Date().toISOString(), cliente: 'Ramón Núñez', tel: '', vehiculo: { make: 'Honda', model: 'Civic' },
      servicios: [], denegados: [], insp: {}, fotos: [], total: 100, estado: 'pendiente', abonado: 0, pagos: [] }];
    DB.inventario = [{ id: 'i1', nombre: 'Batería Duralast 35', sku: 'DL-35', brand: 'Duralast', qty: 2, min: 1, cost: 90, price: 140 }];
    saveDB({ force: true });
    const r = {};
    go('clientes'); document.getElementById('cli-q').value = 'ramon'; renderClientes();
    r.cliente = /Ramón/.test(document.getElementById('clientes-body').innerText);
    go('ordenes'); document.getElementById('ord-q').value = 'nunez'; renderOrdenes();
    r.orden = /RO-5/.test(document.getElementById('ordenes-body').innerText);
    go('inventario'); document.getElementById('inv-q').value = 'bateria'; renderInventario();
    r.inventario = /Duralast/.test(document.getElementById('inventario-body') ? document.getElementById('inventario-body').innerText : document.body.innerText);
    return r;
  });
  yes('Buscar "ramon" encuentra a Ramón en clientes', acentos.cliente);
  yes('Buscar "nunez" encuentra su orden', acentos.orden);
  yes('Buscar "bateria" encuentra la batería en inventario', acentos.inventario);

  is('Sin errores de JavaScript', errs, []);
  await browser.close();
  console.log('\n' + (fail ? `❌ ${fail} FALLOS de ${pass + fail}` : `TODO VERDE — ${pass} pass / 0 fail`));
  process.exit(fail ? 1 : 0);
})();
