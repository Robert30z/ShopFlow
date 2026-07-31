// UNA FACTURA VIEJA QUE NO CUADRA NO PUEDE TRANCAR LA APP ENTERA.
// Bug reportado por Roberto el 31-jul-2026, con sus palabras: "fui a crear una cita en shopflow
// y me dijo algo de un RO3 y no me dejo crear la cita".
//
// QUÉ PASABA: `verificaIntegridad` tiene cuatro reglas. Las reglas (1) expedientes que
// desaparecen, (2) fotos que se pierden y (3) firmas que bajan comparan **prev contra next**:
// solo saltan si ESTE guardado es el que causa la pérdida. La regla (4), la del candado de
// factura cerrada, miraba SOLO el estado absoluto de `next`:
//
//     (next.ordenes||[]).forEach(function(o){ if(!facturaIntacta(o))alteradas.push(o.id); });
//
// O sea que una factura sellada que ya venía sin cuadrar desde antes — RO-3, casi seguro por el
// lío de sincronización del 28-jul — devolvía violación en CADA guardado, tocara lo que tocara.
// Agendar una cita no toca ninguna orden, y aun así quedaba bloqueado por RO-3. La app entera
// trancada por un daño viejo en otra pantalla, y sin salida: el mismo patrón de "aviso sin
// salida" que ya estaba documentado en el propio archivo.
//
// LA REGLA CORRECTA: este guardado solo se bloquea si ES ÉL el que rompe la factura. El daño
// viejo se repara con "Reabrir para corregir", no bloqueando el trabajo del día.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node guard-no-tranca.js
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
    // Una orden sellada a la que DESPUÉS le cambiaron el total: su huella ya no cuadra.
    // Es el estado en que estaba RO-3 cuando Roberto fue a agendar.
    function ordenRota() {
      const o = { id: 'RO-3', cliente: 'Amanda Ortiz', tel: '787-555-0001', vehiculo: { marca: 'Kia' },
                  servicios: [{ n: 'Frenos', p: 300 }], denegados: [], total: 372.02, estado: 'pagado' };
      sellarFactura(o);        // se sella con el contenido de arriba
      o.total = 400;           // ...y alguien/algo lo cambió después: la huella queda sin cuadrar
      return o;
    }
    function base() {
      return { ordenes: [ordenRota()], papelera: [], citas: [], bitacora: [], settings: {}, serviceParts: {} };
    }

    const out = {};

    // Sanidad: la orden de prueba está efectivamente rota.
    out.estaRota = !facturaIntacta(base().ordenes[0]);

    // --- EL CASO DE ROBERTO: agendar una cita con RO-3 ya roto de antes ---
    const antes = base();
    const prev = censo(antes);
    const despues = base();
    despues.citas.push({ id: 'CITA-NUEVA', cliente: 'Julio', fecha: '2026-08-01', hora: '10:00',
                         estado: 'agendada', servicio: 'Cambio de aceite' });
    out.citaBloqueada = verificaIntegridad(prev, despues);   // debe ser null = deja guardar

    // --- Lo que SÍ tiene que seguir bloqueando: romper una factura sana AHORA ---
    const sana = { id: 'RO-9', cliente: 'Luis', tel: '', vehiculo: {}, servicios: [{ n: 'Aceite', p: 100 }],
                   denegados: [], total: 100, estado: 'pagado' };
    sellarFactura(sana);
    const antes2 = { ordenes: [sana], papelera: [], citas: [], bitacora: [], settings: {}, serviceParts: {} };
    const prev2 = censo(antes2);
    const despues2 = JSON.parse(JSON.stringify(antes2));
    despues2.ordenes[0].total = 999;                          // alterada en ESTE guardado
    out.alterarAhora = verificaIntegridad(prev2, despues2);    // debe bloquear y nombrar RO-9

    // --- Y una factura vieja rota tampoco puede taparle la boca a un daño nuevo de verdad ---
    const antes3 = base();
    const prev3 = censo(antes3);
    const despues3 = base();
    despues3.ordenes.push(JSON.parse(JSON.stringify(sana)));
    despues3.ordenes[1].total = 555;                          // RO-9 se rompe ahora
    out.mezcla = verificaIntegridad(prev3, despues3);

    // --- Las otras tres reglas siguen vivas: una orden no puede evaporarse ---
    const antes4 = base();
    const prev4 = censo(antes4);
    const despues4 = { ordenes: [], papelera: [], citas: [], bitacora: [], settings: {}, serviceParts: {} };
    out.desaparecer = verificaIntegridad(prev4, despues4);

    return out;
  });

  is('la orden de prueba está rota (sanidad)', r.estaRota, true);
  is('🐛 EL CASO DE ROBERTO: agendar una cita con RO-3 ya roto NO se bloquea', r.citaBloqueada, null);
  ok('...y el mensaje viejo era: "la factura CERRADA RO-3 se estaría cambiando sin reabrirla"');

  const bloqueaRO9 = typeof r.alterarAhora === 'string' && /RO-9/.test(r.alterarAhora);
  is('alterar AHORA una factura sellada sigue bloqueado, y la nombra', bloqueaRO9, true);

  const mezclaOk = typeof r.mezcla === 'string' && /RO-9/.test(r.mezcla) && !/RO-3/.test(r.mezcla);
  is('con un daño viejo presente, el daño NUEVO se sigue cazando (y solo se nombra el nuevo)', mezclaOk, true);

  const desapOk = typeof r.desaparecer === 'string' && /desaparecer/.test(r.desaparecer);
  is('la regla de "no se evapora una orden" sigue viva', desapOk, true);

  is('sin errores de JavaScript', errs.length, 0, errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
