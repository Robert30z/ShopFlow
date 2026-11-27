// ESTIMADOS (27-nov-2026): cotizar sin abrir orden.
// ---------------------------------------------------------------------------
// Pedido de Roberto despues del Corolla de Jose: el estimado NO es una orden de reparacion.
// Esta prueba cuida lo que no se puede romper:
//  - los totales cuadran (caso real: $709.35 + IVU = $790.93)
//  - un estimado no toca ventas, "por cobrar" ni la lista de ordenes
//  - "Abrir orden" pasa SOLO los trabajos aprobados y la orden nace en el asistente
//  - sincroniza: en mergeDB gana la edicion mas reciente y no se pierde ninguno
//  - un respaldo viejo sin `estimados` no rompe la app
//  - lo que el cliente escribe no se ejecuta (nombre con HTML)
// Usage:  python -m http.server 8931   (raiz del repo) + node estimados.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'America/Puerto_Rico', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 0. ARRANQUE LIMPIO + ORDEN EXISTENTE PARA COMPARAR ----------
  await page.evaluate(() => {
    DB.ordenes = [{ id: 'RO-1', cliente: 'Base', fecha: new Date().toISOString(), estado: 'pendiente', total: 100, abonado: 0,
      servicios: [{ n: 'x', p: 100, ep: 100, qty: 1, parts: [] }], vehiculo: {}, pagos: [] }];
    DB.roCounter = 1; DB.estimados = []; DB.settings.shopName = 'Pit Stop'; DB.settings.shopPhone = '7874546513'; DB.settings.laborRate = 85;
    saveDB({ force: true });
    window.__antes = { ords: DB.ordenes.length, cobrar: typeof porCobrarTotal === 'function' ? porCobrarTotal() : null };
  });

  // ---------- 1. LA TARJETA DEL HOME ABRE LA LISTA VACIA ----------
  await page.evaluate(() => go('home'));
  await page.click('text=Estimados');
  await page.waitForTimeout(300);
  yes('home -> pagina estimados visible', await page.evaluate(() => document.getElementById('estimados').classList.contains('v')));
  yes('lista vacia dice que no hay pendientes', (await page.textContent('#est-body')).includes('No hay estimados pendientes'));

  // ---------- 2. NUEVO ESTIMADO, LLENADO POR LA PANTALLA ----------
  await page.click('text=Nuevo estimado');
  await page.waitForTimeout(300);
  const inputs = page.locator('#est-body input');
  await inputs.nth(0).fill('José Rivera');
  await inputs.nth(1).fill('7709403421');
  await inputs.nth(2).fill('2005'); await inputs.nth(3).fill('Toyota'); await inputs.nth(4).fill('Corolla');
  await inputs.nth(5).fill('2t1br32e05c352095'); await inputs.nth(6).fill('209026');
  await page.fill('#est-body textarea', 'La valvula PCV esta rota.');
  await page.waitForTimeout(700);
  const e1 = await page.evaluate(() => JSON.parse(JSON.stringify(EST)));
  is('cliente guardado', e1.cliente, 'José Rivera');
  is('VIN en mayusculas', e1.vehiculo.vin, '2T1BR32E05C352095');
  is('millaje', e1.vehiculo.odo, '209026');
  is('hallazgo', e1.hallazgo, 'La valvula PCV esta rota.');
  yes('id unico entre equipos (no EST-1)', /^EST-[0-9A-Z]{6,}$/.test(e1.id) && e1.id !== 'EST-1', e1.id);
  is('numero visible #1', e1.num, 1);

  // ---------- 3. EL CASO REAL DE JOSE: TOTAL $790.93 ----------
  const tot = await page.evaluate(() => {
    EST.items = [
      { uid: 'a', n: 'Reemplazo de valvula PCV y su manga', labor: '30.95', ok: true, parts: [{ name: 'PCV', qty: 1, precio: '15' }, { name: 'Manga', qty: 1, precio: '35' }] },
      { uid: 'b', n: 'Junta de tapa de valvulas', nota: 'Incluye sellos', labor: '154.75', ok: true, parts: [{ name: 'Junta', qty: 1, precio: '42' }] },
      { uid: 'c', n: 'Bujias (4)', labor: '30.95', ok: true, parts: [{ name: 'Bujia', qty: 4, precio: '17' }] },
      { uid: 'd', n: 'Bomba de power steering', labor: '185.70', ok: true, parts: [{ name: 'Bomba', qty: 1, precio: '135' }, { name: 'Liquido', qty: 1, precio: '12' }] }];
    EST.diag = '60'; estGuardarYa(); renderEstimados();
    return estTotales(EST);
  });
  is('subtotal Jose', tot.sub, 709.35);
  is('IVU Jose', tot.ivu, 81.58);
  is('total Jose', tot.total, 790.93);
  yes('la pantalla ensena $790.93', (await page.textContent('#est-tots')).includes('$790.93'));
  yes('la pantalla ensena el diagnostico acreditado', (await page.textContent('#est-tots')).includes('se acredita'));

  // ---------- 4. EDITAR POR LA PANTALLA RECALCULA AL MOMENTO ----------
  await page.locator('#est-body input[type=number]').nth(0).fill('40');   // mano de obra del trabajo 1
  await page.waitForTimeout(150);
  const t2 = await page.evaluate(() => estTotales(EST));
  is('subir mano de obra a $40 recalcula', t2.sub, 718.40);
  yes('total del trabajo 1 en pantalla', (await page.textContent('#est-it-tot-0')) === '$90.00');
  await page.locator('#est-body input[type=number]').nth(0).fill('30.95');
  await page.waitForTimeout(700);

  // ---------- 5. NO TOCA VENTAS NI ORDENES ----------
  const desp = await page.evaluate(() => ({ ords: DB.ordenes.length, cobrar: typeof porCobrarTotal === 'function' ? porCobrarTotal() : null, antes: window.__antes }));
  is('el estimado no crea ordenes', desp.ords, desp.antes.ords);
  is('el estimado no cambia "por cobrar"', desp.cobrar, desp.antes.cobrar);
  const disco = await page.evaluate(() => { var d = JSON.parse(localStorage.getItem('sf_v1') || '{}'); return (d.estimados || []).length; });
  is('quedo guardado en el disco', disco, 1);

  // ---------- 6. PDF ----------
  const pdf = await page.evaluate(() => {
    var cap = null, orig = sharePDFDoc; sharePDFDoc = function (doc, f) { cap = { f: f, b: doc.output('datauristring'), pages: doc.getNumberOfPages() }; };
    try { estPDF(EST.id); } finally { sharePDFDoc = orig; }
    return cap;
  });
  yes('se genero el PDF', !!(pdf && pdf.b && pdf.b.length > 1000), pdf && pdf.b.length);
  is('nombre del archivo', pdf && pdf.f, 'PitStop_Estimado_1.pdf');
  is('una sola pagina', pdf && pdf.pages, 1);
  if (pdf) fs.writeFileSync(__dirname + '/estimado-prueba.pdf', Buffer.from(pdf.b.split(',')[1], 'base64'));

  // ---------- 7. ABRIR ORDEN CON SOLO LO APROBADO ----------
  await page.evaluate(() => { EST.items[3].ok = false; estGuardarYa(); estConvertir(EST.id); });
  await page.waitForTimeout(800);
  const ro = await page.evaluate(() => ({ pagina: document.getElementById('ro').classList.contains('v'), cliente: RO.cliente, tel: RO.tel,
    veh: RO.vehiculo, n: RO.servicios.length, labs: RO.servicios.map(s => s.ep), partes: RO.servicios.map(s => s.parts.length), est: RO.estimadoId,
    estado: DB.estimados[0].estado, roId: DB.estimados[0].roId || null, ords: DB.ordenes.length }));
  yes('se abrio el asistente de orden', ro.pagina);
  is('cliente pasa a la orden', ro.cliente, 'José Rivera');
  is('VIN y millaje pasan', [ro.veh.vin, ro.veh.odoIn], ['2T1BR32E05C352095', '209026']);
  is('solo 3 trabajos aprobados pasan', ro.n, 3);
  is('mano de obra por trabajo', ro.labs, [30.95, 154.75, 30.95]);
  is('piezas por trabajo', ro.partes, [2, 1, 1]);
  is('la orden recuerda su estimado', ro.est, e1.id);
  is('abrir el asistente NO marca convertido (la orden aun no existe)', ro.estado, 'abierto');
  is('sin roId mientras la orden no exista', ro.roId, null);
  is('todavia no se guarda una orden (nace al terminar el asistente)', ro.ords, 1);
  yes('el diagnostico pagado queda anotado en la orden', await page.evaluate(() => /Diagnóstico de \$60\.00 ya pagado/.test(RO.techNotes || '')));
  // salirse del asistente sin guardar: el estimado sigue pendiente
  await page.evaluate(() => go('home'));
  is('salirse sin guardar deja el estimado pendiente', await page.evaluate(() => DB.estimados[0].estado), 'abierto');
  // ahora si: convertir y GUARDAR la orden
  const fin = await page.evaluate(() => { estConvertir(DB.estimados[0].id); saveOpenRO();
    var o = DB.ordenes.find(x => x.estimadoId === DB.estimados[0].id);
    return { estado: DB.estimados[0].estado, roId: DB.estimados[0].roId, ordId: o && o.id, n: DB.ordenes.length }; });
  is('guardar la orden marca el estimado convertido', fin.estado, 'convertido');
  yes('roId = el numero FINAL de la orden guardada', !!fin.roId && fin.roId === fin.ordId, fin);
  is('se guardo una sola orden nueva', fin.n, 2);

  // ---------- 8. LISTA: PENDIENTES / CERRADOS ----------
  await page.evaluate(() => { _estFiltro = 'abiertos'; EST = null; go('estimados'); });
  yes('convertido no sale en pendientes', !(await page.textContent('#est-body')).includes('José Rivera'));
  await page.evaluate(() => { _estFiltro = 'cerrados'; renderEstimados(); });
  yes('convertido sale en cerrados', (await page.textContent('#est-body')).includes('José Rivera'));

  // ---------- 9. DESCARTAR NO BORRA (LA NUBE NO LO RESUCITA) ----------
  await page.evaluate(() => { estNuevo(); EST.cliente = 'Para descartar'; estGuardarYa(); estCambiarEstado(EST.id, 'descartado'); });
  const des = await page.evaluate(() => DB.estimados.map(e => e.id + ':' + e.estado));
  is('descartado sigue en la lista con su estado', des.map(x => x.split(':')[1]), ['convertido', 'descartado']);

  // ---------- 10. SINCRONIZA: GANA LA EDICION MAS RECIENTE ----------
  const mg = await page.evaluate(() => {
    var local = JSON.parse(JSON.stringify(DB)), remote = JSON.parse(JSON.stringify(DB));
    local.estimados[0].cliente = 'Local nuevo'; local.estimados[0]._editedAt = '2030-01-02T00:00:00Z';
    remote.estimados[0].cliente = 'Nube vieja'; remote.estimados[0]._editedAt = '2030-01-01T00:00:00Z';
    remote.estimados.push({ id: 'EST-9', cliente: 'Solo en la nube', estado: 'abierto', items: [], vehiculo: {}, _editedAt: '2030-01-01T00:00:00Z' });
    var id0 = local.estimados[0].id, m = mergeDB(local, remote);
    return { n: m.estimados.length, c: m.estimados.find(e => e.id === id0).cliente, nube: !!m.estimados.find(e => e.id === 'EST-9') };
  });
  is('merge conserva todos', mg.n, 3);
  is('merge: gana el mas reciente', mg.c, 'Local nuevo');
  yes('merge: trae el que solo estaba en la nube', mg.nube);
  yes('estimados viaja en el sync', await page.evaluate(() => COLS_SYNC.indexOf('estimados') >= 0));

  // ---------- 10b. DOS EQUIPOS CREANDO A LA VEZ NO CHOCAN ----------
  const ids = await page.evaluate(() => { var a = new Set(); for (var i = 0; i < 200; i++) a.add(estNuevoId()); return a.size; });
  is('200 ids seguidos, todos distintos', ids, 200);
  // ---------- 10c. NUMEROS COMO LOS ESCRIBE UN IPAD EN ESPANOL ----------
  const nums = await page.evaluate(() => [estNum('10,50'), estNum('-5'), estQty('2.6'), estItemTot({ labor: '10,5', parts: [{ qty: '2', precio: '3,25' }] }).total]);
  is('coma decimal, sin negativos, cantidad entera', nums, [10.5, 0, 3, 17]);

  // ---------- 11. RESPALDO VIEJO SIN `estimados` ----------
  const viejo = await page.evaluate(() => { var d = normalizarDB({ ordenes: [] }); return Array.isArray(d.estimados); });
  yes('normalizarDB crea estimados en un respaldo viejo', viejo);

  // ---------- 12. LO QUE ESCRIBE EL CLIENTE NO SE EJECUTA ----------
  await page.evaluate(() => { window.__xss = 0; estNuevo(); EST.cliente = '<img src=x onerror="window.__xss=1">'; estGuardarYa(); EST = null; _estFiltro = 'todos'; renderEstimados(); });
  await page.waitForTimeout(300);
  is('nombre con HTML no se ejecuta', await page.evaluate(() => window.__xss), 0);

  // ---------- 13. PANTALLA: SIN SCROLL DE LADO EN CELULAR ----------
  await page.evaluate(() => { EST = DB.estimados[0]; EST.estado = 'abierto'; renderEstimados(); });
  await page.waitForTimeout(300);
  const ancho = await page.evaluate(() => { var b = document.getElementById('est-body'); return b.scrollWidth - b.clientWidth; });
  yes('sin scroll horizontal a 390px', ancho <= 1, ancho);
  await page.screenshot({ path: __dirname + '/estimados-390.png', fullPage: false });

  is('cero errores de JavaScript', errs, []);
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
