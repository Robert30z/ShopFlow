// SI EL GUARDADO SE RECHAZA, LO QUE EL USUARIO ESCRIBIÓ TIENE QUE SEGUIR AHÍ.
// Inspección del 31-jul-2026 (eje 1 del estándar: DATOS EN VUELO, no solo los guardados).
//
// Salió tirando del hilo del bug del guard que Roberto reportó el mismo día. El guard trancado
// era la mitad del problema; ESTA es la otra mitad, y es la que le dolió:
//
//   saveCita()  ->  DB.citas.push(...)
//                   clearFields([...])      <-- el formulario se vacía AQUÍ
//                   saveDB();               <-- ...y el resultado ni se mira
//
// `saveDB()` devuelve false cuando el guard rechaza, y ADEMÁS llama a `revertirAlUltimoBueno()`,
// que recarga el DB del disco — o sea que la cita también se borra de la memoria. Resultado para
// Roberto: la cita no se guardó Y cliente, fecha, hora, vehículo, servicio y dirección ya estaban
// borrados de la pantalla. Lo tecleado se perdió sin manera de recuperarlo.
//
// La misma clase estaba en `saveG` (gastos) y en `addGL` (nota del garage). Se arreglaron las tres:
// guardar PRIMERO, y solo limpiar si el guardado se confirmó. Y el modo edición (`_citaEdit` /
// `_gastoEdit`) tampoco se suelta antes: si se soltara y el guardado fallara, al reintentar se
// crearía un DUPLICADO en vez de corregir el original.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node no-borres-lo-que-escribi.js
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
  page.on('dialog', d => d.accept());          // el guard avisa con alert(); lo aceptamos y seguimos
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    const out = {};

    // Trancamos el guardado a propósito, igual que lo tenía Roberto con RO-3 descuadrado.
    // Se hace forzando una violación que el guard SÍ tiene que cazar: una orden que se evapora.
    function trancar() {
      DB.ordenes = [{ id: 'RO-FANTASMA', cliente: 'X', vehiculo: {}, servicios: [], total: 0, estado: 'pendiente' }];
      localStorage.setItem('sf_v1', JSON.stringify(DB));
      _lastGood = censo(DB);
      DB.ordenes = [];                 // desaparece sin pasar por la papelera => el guard rechaza
    }
    function destrancar() {
      DB.ordenes = []; DB.papelera = [];
      localStorage.setItem('sf_v1', JSON.stringify(DB));
      _lastGood = censo(DB);
    }
    function set(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
    function get(id) { const el = document.getElementById(id); return el ? el.value : null; }

    // ---------- CITA ----------
    go('citas');
    set('ct-n', 'Julio Rodríguez'); set('ct-t', '787-450-3261'); set('ct-f', '2026-08-01');
    set('ct-h', '10:00'); set('ct-v', 'Jeep Liberty 2005'); set('ct-s', 'Cambio de aceite');
    set('ct-d', 'San Juan, por la Barbosa');
    out.guardadoBloqueado = (function () { trancar(); try { saveCita(); } catch (e) { return 'excepcion: ' + e.message; } return 'ok'; })();
    out.citaCliente = get('ct-n');
    out.citaFecha = get('ct-f');
    out.citaVehiculo = get('ct-v');
    out.citaDireccion = get('ct-d');
    destrancar();

    // ...y cuando el guardado SÍ pasa, el formulario sí se limpia (no romper lo que funcionaba)
    go('citas');
    set('ct-n', 'Ana'); set('ct-f', '2026-08-02'); set('ct-v', 'Civic');
    try { saveCita(); } catch (e) { }
    out.limpiaCuandoGuarda = get('ct-n');
    out.citaQuedoGuardada = (DB.citas || []).some(c => c.cliente === 'Ana');

    // ---------- GASTO ----------
    go('finanzas');
    try { renderGas(); } catch (e) { }
    if (!document.getElementById('gd')) { out.gastoSaltado = 'el formulario de gasto no está en pantalla'; }
    set('gd', 'Aceite Pennzoil'); set('gm', '85.40');
    out.gastoBloqueado = (function () { trancar(); try { saveG(); } catch (e) { return 'excepcion: ' + e.message; } return 'ok'; })();
    out.gastoDesc = get('gd');
    out.gastoMonto = get('gm');
    destrancar();

    // ---------- NOTA DEL GARAGE ----------
    DB.garage = [{ id: 'GAR-1', cliente: 'Luis', vehiculo: 'Corolla', estado: 'working', log: [] }];
    localStorage.setItem('sf_v1', JSON.stringify(DB)); _lastGood = censo(DB);
    go('garage'); renderGarage();
    set('gl-GAR-1', 'Esperando la pieza del suplidor');
    out.notaBloqueada = (function () { trancar(); try { addGL('GAR-1'); } catch (e) { return 'excepcion: ' + e.message; } return 'ok'; })();
    out.notaTexto = get('gl-GAR-1');
    destrancar();

    return out;
  });

  console.log('-- LA CITA (el caso exacto de Roberto) --');
  is('el guardado se intentó sin reventar', r.guardadoBloqueado, 'ok');
  is('🐛 el cliente NO se borró del formulario', r.citaCliente, 'Julio Rodríguez');
  is('...ni la fecha', r.citaFecha, '2026-08-01');
  is('...ni el vehículo', r.citaVehiculo, 'Jeep Liberty 2005');
  is('...ni la dirección', r.citaDireccion, 'San Juan, por la Barbosa');

  console.log('-- y lo que ya funcionaba sigue funcionando --');
  is('cuando el guardado pasa, el formulario sí se limpia', r.limpiaCuandoGuarda, '');
  is('...y la cita quedó guardada de verdad', r.citaQuedoGuardada, true);

  console.log('-- EL GASTO --');
  is('el guardado se intentó sin reventar', r.gastoBloqueado, 'ok');
  is('🐛 la descripción del gasto NO se borró', r.gastoDesc, 'Aceite Pennzoil');
  is('...ni el monto', r.gastoMonto, '85.40');

  console.log('-- LA NOTA DEL GARAGE --');
  is('el guardado se intentó sin reventar', r.notaBloqueada, 'ok');
  is('🐛 la nota NO se borró', r.notaTexto, 'Esperando la pieza del suplidor');

  is('sin errores de JavaScript', errs.length, 0, errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
