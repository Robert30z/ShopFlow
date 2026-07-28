// LA FOTO PEGADA AL PUNTO QUE LA EXPLICA (y con la misma protección que las demás).
// Batch 16 (27-jul). Hasta ahora las fotos eran una lista suelta de la orden: no había forma de
// probar CUÁL foto era de las pastillas. Ahora cada punto de inspección tiene las suyas.
// El riesgo al añadirlas era crear una clase de foto de segunda: si las tuberías (migrar a
// IndexedDB, subir a Supabase, el censo del guard) siguen mirando solo `o.fotos`, las nuevas se
// quedan en un equipo, sin respaldo y sin protección — justo el bug que costó órdenes en julio.
// Usage:  python -m http.server 8931   (raíz del repo) + node fotos-inspeccion.js
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

  // ---------- 1. LA UI: el botón sale donde se marca el problema ----------
  const ui = await page.evaluate(() => {
    go('ro');
    RO.id = 'RO-900'; RO.cliente = 'Ana';
    setInsp('frenos', 'pf', 'rojo');       // pastillas delanteras en crítico
    setInsp('frenos', 'pr', 'verde');      // traseras bien
    const vis = id => { const e = document.getElementById(id); return e ? e.style.display : 'no-existe'; };
    return { critico: vis('inx-pf'), bueno: vis('inx-pr'), hayBoton: !!document.querySelector('#inx-pf button') };
  });
  is('el botón de foto aparece en el punto marcado crítico', ui.critico, 'block');
  is('y NO en los puntos que están bien', ui.bueno, 'none');
  is('el botón existe', ui.hayBoton, true);

  // ---------- 2. LAS FOTOS VIVEN PEGADAS A SU PUNTO ----------
  const guardar = await page.evaluate(async () => {
    const px = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
    RO.inspFotos = {};
    _camDest = { insp: 'pf' };
    _camArr().push(storePhoto(px));
    _camArr().push(storePhoto(px));
    _camDest = { insp: 'tfl' };
    _camArr().push(storePhoto(px));
    _camDest = null;
    _camArr().push(storePhoto(px));       // una foto suelta de la orden
    RO.insp = { pf: 'rojo', tfl: 'amarillo' };
    RO.servicios = [{ id: 's1', uid: 'u1', n: 'Frenos', p: 139, ep: 139, qty: 1, parts: [], laborHours: 0 }];
    const sel = document.getElementById('est-estado'); if (sel) sel.value = 'pendiente';
    const oa = window.alert; window.alert = () => { };
    saveRO();
    window.alert = oa;
    const o = DB.ordenes[DB.ordenes.length - 1];
    return {
      pf: ((o.inspFotos || {}).pf || []).length,
      tfl: ((o.inspFotos || {}).tfl || []).length,
      sueltas: (o.fotos || []).length,
      todasRef: listasDeFotos(o).every(a => a.every(f => f && f.id)),
      censo: censo(DB).fotos,
      id: o.id
    };
  });
  is('cada punto guarda SUS fotos (2 en pastillas, 1 en goma)', [guardar.pf, guardar.tfl], [2, 1]);
  is('las fotos sueltas de la orden siguen aparte', guardar.sueltas, 1);
  is('todas quedan como referencia (no base64 en localStorage)', guardar.todasRef, true);
  is('el censo del guard las cuenta TODAS (4), no solo las sueltas', guardar.censo, 4);

  // ---------- 3. EL GUARD LAS PROTEGE IGUAL QUE LAS DEMÁS ----------
  const guard = await page.evaluate(id => {
    const o = DB.ordenes.find(x => x.id === id);
    o.inspFotos.pf = [];                       // desaparición no declarada
    let msg = null; const oa = window.alert; window.alert = m => { msg = m; };
    const r = saveDB();
    window.alert = oa;
    const vuelta = DB.ordenes.find(x => x.id === id);
    return { guardo: r, aviso: /fotos/.test(msg || ''), pfDespues: ((vuelta.inspFotos || {}).pf || []).length };
  }, guardar.id);
  is('borrar fotos de un punto por debajo queda BLOQUEADO', [guard.guardo, guard.aviso], [false, true]);
  is('y las fotos vuelven', guard.pfDespues, 2);

  // ---------- 4. SOBREVIVEN AL RESPALDO Y AL REGRESO ----------
  const viaje = await page.evaluate(id => {
    const payload = JSON.parse(cloudBackupPayload());
    const o = (payload.ordenes || []).find(x => x.id === id);
    return { enRespaldo: ((o.inspFotos || {}).pf || []).length, conRuta: ((o.inspFotos || {}).pf || []).every(f => !!f.id) };
  }, guardar.id);
  is('las fotos por punto viajan en el respaldo de la nube', viaje.enRespaldo, 2);
  is('como referencia (el respaldo no engorda)', viaje.conRuta, true);

  // ---------- 5. SALEN EN EL REPORTE DEL CLIENTE (DVI PDF) ----------
  const pdf = await page.evaluate(async id => {
    return new Promise(res => {
      // Se inspecciona el PDF DE VERDAD (sus bytes), no una llamada intermedia.
      let guardado = null, crudo = '';
      const oShare = window.sharePDFDoc;
      window.sharePDFDoc = function (doc, fname) { guardado = fname; try { crudo = doc.output(); } catch (e) { crudo = 'ERR'; } };
      dviPDF(id);
      setTimeout(() => {
        window.sharePDFDoc = oShare;
        res({
          archivo: guardado,
          porPunto: crudo.indexOf('EVIDENCIA POR PUNTO REVISADO') >= 0,
          etiqueta: /Front pads/.test(crudo),
          imagenes: (crudo.match(/DCTDecode/g) || []).length     // cada JPEG incrustado
        });
      }, 1500);
    });
  }, guardar.id);
  is('el DVI PDF se genera', !!pdf.archivo, true);
  is('con la sección de evidencia por punto revisado', pdf.porPunto, true);
  is('y nombra el punto al que pertenece la foto', pdf.etiqueta, true);
  // jsPDF deduplica imagenes identicas: la prueba usa el mismo pixel varias veces, asi que
  // basta comprobar que hay JPEG incrustado de verdad en el PDF.
  is('y trae las fotos incrustadas (evidencia, no palabras)', pdf.imagenes >= 1, true);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
