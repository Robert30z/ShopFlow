// EL CLIENTE QUE VUELVE — la segunda visita del mismo cliente.
// ---------------------------------------------------------------------------
// Sonda del 28-jul (3ra auditoría). Nadie había corrido DOS órdenes del MISMO
// cliente escribiendo el nombre como lo escribe un ser humano: la primera vez
// "Ramón Figueroa", la segunda "ramón figueroa" (o sin acento).
// La app une clientes SIN mirar mayúsculas (autoSaveCli / pickCli), pero el
// historial, el total gastado, el contador de órdenes y la "última visita" se
// buscan con match EXACTO de texto (o.cliente === c.nombre).
// Se le pregunta lo MISMO a tres pantallas: ficha del cliente, lista de
// clientes e Historial. Si dan distinto, hay bug.
// Usage:  python -m http.server 8931  (raíz del repo) + node cliente-repetido.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');
const money = t => Number(String(t || '').replace(/[^0-9.\-]/g, '')) || 0;

let cola = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => {
    const r = cola.length ? cola.shift() : null;
    if (d.type() === 'prompt') await d.accept(r === null ? '' : String(r));
    else if (r === false) await d.dismiss();
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Una orden completa por el asistente, como la hace él: nombre, carro, un
  // servicio a mano, y guardar. (Lo mínimo que saveRO exige: cliente+servicio.)
  const irHome = async () => {
    for (let i = 0; i < 4; i++) {
      if (await page.locator('#home.v').count()) break;
      const b = page.locator('.tb-back:visible').first();
      if (await b.count()) { await b.click(); await page.waitForTimeout(300); } else break;
    }
    await page.waitForTimeout(200);
  };

  const correrOrden = async (nombre, tag, servicio, precio) => {
    await irHome();
    await page.click('#home .mc');
    await page.waitForTimeout(400);
    await page.fill('#c-n', nombre);
    await page.waitForTimeout(300);            // deja correr pickCli (autocompletar)
    await page.fill('#v-y', '2018');
    await page.fill('#v-ma', 'Honda');
    await page.fill('#v-mo', 'Civic');
    await page.fill('#v-t', tag);
    await page.click('#ro-next'); await page.waitForTimeout(250);   // fotos
    await page.click('#ro-next'); await page.waitForTimeout(250);   // servicios
    cola = [servicio, String(precio)];
    await page.click('#pan-2 button:has-text("Servicio manual")');
    await page.waitForTimeout(300);
    for (let i = 0; i < 6; i++) { await page.click('#ro-next'); await page.waitForTimeout(250); }
    cola = [];
    await page.click('#pan-8 button:has-text("Guardar orden completa")');
    await page.waitForTimeout(900);
  };

  // ---------- VISITA 1: como la escribió la primera vez ----------
  await correrOrden('Ramón Figueroa', 'HZK-411', 'Cambio de aceite sintético', 140);
  const v1 = await ev(page, `return { ordenes: DB.ordenes.length, clientes: DB.clientes.length,
    nombre: (DB.clientes[0]||{}).nombre, total: (DB.ordenes[0]||{}).total };`);
  is('Visita 1: queda 1 orden y 1 cliente', { o: v1.ordenes, c: v1.clientes }, { o: 1, c: 1 });
  const totalV1 = v1.total;

  // ---------- VISITA 2: el mismo cliente, tecleado en minúsculas ----------
  // (el iPad capitaliza solo a veces; él teclea rápido entre carros)
  await correrOrden('ramón figueroa', 'HZK-411', 'Pastillas de freno delanteras', 139);
  const v2 = await ev(page, `return { ordenes: DB.ordenes.length, clientes: DB.clientes.map(c=>c.nombre),
    nombresOrden: DB.ordenes.map(o=>o.cliente), totales: DB.ordenes.map(o=>o.total) };`);
  is('Visita 2: NO se duplica el cliente (la unión ignora mayúsculas)', v2.clientes.length, 1);
  is('Y hay 2 órdenes guardadas', v2.ordenes, 2);
  const totalReal = v2.totales.reduce((s, t) => s + t, 0);

  // ---------- LA MISMA PREGUNTA A TRES PANTALLAS ----------
  // "¿Cuánto ha gastado Ramón y cuántas veces ha venido?"
  await ev(page, `go('clientes'); renderClientes(); return 1;`);
  await page.waitForTimeout(500);
  const lista = await ev(page, `
    var row = document.querySelector('#clientes-body [onclick^="openCliDetail"]') || document.querySelector('#clientes-body > div');
    var txt = row ? row.innerText : '';
    return { txt: txt, ordenesTxt: (txt.match(/(\\d+) orden/)||[])[1], gasto: (txt.match(/\\$([\\d,\\.]+)/)||[])[1] };`);

  const cid = await ev(page, `return DB.clientes[0].id;`);
  await ev(page, `openCliDetail('${cid}'); return 1;`);
  await page.waitForTimeout(500);
  const ficha = await ev(page, `
    var m = document.getElementById('clientes-body');
    var t = m ? m.innerText : document.body.innerText;
    return { filas: (t.match(/RO-\\d+/g)||[]), sinOrdenes: /Sin órdenes todavía/.test(t), txt: t.slice(0,600) };`);

  // A la app se le pregunta con SU propia función, la que usan todas las pantallas
  const hist = await ev(page, `
    var n = DB.clientes[0].nombre, ords = ordenesDeCli(n);
    return { real: ords.length, totalApp: ords.reduce(function(s,o){return s+(o.total||0);},0),
             totalDB: DB.ordenes.reduce(function(s,o){return s+(o.total||0);},0) };`);

  console.log('\n  ── la misma pregunta, tres pantallas ──');
  console.log('  Lista de clientes:  ' + lista.ordenesTxt + ' órdenes / $' + lista.gasto);
  console.log('  Ficha del cliente:  ' + ficha.filas.length + ' órdenes' + (ficha.sinOrdenes ? ' ("Sin órdenes todavía")' : ''));
  console.log('  La verdad (DB):     ' + hist.real + ' órdenes / $' + totalReal.toFixed(2) + '\n');

  is('Ficha del cliente: enseña las 2 visitas', ficha.filas.length, 2);
  is('Lista de clientes: cuenta las 2 visitas', Number(lista.ordenesTxt), 2);
  // la lista redondea a dólares enteros a propósito ($311), así que ±$1
  yes('Lista de clientes: el gasto acumulado es el de verdad', Math.abs(money(lista.gasto) - totalReal) <= 1, { pantalla: money(lista.gasto), verdad: totalReal });
  num('El historial no se pierde por un match exacto de texto', hist.totalApp, totalReal);

  // ---------- VISITA 3: el acento se cae (teclado del iPhone) ----------
  await correrOrden('Ramon Figueroa', 'HZK-411', 'Rotación de gomas', 25);
  const v3 = await ev(page, `return { clientes: DB.clientes.map(c=>c.nombre), n: DB.clientes.length,
    carros: DB.clientes.map(c=>(c.vehiculos||[]).length) };`);
  is('Visita 3 (sin acento): sigue siendo UN solo cliente, no dos fichas', v3.n, 1);

  // ---------- ¿Y LO QUE YA QUEDÓ MAL? ----------
  // Un equipo que ya venía con las fichas partidas (así estaba el suyo antes del arreglo):
  // se inyecta el estado malo en el disco y se RECARGA — la reparación corre sola al cargar.
  await ev(page, `
    var db = JSON.parse(localStorage.getItem('sf_v1'));
    db.clientes = [
      { id:'CLI-viejo', nombre:'Ramón Figueroa', tel:'787-555-1212', email:'', empresa:'',
        vehiculos:[{tag:'HZK-411',desc:'2018 Honda Civic',vin:''}], nextReminder:'2026-12-01', creado:'2026-01-05T10:00:00.000Z' },
      { id:'CLI-nuevo', nombre:'Ramon Figueroa', tel:'', email:'ramon@correo.com', empresa:'',
        vehiculos:[{tag:'GHT-902',desc:'2015 Toyota Corolla',vin:'JT2BF22K1W0123456'}], nextReminder:'2027-02-01', creado:'2026-07-20T10:00:00.000Z' }
    ];
    localStorage.setItem('sf_v1', JSON.stringify(db));
    return 1;`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const reparado = await ev(page, `return { n: DB.clientes.length, nombre: (DB.clientes[0]||{}).nombre,
    id: (DB.clientes[0]||{}).id, tel: (DB.clientes[0]||{}).tel, email: (DB.clientes[0]||{}).email,
    carros: ((DB.clientes[0]||{}).vehiculos||[]).map(function(v){return v.tag;}),
    recordatorio: (DB.clientes[0]||{}).nextReminder,
    bita: (DB.bitacora||[]).filter(function(b){return b.tipo==='clientes-fusionados';}).length };`);
  is('Repara lo ya dañado: las 2 fichas partidas quedan en UNA', reparado.n, 1);
  is('Se queda con la ficha vieja y el nombre bien escrito', { id: reparado.id, n: reparado.nombre }, { id: 'CLI-viejo', n: 'Ramón Figueroa' });
  is('Los carros de las dos fichas quedan juntos', reparado.carros, ['HZK-411', 'GHT-902']);
  is('Rellena lo que faltaba (teléfono y correo) sin pisar lo bueno', { t: reparado.tel, e: reparado.email }, { t: '787-555-1212', e: 'ramon@correo.com' });
  is('Se queda con el recordatorio más adelantado', reparado.recordatorio, '2027-02-01');
  is('Y deja renglón en la bitácora', reparado.bita, 1);

  // Idempotente: recargar otra vez no vuelve a fusionar ni deja otro renglón
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const otraVez = await ev(page, `return { n: DB.clientes.length,
    bita: (DB.bitacora||[]).filter(function(b){return b.tipo==='clientes-fusionados';}).length };`);
  is('Idempotente: recargar de nuevo no repite la fusión', { n: otraVez.n, b: otraVez.bita }, { n: 1, b: 1 });

  // Y NO fusiona a dos personas distintas
  await ev(page, `
    var db = JSON.parse(localStorage.getItem('sf_v1'));
    db.clientes.push({ id:'CLI-otro', nombre:'Ramón Figueroa Jr.', tel:'787-555-9999', vehiculos:[], creado:'2026-07-01T10:00:00.000Z' });
    localStorage.setItem('sf_v1', JSON.stringify(db));
    return 1;`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  is('Conservadora: NO junta a dos personas con nombres parecidos', await ev(page, `return DB.clientes.length;`), 2);

  // ---------- "Última visita" → el WhatsApp de win-back ----------
  // Con el match exacto, la visita reciente escrita distinto no contaba: la app le mandaba
  // "hace tiempo no cotejamos su vehículo" a un cliente que estuvo aquí la semana pasada.
  // (Va de último y NO se guarda: toca fechas de facturas selladas solo en memoria.)
  const winback = await ev(page, `
    DB.clientes = [{ id:'CLI-wb', nombre:'Ramón Figueroa', tel:'787-555-1212', vehiculos:[], creado:'2026-01-05T10:00:00.000Z' }];
    DB.ordenes = [
      { id:'RO-90', cliente:'Ramón Figueroa', tel:'787-555-1212', estado:'pagado', total:140,
        fecha:new Date(Date.now()-200*86400000).toISOString(), segFu:true, segRev:true },
      { id:'RO-91', cliente:'ramon figueroa', tel:'787-555-1212', estado:'pagado', total:139,
        fecha:new Date(Date.now()-7*86400000).toISOString(), segFu:true, segRev:true }
    ];
    var segs = getSeguimientos();
    return { wb: segs.filter(function(s){return s.type==='wb';}).length };`);
  is('No le manda "6+ meses sin visita" a quien vino hace 7 días', winback.wb, 0);

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nCLIENTE REPETIDO — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
