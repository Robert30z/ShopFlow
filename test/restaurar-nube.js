// EL BOTÓN "RESTAURAR" TIENE QUE FUNCIONAR CON EL RESPALDO QUE ÉL TIENE DE VERDAD.
// Auditoría 2026-07-27 (parte 3). `importBackup` se blindó el 26-jul; su función hermana
// `restoreFromCloud` — el botón que usaría si PIERDE el equipo — quedó cruda. Medido en la app:
//   · un respaldo de antes del 24-jul (fotos base64 inline, 5.15 MB) iba entero a localStorage
//     => "⚠️ ALMACENAMIENTO LLENO", en disco quedaban 641 bytes... y la app decía igual
//     "Datos restaurados desde la nube ✓ (1 órdenes)". Mentía.
//   · sin normalizar: una lista corrompida en el respaldo dejaba home, clientes, finanzas,
//     garage y citas tirando excepciones. La app quedaba inservible después de "recuperar".
//   · sin roCounter, la próxima orden se llamaría RO-1 y PISARÍA una existente (upsertRO une
//     por id).
// Usage:  python -m http.server 8931   (raíz del repo) + node restaurar-nube.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const r = await page.evaluate(() => {
    const foto = 'data:image/jpeg;base64,' + 'A'.repeat(300000);   // ~300 KB por foto
    const fotos = []; for (let i = 0; i < 18; i++) fotos.push({ d: foto, t: new Date().toISOString() });
    const bk = {
      ordenes: [{
        id: 'RO-7', fecha: new Date().toISOString(), cliente: 'Cliente Nube', tel: '7875551234',
        vehiculo: { year: '2018', make: 'Honda', model: 'Civic' },
        servicios: [{ id: 's1', n: 'Frenos', p: 200, ep: 200, qty: 1, parts: [], laborHours: 0 }],
        denegados: [], insp: {}, total: 223, estado: 'pagado',
        sigData: { sig1: 'data:image/png;base64,AAA' }, fotos: fotos
      }],
      clientes: 'ESTO NO ES UNA LISTA',      // campo corrompido
      settings: { shopName: 'Pit Stop' }
      // sin roCounter, sin garage, sin gastos, sin citas, sin papelera, sin bitacora
    };
    const megas = JSON.stringify(bk).length / 1048576;
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(bk))));
    DB.ordenes = []; DB.settings.backup = { repo: 'x/y', token: 'ghp_falso' };
    saveDB({ force: true });
    const of = window.fetch, oc = window.confirm, oa = window.alert;
    const alerts = [];
    window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ content: b64 }) });
    window.confirm = () => true;
    window.alert = m => alerts.push(String(m));
    return new Promise(res => {
      restoreFromCloud();
      setTimeout(() => {
        window.fetch = of; window.confirm = oc; window.alert = oa;
        const o = (DB.ordenes || [])[0] || {};
        const render = {};
        ['home', 'clientes', 'ordenes', 'finanzas', 'garage', 'citas'].forEach(p => {
          try { go(p); render[p] = 'ok'; } catch (e) { render[p] = 'ERROR'; }
        });
        res({
          megas: +megas.toFixed(2),
          alerts: alerts,
          ordenes: (DB.ordenes || []).length,
          inline: (o.fotos || []).filter(f => f && f.d && !f.id).length,
          refs: (o.fotos || []).filter(f => f && f.id).length,
          firma: !!(o.sigData || {}).sig1,
          lsBytes: (localStorage.getItem('sf_v1') || '').length,
          enDisco: (JSON.parse(localStorage.getItem('sf_v1') || '{}').ordenes || []).length,
          listasOk: ['clientes', 'garage', 'gastos', 'citas', 'papelera', 'bitacora'].every(k => Array.isArray(DB[k])),
          roCounter: DB.roCounter, proxima: previewRONum(),
          render: render
        });
      }, 2000);
    });
  });

  is('el respaldo de prueba pesa más que la cuota de Safari', r.megas > 5, true);
  is('restaurar SÍ guarda en el equipo (no revienta la cuota)', r.enDisco, 1);
  is('las fotos se movieron a IndexedDB (0 inline, 18 referencias)', [r.inline, r.refs], [0, 18]);
  is('localStorage queda chiquito (megas → KB)', r.lsBytes < 50000, true);
  is('la firma del cliente sobrevive la restauración', r.firma, true);
  is('un solo aviso, y honesto (no "restaurado ✓" tras fallar)', r.alerts.length, 1);
  is('el aviso confirma la restauración', /restaurados desde la nube/.test(r.alerts[0] || ''), true);
  is('las listas corrompidas quedan normalizadas', r.listasOk, true);
  is('la app renderiza todas las pantallas después de restaurar', r.render,
     { home: 'ok', clientes: 'ok', ordenes: 'ok', finanzas: 'ok', garage: 'ok', citas: 'ok' });
  is('el contador sale del id más alto del respaldo (RO-7)', r.roCounter, 7);
  is('la próxima orden NO pisa una existente', r.proxima, 'RO-8');

  // --- el mismo normalizador protege importar y arrancar ---
  const otros = await page.evaluate(() => {
    // arrancar con un localStorage corrompido no puede tumbar la app
    localStorage.setItem('sf_v1', JSON.stringify({ ordenes: [{ id: 'RO-12' }], gastos: { malo: 1 }, settings: 'texto' }));
    loadDB();
    const arranque = { listas: Array.isArray(DB.gastos), rate: DB.settings.laborRate, counter: DB.roCounter };
    return arranque;
  });
  is('arrancar con datos corrompidos normaliza en vez de tumbar', otros.listas, true);
  is('el laborRate vuelve a su valor por defecto', otros.rate, 103);
  is('y el contador se deriva del id más alto (RO-12)', otros.counter, 12);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
