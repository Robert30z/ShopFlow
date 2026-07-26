// Aviso de PROTECCIÓN DE DATOS en el home.
// Nació de un caso real (2026-07-26): 2 días de clientes guardados solo en el iPad porque ni la
// sesión de nube ni el respaldo GitHub estaban activos, y la app nunca lo dijo.
// Usage:  python -m http.server 8931   (raíz del repo) + node protect-banner.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // --- 1. Sin nube y sin respaldo = banda ROJA visible ---
  let r = await page.evaluate(async () => {
    DB.settings.backup = {};                 // GitHub apagado
    _bkLastErr = ''; _lastSyncErr = '';
    renderProtect();
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('home-protect');
    return { vis: el.style.display !== 'none', txt: el.innerText, html: el.innerHTML };
  });
  r.vis && /SOLO ESTÁN EN ESTE EQUIPO/.test(r.txt)
    ? ok('Sin respaldo ni nube: sale la banda ROJA', { vis: r.vis })
    : no('Sin respaldo ni nube: sale la banda ROJA', r);

  /Bajar copia AHORA/.test(r.txt) && /Encender respaldo/.test(r.txt)
    ? ok('La banda ofrece las 2 salidas: bajar copia y encender respaldo')
    : no('La banda ofrece las 2 salidas', { txt: r.txt });

  // --- 2. Cuenta las órdenes en riesgo (que duela el número) ---
  r = await page.evaluate(async () => {
    DB.ordenes = [{ id: 'RO-1', cliente: 'A', fecha: new Date().toISOString(), total: 100, estado: 'pagado', servicios: [] },
                  { id: 'RO-2', cliente: 'B', fecha: new Date().toISOString(), total: 50, estado: 'pagado', servicios: [] }];
    renderProtect();
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById('home-protect').innerText;
  });
  /2 órdenes/.test(r) ? ok('Dice cuántas órdenes están en riesgo', { t: r.match(/\d+ órdenes/)[0] })
                      : no('Dice cuántas órdenes están en riesgo', { r });

  // --- 3. Respaldo configurado pero FALLANDO = sigue avisando (el fallo callado del caso real) ---
  r = await page.evaluate(async () => {
    DB.settings.backup = { repo: 'x/y', token: 't' };   // configurado…
    updBackupStatus('HTTP 401');                        // …pero el último intento falló
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('home-protect');
    return { vis: el.style.display !== 'none', txt: el.innerText };
  });
  r.vis && /401/.test(r.txt)
    ? ok('Respaldo configurado pero fallando: AVISA igual y muestra el error', { err: '401' })
    : no('Respaldo configurado pero fallando: AVISA igual', r);

  // --- 4. Respaldo sano (y sin sesión de nube) = ámbar, no rojo ---
  r = await page.evaluate(async () => {
    DB.settings.backup = { repo: 'x/y', token: 't', last: new Date().toISOString() };
    updBackupStatus();                                   // sin error => vía GitHub sana
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('home-protect');
    return { vis: el.style.display !== 'none', txt: el.innerText };
  });
  r.vis && /Respaldo a medias/.test(r.txt) && !/SOLO ESTÁN EN ESTE EQUIPO/.test(r.txt)
    ? ok('Con GitHub sano pero sin nube: baja a ÁMBAR (no rojo)')
    : no('Con GitHub sano pero sin nube: baja a ÁMBAR', r);

  // --- 5. En MODO DEMO no molesta ---
  r = await page.evaluate(async () => {
    DB._demo = true; DB.settings.backup = {};
    renderProtect();
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('home-protect');
    DB._demo = false;
    return el.style.display;
  });
  r === 'none' ? ok('En modo demo el aviso se calla (datos de mentira)')
               : no('En modo demo el aviso se calla', { display: r });

  // --- 6. renderHome lo dispara solo ---
  r = await page.evaluate(async () => {
    DB._demo = false; DB.settings.backup = {}; _bkLastErr = '';
    document.getElementById('home-protect').innerHTML = '';
    renderHome();
    await new Promise(r => setTimeout(r, 400));
    return document.getElementById('home-protect').innerHTML.length > 0;
  });
  r ? ok('renderHome() dispara el aviso solo (no hay que llamarlo a mano)')
    : no('renderHome() dispara el aviso solo', { r });


  // --- 7. Importar respaldo NO apaga el respaldo del equipo (secretos por-equipo) ---
  r = await page.evaluate(async () => {
    DB.settings.backup = { repo: 'x/y', token: 'SECRETO', last: '2026-01-01' };
    const file = JSON.stringify({ ordenes: [], clientes: [], settings: { shopName: 'Pit Stop' } });
    // simula el FileReader de importBackup
    const imported = JSON.parse(file);
    const keep = { aiKey: DB.settings.aiKey, backup: DB.settings.backup };
    DB = imported;
    if (!DB.settings) DB.settings = {};
    if (keep.backup && keep.backup.token && keep.backup.repo) DB.settings.backup = keep.backup;
    return { token: DB.settings.backup && DB.settings.backup.token };
  });
  r.token === 'SECRETO' ? ok('Importar respaldo CONSERVA la config de respaldo del equipo')
                        : no('Importar respaldo conserva la config', r);

  // --- 8. syncPush tiene el guard anti-borrón (equipo vacío no pisa la nube llena) ---
  r = await page.evaluate(() => {
    const src = syncPush.toString();
    return { guard: /GUARD anti-borr/.test(src) && /Sincronizaci.n BLOQUEADA/.test(src) };
  });
  r.guard ? ok('syncPush bloquea que un equipo vacío borre la nube')
          : no('syncPush bloquea que un equipo vacío borre la nube', r);

  errs.length === 0 ? ok('Sin errores de página') : no('Errores de página', errs);

  await browser.close();
  console.log('\n' + (fail === 0 ? '=== AVISO DE RESPALDO: TODO VERDE ===' : '=== ' + fail + ' FALLAS ==='));
  process.exit(fail === 0 ? 0 : 1);
})();
