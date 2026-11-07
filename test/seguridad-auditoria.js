// AUDITORIA DE SEGURIDAD 6-nov-2026 (skill security-audit de Cloudflare, arreglos 1-3).
//   1) El link "#s=" que se manda al cliente: un telefono armado con HTML ("><img onerror=...>)
//      se pegaba crudo en el href del boton de aprobar -> codigo corriendo en el origen de la app.
//   2) La Bitacora pintaba e.det crudo; el nombre y la IP de quien aprueba vienen de AFUERA
//      (aprob_registrar), asi que un cliente podia meter HTML en la bitacora del taller.
//   3) "Exportar respaldo" sacaba la llave de IA y el token de GitHub en el archivo; e
//      "Importar" adoptaba el repo/token del archivo en un equipo sin respaldo configurado.
// Usage:  python -m http.server 8931   (raiz del repo) + node seguridad-auditoria.js
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('[PASS] ' + n); } else { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); } };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. #s= con telefono armado ----------
  const r1 = await page.evaluate(() => {
    window.__xss = 0;
    const d = { n: 'T', id: 'RO-1', c: 'X', tot: 1, st: 2, sv: [],
      ph: '"><img src=x onerror="window.__xss=1">7875551234' };
    location.hash = 's=' + _b64e(JSON.stringify(d));
    renderCustomerStatus();
    return new Promise(r => setTimeout(() => r({
      xss: window.__xss,
      imgs: document.querySelectorAll('img[src="x"]').length,
      hrefs: [...document.querySelectorAll('a[href*="wa.me"]')].map(a => a.getAttribute('href'))
    }), 600));
  });
  ok(r1.xss === 0 && r1.imgs === 0, 'el telefono del link #s= no mete HTML en la pagina', r1);
  ok(r1.hrefs.length > 0 && r1.hrefs.every(h => /^https:\/\/wa\.me\/\d+(\?|$)/.test(h)),
     'los botones de WhatsApp llevan solo los digitos del telefono', r1.hrefs);

  // vuelve a la app normal
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 2. Bitacora con nombre/IP armados ----------
  const r2 = await page.evaluate(() => {
    window.__xss = 0;
    const div = document.createElement('div'); div.id = 'seg-body'; document.body.appendChild(div);
    if (!document.getElementById('seg-titulo')) { const t = document.createElement('div'); t.id = 'seg-titulo'; document.body.appendChild(t); }
    const b = document.getElementById('seg-body');
    DB.bitacora = (DB.bitacora || []).concat([{ tipo: 'estimado-aprobado', roId: 'RO-1', ts: Date.now(), dev: 'x',
      det: '$1.00 DESDE EL LINK · <img src=x onerror="window.__xss=2"> · IP <b>1.2.3.4</b>' }]);
    renderBitacora();
    return new Promise(r => setTimeout(() => r({ xss: window.__xss,
      imgs: b.querySelectorAll('img').length, bold: b.querySelectorAll('b').length,
      texto: b.innerText.includes('<img src=x') }), 600));
  });
  ok(r2.xss === 0 && r2.imgs === 0 && r2.bold === 0, 'la bitacora pinta el detalle como TEXTO, no como HTML', r2);
  ok(r2.texto, 'y el texto se sigue leyendo completo', r2);

  // ---------- 3a. Exportar respaldo sin secretos ----------
  const r3 = await page.evaluate(() => new Promise(res => {
    DB.settings = DB.settings || {};
    DB.settings.aiKey = 'sk-ant-DUMMY';
    DB.settings.backup = { repo: 'dummy/dummy', token: 'ghp_DUMMY' };
    const oc = URL.createObjectURL;
    URL.createObjectURL = b => { b.text().then(t => { URL.createObjectURL = oc; res(t); }); return 'blob:x'; };
    const okc = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { };
    try { exportBackup(); } finally { HTMLAnchorElement.prototype.click = okc; }
  }));
  const r3s = (JSON.parse(r3).settings) || {};
  ok(!r3.includes('sk-ant-DUMMY') && !r3.includes('ghp_DUMMY') && !('aiKey' in r3s) && !('backup' in r3s),
     'el archivo exportado NO trae la llave de IA ni la config del respaldo');
  const live = await page.evaluate(() => ({ k: DB.settings.aiKey, t: (DB.settings.backup || {}).token }));
  ok(live.k === 'sk-ant-DUMMY' && live.t === 'ghp_DUMMY', 'y el equipo conserva los suyos (no se borran del DB vivo)', live);

  // ---------- 3b. Importar no adopta el repo/token de un archivo ajeno ----------
  await page.evaluate(() => { delete DB.settings.backup; delete DB.settings.aiKey; saveDB({ force: true }); });
  const tmp = path.join(os.tmpdir(), 'sf-ajeno-' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ ordenes: [{ id: 'RO-9', fecha: new Date().toISOString(), servicios: [] }],
    clientes: [], settings: { aiKey: 'sk-ant-AJENA', backup: { repo: 'atacante/repo', token: 'ghp_AJENO' } } }));
  await page.locator('#import-file').setInputFiles(tmp);
  await page.waitForTimeout(3500);
  const r4 = await page.evaluate(() => ({ b: (DB.settings || {}).backup || null, k: (DB.settings || {}).aiKey || null,
    n: (DB.ordenes || []).length }));
  ok(r4.n === 1, 'el respaldo se importo', r4);
  ok(!r4.b && !r4.k, 'pero NO adopto el repo/token ni la llave del archivo', r4);
  fs.unlinkSync(tmp);

  // ---------- 3c. Importar en un equipo CON respaldo conserva el suyo ----------
  await page.evaluate(() => { DB.settings.backup = { repo: 'Robert30z/x', token: 'ghp_MIO' }; DB.settings.aiKey = 'sk-ant-MIA'; saveDB({ force: true }); });
  const tmp2 = path.join(os.tmpdir(), 'sf-ajeno2-' + Date.now() + '.json');
  fs.writeFileSync(tmp2, JSON.stringify({ ordenes: [], clientes: [], settings: { aiKey: 'sk-ant-AJENA', backup: { repo: 'atacante/repo', token: 'ghp_AJENO' } } }));
  await page.locator('#import-file').setInputFiles(tmp2);
  await page.waitForTimeout(3500);
  const r5 = await page.evaluate(() => { const st = DB.settings || {}; return { t: (st.backup || {}).token, r: (st.backup || {}).repo, k: st.aiKey }; });
  ok(r5.t === 'ghp_MIO' && r5.r === 'Robert30z/x' && r5.k === 'sk-ant-MIA', 'un equipo con respaldo propio se queda con el suyo', r5);
  fs.unlinkSync(tmp2);

  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
