// 🚨 EL RESPALDO NO PUEDE DECIR QUE ESTÁ SANO SIN HABERLE PREGUNTADO A LA NUBE.
// Caso real: del 24-jul 4:15pm al 04-sep NO subió una sola orden a GitHub y el aviso del home
// estuvo VERDE los 43 días. La causa: `gitOk` miraba `_bkLastErr`, una bandera en memoria que se
// borra en CADA recarga, en vez de la fecha del último respaldo que SÍ subió.
// Usage:  python -m http.server 8931   (raíz del repo) + node respaldo-no-miente.js
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
  // El reintento de arranque dispara a los 4s: se le deja pasar ANTES de tocar la config,
  // si no compite con las pruebas y anota una revision que no le toca (asi se cayo la 5).
  await page.waitForTimeout(5200);

  const banner = async () => await page.evaluate(async () => {
    renderProtect();
    await new Promise(r => setTimeout(r, 400));
    const el = document.getElementById('home-protect');
    return { vis: el.style.display !== 'none', txt: el.innerText };
  });

  // --- 1. EL CASO EXACTO: configurado, 43 días sin subir, app recién abierta (sin error en memoria)
  let r = await page.evaluate(async () => {
    DB._demo = false; _bkLastErr = ''; _lastSyncErr = '';
    DB.ordenes = [{ id: 'RO-1', cliente: 'A', fecha: new Date().toISOString(), total: 100, estado: 'pagado', servicios: [] }];
    DB._rev = 812;
    DB.settings.backup = { repo: 'x/y', token: 't', last: new Date(Date.now() - 43 * 86400000).toISOString(), rev: 4 };
    const st = await new Promise(res => protectState(res));
    return { nivel: st.nivel, gitOk: st.gitOk, atrasado: st.atrasado, horas: Math.round(st.horas) };
  });
  r.gitOk === false && r.atrasado === true
    ? ok('43 días sin subir y app recién abierta: la vía GitHub NO cuenta como sana', r)
    : no('43 días sin subir: la vía GitHub NO cuenta como sana', r);

  r = await banner();
  r.vis && /43 días que no sube nada a GitHub/.test(r.txt)
    ? ok('El aviso dice CUÁNTO lleva sin subir', { t: (r.txt.match(/Hace \d+ días[^.]*\./) || [''])[0] })
    : no('El aviso dice cuánto lleva sin subir', r);

  // --- 2. Configurado pero NUNCA respaldado = tampoco es verde
  r = await page.evaluate(async () => {
    DB.settings.backup = { repo: 'x/y', token: 't' };   // sin `last` ni `rev`
    const st = await new Promise(res => protectState(res));
    renderProtect(); await new Promise(x => setTimeout(x, 400));
    return { gitOk: st.gitOk, txt: document.getElementById('home-protect').innerText };
  });
  r.gitOk === false && /Nunca se ha subido un respaldo a GitHub/.test(r.txt)
    ? ok('Configurado pero nunca respaldado: avisa y lo dice con esas palabras')
    : no('Configurado pero nunca respaldado: avisa', r);

  // --- 3. Respaldo AL DÍA (revisión subida == revisión actual) = sí es sano
  r = await page.evaluate(async () => {
    DB._rev = 812;
    DB.settings.backup = { repo: 'x/y', token: 't', last: new Date().toISOString(), rev: 812 };
    const st = await new Promise(res => protectState(res));
    return { gitOk: st.gitOk, atrasado: st.atrasado, pend: backupPendiente() };
  });
  r.gitOk === true && r.pend === false
    ? ok('Con lo último ya subido: la vía GitHub sí cuenta como sana', r)
    : no('Con lo último ya subido: la vía GitHub sí cuenta como sana', r);

  // --- 4. Una orden nueva después del último respaldo deja la vía atrasada (no en verde)
  r = await page.evaluate(async () => {
    DB.settings.backup = { repo: 'x/y', token: 't', last: new Date(Date.now() - 3 * 3600000).toISOString(), rev: 812 };
    DB._rev = 813;                                   // guardó una orden y no subió
    const st = await new Promise(res => protectState(res));
    return { gitOk: st.gitOk, pend: backupPendiente() };
  });
  r.gitOk === false && r.pend === true
    ? ok('Trabajo guardado y sin subir: se cae del verde aunque no haya error')
    : no('Trabajo guardado y sin subir: se cae del verde', r);

  // --- 5. LA TRAMPA: si guarda MIENTRAS el PUT viaja, ese cambio NO se da por respaldado
  r = await page.evaluate(async () => {
    const real = window.fetch;
    DB._rev = 900;
    DB.settings.backup = { repo: 'x/y', token: 't' };
    window.fetch = function (url, opts) {
      if (!opts || opts.method !== 'PUT') return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
      DB._rev = 905;                                  // el usuario guardó mientras el PUT viajaba
      return Promise.resolve({ ok: true, status: 200 });
    };
    cloudBackup(false);
    await new Promise(x => setTimeout(x, 700));
    window.fetch = real;
    return { revAnotada: DB.settings.backup.rev, revAhora: DB._rev, pend: backupPendiente() };
  });
  r.revAnotada === 900 && r.revAhora === 905 && r.pend === true
    ? ok('La revisión se anota al ARMAR el envío: lo guardado a mitad de vuelo sigue pendiente', r)
    : no('La revisión se anota al armar el envío', r);

  // --- 6. Un respaldo que sube de verdad SÍ apaga el aviso
  r = await page.evaluate(async () => {
    const real = window.fetch;
    DB._rev = 950;
    DB.settings.backup = { repo: 'x/y', token: 't' };
    window.fetch = function (url, opts) {
      if (!opts || opts.method !== 'PUT') return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
      return Promise.resolve({ ok: true, status: 200 });
    };
    cloudBackup(false);
    await new Promise(x => setTimeout(x, 700));
    window.fetch = real;
    return { pend: backupPendiente(), rev: DB.settings.backup.rev, last: !!DB.settings.backup.last };
  });
  r.pend === false && r.rev === 950 && r.last
    ? ok('Un respaldo que sube de verdad deja la vía al día')
    : no('Un respaldo que sube de verdad deja la vía al día', r);

  // --- 7. La red de seguridad existe y está enganchada donde tiene que estar
  r = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    return {
      flush: typeof flushCloudBackup === 'function',
      arranque: html.indexOf('try{flushCloudBackup();}catch(e){}},4000)') !== -1,
      esconder: html.indexOf("visibilityState==='hidden'){saveDraft();saveFields();try{flushCloudBackup") !== -1,
      pagehide: html.indexOf("pagehide',function(){saveDraft();saveFields();try{flushCloudBackup") !== -1,
      debounce: BK_DEBOUNCE
    };
  });
  r.flush && r.arranque && r.esconder && r.pagehide && r.debounce <= 15000
    ? ok('Se reintenta al abrir, al esconder la pantalla y al cerrar', r)
    : no('Se reintenta al abrir, al esconder y al cerrar', r);

  // --- 8. En modo demo nada de esto molesta ni sube
  r = await page.evaluate(() => {
    DB._demo = true;
    const pend = backupPendiente();
    DB._demo = false;
    return { pend };
  });
  r.pend === false ? ok('En modo demo no hay nada pendiente que subir (el demo jamás pisa el respaldo real)')
                   : no('En modo demo no hay nada pendiente', r);

  // --- 9. CODEX: fecha del último respaldo EN EL FUTURO (reloj del equipo adelantado) ---
  //     La edad salía negativa, no pasaba la holgura de media hora, y el aviso se quedaba VERDE.
  r = await page.evaluate(async () => {
    DB._rev = 812;
    DB.settings.backup = { repo: 'x/y', token: 't', last: new Date(Date.now() + 5 * 3600000).toISOString(), rev: 4 };
    const st = await new Promise(res => protectState(res));
    renderProtect(); await new Promise(x => setTimeout(x, 400));
    return { gitOk: st.gitOk, atrasado: st.atrasado, inf: st.horas === Infinity, txt: document.getElementById('home-protect').innerText };
  });
  r.gitOk === false && r.atrasado === true && r.inf && /no cuadra con el reloj/.test(r.txt)
    ? ok('Fecha en el futuro: no se cree la fecha, avisa igual y dice por qué')
    : no('Fecha en el futuro: avisa igual', r);

  // --- 10. CODEX: con una subida EN VUELO, el flush reprograma en vez de comerse el reintento ---
  r = await page.evaluate(() => {
    DB._demo = false; DB._rev = 1;
    DB.settings.backup = { repo: 'x/y', token: 't' };
    _cbBusy = true; _cbBusyAt = Date.now();
    clearTimeout(_cbTimer); _cbTimer = null;
    flushCloudBackup();
    const t = _cbTimer;
    _cbBusy = false; clearTimeout(_cbTimer); _cbTimer = null;
    return { reprogramado: t !== null && t !== undefined };
  });
  r.reprogramado ? ok('Subida en vuelo: el flush REPROGRAMA, no pierde el cambio')
                 : no('Subida en vuelo: el flush reprograma', r);

  // --- 11. CODEX: una subida colgada (iOS suspende la app) no puede trancar el respaldo para siempre ---
  r = await page.evaluate(() => {
    _cbBusy = true; _cbBusyAt = Date.now() - 70000;   // arrancó hace 70s y nunca resolvió
    const ocupadoViejo = cbOcupado();
    _cbBusy = true; _cbBusyAt = Date.now();           // una que sí está viva
    const ocupadoVivo = cbOcupado();
    _cbBusy = false;
    return { ocupadoViejo, ocupadoVivo };
  });
  r.ocupadoViejo === false && r.ocupadoVivo === true
    ? ok('Una subida colgada caduca a los 60s y otra toma el relevo (no tranca el respaldo)')
    : no('Una subida colgada caduca', r);

  // --- 12. OPENCODE: dos subidas SOLAPADAS (red lenta + la bandera de ocupado caduca) ---
  //     Con la revisión en una variable compartida, la segunda subida le pisaba el número a la
  //     primera, y la primera al confirmar marcaba como respaldado trabajo que NO subió.
  r = await page.evaluate(async () => {
    const real = window.fetch;
    DB._demo = false; DB._rev = 1000;
    DB.settings.backup = { repo: 'x/y', token: 't' };
    let n = 0;
    window.fetch = function (url, opts) {
      if (!opts || opts.method !== 'PUT') return Promise.resolve({ status: 404, json: () => Promise.resolve({}) });
      n++;
      const espera = (n === 1) ? 600 : 50;       // la 1ra va lenta (señal mala en el taller)
      return new Promise(res => setTimeout(() => res({ ok: true, status: 200 }), espera));
    };
    cloudBackup(false);                           // subida 1, lleva _rev = 1000
    await new Promise(x => setTimeout(x, 80));
    _cbBusyAt = Date.now() - 70000;               // la 1ra parece colgada: caduca la bandera
    DB._rev = 1010;                               // y mientras tanto guardó más trabajo
    cloudBackup(false);                           // subida 2, lleva _rev = 1010
    await new Promise(x => setTimeout(x, 1300));  // terminan las dos (la 1ra, de última)
    window.fetch = real;
    return { rev: DB.settings.backup.rev, puts: n };
  });
  r.puts === 2 && r.rev === 1000
    ? ok('Dos subidas solapadas: cada una anota SU revisión, no la de la otra', r)
    : no('Dos subidas solapadas: cada una anota su revisión', r);

  errs.length === 0 ? ok('Sin errores de página') : no('Errores de página', errs);
  await browser.close();
  console.log('\n' + pass + ' pass / ' + fail + ' fail — ' + (fail === 0 ? '=== EL RESPALDO YA NO MIENTE ===' : '=== ' + fail + ' FALLAS ==='));
  process.exit(fail === 0 ? 0 : 1);
})();
