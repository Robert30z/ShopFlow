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

  // Delete RO removes garage entry (no orphans)
  await page.evaluate(`go('historial')`);
  await page.waitForTimeout(400);
  await page.locator(`#historial [onclick^="openRODetail"]`).first().click();
  await page.waitForTimeout(400);
  await vclick(`[onclick*="deleteRO"]`);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { o: d.ordenes.length, g: d.garage.length }; });
  check(after.o === 0 && after.g === 0, 'deleteRO cleans garage entry', JSON.stringify(after));

  console.log('\nPage errors: ' + (errors.join(' | ') || '(none)'));
  console.log(`\n=== ${failures === 0 ? 'SMOKE TEST PASSED' : failures + ' FAILURE(S)'} ===`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
