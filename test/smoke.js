// ShopFlow smoke test — drives the full app headlessly and exits non-zero on failure.
// Usage:  python -m http.server 8931   (repo root, separate terminal)
//         cd test && npm install && node smoke.js
const { chromium } = require('playwright');

const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let failures = 0;
function check(ok, name, detail) {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message.slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('cdn')) errors.push(m.text().slice(0, 200)); });
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const vclick = sel => page.locator(sel).filter({ visible: true }).first().click({ timeout: 5000 });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  check(true, 'App loads');

  // Every nav screen
  for (const s of ['garage', 'ordenes', 'clientes', 'menu', 'finanzas', 'historial', 'inventario', 'ajustes']) {
    try { await vclick(`[onclick="go('${s}')"]`); await page.waitForTimeout(250); await vclick(`[onclick="go('home')"]`); check(true, `Screen: ${s}`); }
    catch (e) { check(false, `Screen: ${s}`, e.message.split('\n')[0]); }
  }

  // RO wizard: create, inspect (incl. rojo → auto-denegado), sign, service, save
  await vclick(`[onclick="go('ro')"]`);
  await page.waitForTimeout(500);
  await page.fill('#c-n', 'Smoke Test');
  await page.fill('#v-y', '2020'); await page.fill('#v-ma', 'Toyota'); await page.fill('#v-mo', 'Corolla');
  await page.evaluate(`gotoStep(3)`);
  await page.locator('[id^="ibr-"]').first().click(); // rojo
  await page.evaluate(`gotoStep(5)`);
  await page.waitForTimeout(400);
  const autoDen = await page.locator('#den-auto').textContent();
  check((autoDen || '').includes('Detectados'), 'Auto-denegado from red inspection', (autoDen || '').slice(0, 60).trim());
  try { await vclick('#den-auto [onclick^="confirmAutoDen"]'); check(true, 'Confirm auto-denegado'); }
  catch (e) { check(false, 'Confirm auto-denegado', e.message.split('\n')[0]); }
  await page.evaluate(`gotoStep(4)`);
  await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first().click();
  await page.evaluate(`gotoStep(8)`);
  const nDialogs = dialogs.length;
  await page.locator(`#pan-8 [onclick="saveRO()"]`).click();
  await page.waitForTimeout(600);
  check(dialogs.slice(nDialogs).join('').includes('guardada'), 'RO saved', dialogs[dialogs.length - 1]);

  // Órdenes card is clickable → detail opens
  await vclick(`[onclick="go('ordenes')"]`);
  await page.waitForTimeout(400);
  try {
    await vclick(`#ordenes [onclick^="openRODetail"]`);
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => { const e = document.getElementById('rod-title'); return e && (e.offsetWidth || e.offsetHeight) ? e.textContent : null; });
    check(!!t, 'Órdenes card opens RO detail', t || 'detail not visible');
  } catch (e) { check(false, 'Órdenes card opens RO detail', e.message.split('\n')[0]); }

  // Garage lifecycle
  await page.evaluate(`go('garage')`);
  await page.waitForTimeout(300);
  try {
    await vclick(`#garage [onclick*="ready"]`);
    await page.evaluate(`gTab('g-lst')`);
    await vclick(`#garage [onclick*="entregado"]`);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('sf_v1')).garage.map(g => g.estado).join(','));
    check(st.includes('entregado'), 'Garage working→ready→entregado', st);
  } catch (e) { check(false, 'Garage lifecycle', e.message.split('\n')[0]); }

  // Inventory add modal opens (regression: dead Agregar button)
  await page.evaluate(`go('inventario')`);
  await page.waitForTimeout(300);
  await vclick(`[onclick="openAddInv()"]`);
  await page.waitForTimeout(300);
  check(await page.locator('#inv-modal').isVisible(), 'Inventario add modal opens');
  await page.evaluate(() => {
    document.getElementById('inv-fn').value = 'Filtro smoke';
    document.getElementById('inv-qty').value = '2';
    saveInvItem();
  });
  const inv = await page.evaluate(() => JSON.parse(localStorage.getItem('sf_v1')).inventario.length);
  check(inv > 0, 'Inventario item saved', `${inv} item(s)`);

  // AI without key → friendly message, no crash
  await page.evaluate(`go('ro')`);
  await page.waitForTimeout(400);
  await page.fill('#v-y', '2020'); await page.fill('#v-ma', 'Toyota'); await page.fill('#v-mo', 'Corolla');
  await page.evaluate(`gotoStep(3)`);
  const ePre = errors.length;
  await vclick(`[onclick="aiDiagnosticSummary()"]`);
  await page.waitForTimeout(800);
  const aiBox = await page.locator('#ai-diag-result').textContent();
  check((aiBox || '').includes('API key'), 'AI no-key message shown', (aiBox || '').slice(0, 60).trim());
  check(errors.length === ePre, 'AI no-key path throws no errors');

  // ===== OPEN RO (draft) lifecycle: save with signature, resume, complete =====
  await page.evaluate(`go('ro')`);
  await page.waitForTimeout(600);
  await page.fill('#c-n', 'Draft Cliente');
  await page.fill('#v-y', '2018'); await page.fill('#v-ma', 'Ford'); await page.fill('#v-mo', 'F-150');
  // photo with timestamp (1x1 png → compressed jpeg object)
  await page.evaluate(`gotoStep(1)`);
  await page.waitForTimeout(300);
  const fs = require('fs'), os = require('os');
  const tmpPng = require('path').join(os.tmpdir(), 'sf_smoke_photo.png');
  fs.writeFileSync(tmpPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.locator('#pan-1 input[type="file"]').setInputFiles(tmpPng);
  await page.waitForTimeout(700);
  const foto = await page.evaluate(() => { const f = (RO.fotos || [])[0]; return f ? { obj: typeof f === 'object', hasT: !!f.t, jpeg: (f.d || '').startsWith('data:image/jpeg') } : null; });
  check(foto && foto.obj && foto.hasT, 'Photo saved with timestamp', JSON.stringify(foto));
  await page.evaluate(`gotoStep(2)`); // firma 1
  await page.waitForTimeout(400);
  const sigBox = await page.locator('#sig-1').boundingBox();
  await page.mouse.move(sigBox.x + 30, sigBox.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(sigBox.x + 30 + i * 60, sigBox.y + 60 + (i % 2 ? -20 : 20), { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dB = dialogs.length;
  await vclick('#ro-save');
  await page.waitForTimeout(500);
  check(dialogs.slice(dB).join('').includes('ABIERTA'), 'Save open RO (draft)', dialogs[dialogs.length - 1]);
  const draft = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const o = d.ordenes.find(x => x.cliente === 'Draft Cliente');
    return o ? { estado: o.estado, hasInk: !!(o.sigData && o.sigData.sig1 && o.sigData.sig1.startsWith('data:image/png')), hasTime: !!(o.sigTimes && o.sigTimes.sig1), id: o.id } : null;
  });
  check(draft && draft.estado === 'abierta', 'Draft saved with estado abierta', JSON.stringify(draft));
  check(draft && draft.hasInk && draft.hasTime, 'Signature INK + timestamp persisted', draft ? `ink:${draft.hasInk} time:${draft.hasTime}` : 'no draft');
  const legal = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const o = d.ordenes.find(x => x.cliente === 'Draft Cliente');
    return { termsV: o && o.terms && o.terms.v, termsFrozen: !!(o && o.terms && o.terms.text && o.terms.text.includes('NO TIENEN GARANTÍA ALGUNA')), fotos: o && o.fotos ? o.fotos.length : 0 };
  });
  check(legal.termsV === 3 && legal.termsFrozen, 'Terms v3 snapshot frozen at signature (customer-parts exclusion)', JSON.stringify(legal));
  check(legal.fotos === 1, 'Photo persisted in saved draft', `fotos=${legal.fotos}`);
  // Detail shows signature evidence + Continuar
  await page.evaluate(`go('home')`);
  await page.waitForTimeout(300);
  await page.evaluate(`openRODetail('${draft.id}')`);
  await page.waitForTimeout(500);
  const detailHasSig = await page.locator('#ro-detail-body img[src^="data:image/png"]').count();
  check(detailHasSig > 0, 'Detail shows stored signature image');
  const detailFotos = await page.locator('#ro-detail-body [onclick^="openFotoViewer"]').count();
  check(detailFotos === 1, 'Detail shows photo evidence grid', `thumbnails=${detailFotos}`);
  await page.locator('#ro-detail-body [onclick^="openFotoViewer"]').first().click();
  await page.waitForTimeout(400);
  const viewer = await page.evaluate(() => ({ visible: document.getElementById('foto-viewer').style.display === 'flex', caption: document.getElementById('foto-viewer-caption').textContent }));
  check(viewer.visible && viewer.caption.includes('Capturada'), 'Photo viewer opens with capture timestamp', viewer.caption.slice(0, 80));
  await page.evaluate(`closeFotoViewer()`);
  await vclick(`[onclick^="continueRO"]`);
  await page.waitForTimeout(900);
  const resumed = await page.evaluate(() => ({
    name: document.getElementById('c-n').value,
    sigLabel: document.getElementById('st-sig1') ? document.getElementById('st-sig1').textContent : '',
  }));
  check(resumed.name === 'Draft Cliente', 'Resume restores client fields', resumed.name);
  check(resumed.sigLabel.includes('capturada'), 'Resume restores signature', resumed.sigLabel);
  // Complete the resumed RO
  await page.evaluate(`gotoStep(4)`);
  await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first().click();
  await page.evaluate(`gotoStep(8)`);
  await page.locator(`#pan-8 [onclick="saveRO()"]`).click();
  await page.waitForTimeout(500);
  const final = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const matches = d.ordenes.filter(x => x.cliente === 'Draft Cliente');
    return { count: matches.length, estado: matches[0] && matches[0].estado, keptInk: !!(matches[0] && matches[0].sigData && matches[0].sigData.sig1), garage: d.garage.filter(g => g.roId === matches[0].id).length };
  });
  check(final.count === 1, 'Complete upserts (no duplicate order)', `count=${final.count}`);
  check(final.estado !== 'abierta', 'Completed RO left abierta state', final.estado);
  check(final.keptInk, 'Signature ink survived completion');
  check(final.garage === 1, 'Garage entry created once', `garage=${final.garage}`);

  // ===== Cloud backup UI + unconfigured no-op =====
  await page.evaluate(`go('ajustes')`);
  await page.waitForTimeout(400);
  const bk = await page.evaluate(() => ({
    hasRepo: !!document.getElementById('set-bk-repo'),
    hasToken: !!document.getElementById('set-bk-token'),
    status: (document.getElementById('set-bk-status') || {}).textContent || '',
  }));
  check(bk.hasRepo && bk.hasToken, 'Cloud backup config UI present');
  check(bk.status.includes('Sin configurar'), 'Backup status warns when unconfigured', bk.status.slice(0, 60));
  const ePre2 = errors.length;
  await page.evaluate(`scheduleCloudBackup();saveDB()`);
  await page.waitForTimeout(400);
  check(errors.length === ePre2, 'Backup no-ops safely without config');

  // Delete RO removes garage entry (no orphans)
  await page.evaluate(`go('historial')`);
  await page.waitForTimeout(400);
  await page.locator(`#historial [onclick^="openRODetail"]`).first().click();
  await page.waitForTimeout(400);
  await vclick(`[onclick*="deleteRO"]`);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { o: d.ordenes.length, g: d.garage.length, orphans: d.garage.filter(g => !d.ordenes.find(o => o.id === g.roId)).length }; });
  check(after.o === 1 && after.orphans === 0, 'deleteRO cleans garage entry (no orphans)', JSON.stringify(after));

  console.log('\nPage errors: ' + (errors.join(' | ') || '(none)'));
  console.log(`\n=== ${failures === 0 ? 'SMOKE TEST PASSED' : failures + ' FAILURE(S)'} ===`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
