// LA NUBE ATRASADA NO PUEDE PISAR LO QUE ACABAS DE HACER EN EL EQUIPO.
// Auditoría 2026-07-28 (parte 3). Los dos bugs salieron de auditar el RESPALDO REAL de Roberto,
// no el código: la data de su día contradecía a su propia bitácora.
//
//   1. `mergeDB` resolvía las ÓRDENES por "gana la edición más reciente" (se arregló el 27-jul),
//      pero las otras 13 listas — citas, garage, gastos, INVENTARIO, clientes, técnicos,
//      asesores, promos, servicios y trabajos personalizados, suplidores, órdenes de suplidor —
//      seguían con la regla vieja: `out` salía de `remote` y **para un id presente en los dos
//      lados la nube ganaba SIEMPRE**. La edición fresca del equipo se perdía sin avisar.
//      EVIDENCIA REAL en su respaldo del 28-jul: convirtió la cita de Amanda Ortiz en orden a las
//      12:13 PM y la app la marcó "completada" — el renglón quedó en la bitácora — pero el
//      respaldo de las 12:58 la tenía otra vez **"agendada"**, sin `roId`. La nube la resucitó.
//      La bitácora sobrevivió porque se une por unión; la cita no, porque se pisaba por id.
//      Con `inventario` el mismo fallo = conteos de piezas mal sin que nadie se entere.
//
//   2. El carro se quedaba en el garage como EN TRABAJO para siempre si la orden se cerraba con
//      "Marcar pagado". Sacar el carro del garage vivía DENTRO de `cobrarYCerrar` nada más.
//      EVIDENCIA REAL: el Kia Soul de Amanda se cobró y se selló a las 12:13 PM y a las 12:58
//      seguía en el garage `working`. El tablero le enseña carros que ya entregó.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node sync-no-pisa.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    const viejo = '2026-07-28T16:00:00.000Z';   // lo que tiene la nube (atrasado)
    const nuevo = '2026-07-28T16:13:10.000Z';   // lo que acabas de hacer en el equipo

    // --- el caso EXACTO de Amanda: cita cerrada aquí, nube todavía la tiene agendada ---
    const local = {
      ordenes: [], papelera: [], bitacora: [], settings: {}, serviceParts: {}, _rev: 5,
      citas: [{ id: 'CITA-1', cliente: 'Amanda Ortiz', fecha: '2026-07-28', hora: '11:00',
                estado: 'completada', roId: 'RO-3', _editedAt: nuevo }],
      garage: [{ id: 'GAR-1', roId: 'RO-3', estado: 'entregado', _editedAt: nuevo }],
      inventario: [{ id: 'INV-1', nombre: 'Filtro de aceite', qty: 3, _editedAt: nuevo }],
      gastos: [{ id: 'GA-1', desc: 'Gasolina', monto: 40, _editedAt: nuevo }],
      clientes: [{ id: 'CL-1', nombre: 'Amanda Ortiz', tel: '787-718-6057', _editedAt: nuevo }]
    };
    const remote = {
      ordenes: [], papelera: [], bitacora: [], settings: {}, serviceParts: {}, _rev: 4,
      citas: [{ id: 'CITA-1', cliente: 'Amanda Ortiz', fecha: '2026-07-28', hora: '11:00',
                estado: 'agendada', _editedAt: viejo }],
      garage: [{ id: 'GAR-1', roId: 'RO-3', estado: 'working', _editedAt: viejo }],
      inventario: [{ id: 'INV-1', nombre: 'Filtro de aceite', qty: 8, _editedAt: viejo }],
      gastos: [{ id: 'GA-1', desc: 'Gasolina', monto: 25, _editedAt: viejo }],
      clientes: [{ id: 'CL-1', nombre: 'Amanda Ortiz', tel: '787-000-0000', _editedAt: viejo }],
      // algo que solo existe en la nube: tiene que sobrevivir
      tecnicos: [{ id: 'T-1', nombre: 'Solo en la nube', _editedAt: viejo }]
    };
    const m = mergeDB(local, remote);
    const conflictos1 = _ultimosConflictos.slice();   // se resetea en cada mergeDB

    // el caso al revés: la nube es la fresca y este equipo el atrasado
    const local2 = JSON.parse(JSON.stringify(local));
    local2.citas[0]._editedAt = viejo; local2.citas[0].estado = 'agendada';
    const remote2 = JSON.parse(JSON.stringify(remote));
    remote2.citas[0]._editedAt = nuevo; remote2.citas[0].estado = 'completada';
    const m2 = mergeDB(local2, remote2);

    // sin marcas de hora (data vieja de antes de este arreglo): no debe explotar
    const l3 = { ordenes: [], citas: [{ id: 'C-9', estado: 'agendada' }], settings: {} };
    const r3 = { ordenes: [], citas: [{ id: 'C-9', estado: 'completada' }], settings: {} };
    let m3 = null, err3 = null;
    try { m3 = mergeDB(l3, r3); } catch (e) { err3 = e.message; }

    // ¿marcarEditadas sella las listas nuevas, no solo las órdenes?
    const cols = typeof COLS_SYNC !== 'undefined' ? COLS_SYNC : null;
    const censoTieneFpc = !!(censo({ ordenes: [], citas: [{ id: 'X' }] }).fpc || {})['citas:X'];

    return {
      cita: m.citas[0], garage: m.garage[0], inv: m.inventario[0],
      gasto: m.gastos[0], cliente: m.clientes[0],
      tecNube: (m.tecnicos || []).length,
      alReves: m2.citas[0].estado,
      sinMarcas: err3 || (m3.citas[0] || {}).estado,
      cols, censoTieneFpc,
      conflictos: conflictos1
    };
  });

  // --- 1. LO FRESCO DEL EQUIPO GANA ---
  is('La cita cerrada NO resucita como agendada', r.cita.estado, 'completada');
  is('...y conserva el enlace a su orden', r.cita.roId, 'RO-3');
  is('El carro entregado no vuelve a "en trabajo"', r.garage.estado, 'entregado');
  is('El inventario no vuelve al conteo viejo', r.inv.qty, 3);
  is('El gasto corregido no se revierte', r.gasto.monto, 40);
  is('El teléfono del cliente no se revierte', r.cliente.tel, '787-718-6057');
  is('El descarte queda anotado en los conflictos', r.conflictos.length, 5);
  is('...y dice de que lista se trata y cual gano',
     r.conflictos.some(function(c){return c.indexOf('citas/CITA-1')===0 && /gan/.test(c) && /este equipo/.test(c);}), true);

  // --- 2. NO SE PIERDE NADA DE LA NUBE ---
  is('Lo que solo existe en la nube sobrevive', r.tecNube, 1);
  is('Cuando la fresca es la de la nube, gana la nube', r.alReves, 'completada');

  // --- 3. DATA VIEJA SIN MARCAS NO ROMPE NADA ---
  is('Sin marcas de hora se comporta como antes (gana la nube), sin reventar', r.sinMarcas, 'completada');

  // --- 4. EL CABLEADO ESTÁ COMPLETO ---
  is('COLS_SYNC cubre las 13 listas que se sincronizan', (r.cols||[]).length, 13);
  is('censo() saca huella de esas listas (si no, nunca se marcarían)', r.censoTieneFpc, true);
  ['clientes', 'citas', 'garage', 'gastos', 'inventario'].forEach(k =>
    is('COLS_SYNC incluye ' + k, r.cols.indexOf(k) >= 0, true));

  // --- 5. EL CARRO SALE DEL GARAGE POR LOS DOS CAMINOS ---
  const g = await page.evaluate(() => {
    window.confirm = () => true;   // "sí, ya se llevó el carro"
    window.prompt = () => 'Cash';
    window.alert = () => {};
    DB.ordenes.push({ id: 'RO-77', fecha: new Date().toISOString(), cliente: 'Prueba', tel: '',
      vehiculo: { year: 2020, make: 'Kia', model: 'Forte' },
      servicios: [{ id: 's', n: 'Frenos', p: 100, ep: 100, qty: 1 }],
      total: 111.5, estado: 'pendiente', insp: {}, denegados: [] });
    DB.garage.push({ id: 'GAR-77', roId: 'RO-77', estado: 'working', log: [] });
    saveDB();
    markPaid('RO-77');
    const gg = DB.garage.find(x => x.roId === 'RO-77');
    return { estado: gg.estado, log: (gg.log || []).length, existe: typeof cerrarGarageDeRO };
  });
  is('Existe una sola función que saca el carro del garage', g.existe, 'function');
  is('"Marcar pagado" tambien saca el carro del garage', g.estado, 'entregado');
  is('...y lo deja anotado en la bitácora del carro', g.log > 0, true);

  // --- 6. LAS CITAS QUE YA QUEDARON MAL SE REPARAN SOLAS ---
  // Caso EXACTO de Roberto: RO-3 guarda `citaId`, pero la cita volvio a "agendada" sin `roId`.
  // Arreglar el merge no repara lo ya danado; esto si, y en cada carga de la app.
  const rep = await page.evaluate(() => {
    const db = {
      ordenes: [
        { id: 'RO-3', citaId: 'CITA-1785179062544', cliente: 'Amanda Ortiz', total: 372.02, estado: 'pagado' },
        { id: 'RO-2', cliente: 'Migdalia Cotto', total: 88.2, estado: 'pagado' }            // sin cita
      ],
      citas: [
        { id: 'CITA-1785179062544', cliente: 'Amanda Ortiz', fecha: '2026-07-28', hora: '11:00', estado: 'agendada' },
        { id: 'CITA-OTRA', cliente: 'Cliente de manana', fecha: '2026-07-29', estado: 'agendada' }   // legitima
      ]
    };
    const n = repararCitasPisadas(db);
    const n2 = repararCitasPisadas(db);   // idempotente
    return { n, n2, amanda: db.citas[0], otra: db.citas[1] };
  });
  is('Repara la cita de Amanda que la nube devolvio a "agendada"', rep.amanda.estado, 'completada');
  is('...y le devuelve el enlace a su orden', rep.amanda.roId, 'RO-3');
  is('Reporta exactamente 1 reparada', rep.n, 1);
  is('Correrla otra vez no hace nada (idempotente)', rep.n2, 0);
  is('NO toca una cita legitima de manana', rep.otra.estado, 'agendada');
  is('...ni le inventa una orden', rep.otra.roId, undefined);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
