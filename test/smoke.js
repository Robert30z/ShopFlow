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
  await page.evaluate(`gotoStep(5)`); // inspección (nuevo orden)
  await page.locator('[id^="ibr-"]').first().click(); // rojo
  await page.evaluate(`gotoStep(6)`); // denegados
  await page.waitForTimeout(400);
  const autoDen = await page.locator('#den-auto').textContent();
  check((autoDen || '').includes('Detectados'), 'Auto-denegado from red inspection', (autoDen || '').slice(0, 60).trim());
  try { await vclick('#den-auto [onclick^="confirmAutoDen"]'); check(true, 'Confirm auto-denegado'); }
  catch (e) { check(false, 'Confirm auto-denegado', e.message.split('\n')[0]); }
  await page.evaluate(`gotoStep(2)`); // servicios (nuevo orden)
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
  await page.evaluate(`gotoStep(5)`); // inspección (nuevo orden)
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
  await page.fill('#c-t', '787-555-0100');
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
  // servicios ANTES de la firma (flujo real de intake) + notas
  await page.evaluate(`gotoStep(2)`);
  await page.waitForTimeout(300);
  await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first().click();
  await page.fill('#tech-n', 'Cliente trajo su alternador — sin garantía');
  await page.evaluate(`RO.techNotes=document.getElementById('tech-n').value`);
  await page.evaluate(`gotoStep(4)`); // firma de autorización (nuevo orden)
  await page.waitForTimeout(400);
  const sigBox = await page.locator('#sig-1').boundingBox();
  await page.mouse.move(sigBox.x + 30, sigBox.y + 60);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) await page.mouse.move(sigBox.x + 30 + i * 60, sigBox.y + 60 + (i % 2 ? -20 : 20), { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  // auth1 snapshot: la firma congela QUÉ se autorizó (items + total)
  const auth1 = await page.evaluate(() => RO.auth1 ? { items: RO.auth1.items.length, total: RO.auth1.total, hasRate: !!RO.auth1.rate } : null);
  check(auth1 && auth1.items === 1 && auth1.total > 0 && auth1.hasRate, 'auth1 snapshot frozen at signature (items+total+rate)', JSON.stringify(auth1));
  // Work order PDF from wizard (con precios + firma)
  const woDl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await vclick('#ro-print');
  await page.waitForTimeout(1500);
  const woModal = await page.locator('#pdf-share-modal').isVisible();
  const woName = await page.evaluate(`_pdfFilename`);
  check(woModal && woName.startsWith('ShopFlow_WO_'), 'Work order PDF generated', woName);
  await page.locator(`[onclick="downloadPDF()"]`).filter({ visible: true }).first().click();
  const woFile = await woDl;
  check(!!woFile && woFile.suggestedFilename().startsWith('ShopFlow_WO_'), 'Work order downloads', woFile ? woFile.suggestedFilename() : 'none');
  await page.locator(`[onclick="closePDFShare()"]`).filter({ visible: true }).first().click();
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
  const detailNotas = await page.evaluate(() => document.getElementById('ro-detail-body').innerText.includes('Cliente trajo su alternador'));
  check(detailNotas, 'Detail shows Notas (customer-brought part line)');
  const woBtnDetail = await page.locator(`#ro-detail-body [onclick^="printWorkOrder"]`).count();
  check(woBtnDetail === 1, 'Work order print button in abierta detail');
  await vclick(`[onclick^="continueRO"]`);
  await page.waitForTimeout(900);
  const resumed = await page.evaluate(() => ({
    name: document.getElementById('c-n').value,
    sigLabel: document.getElementById('st-sig1') ? document.getElementById('st-sig1').textContent : '',
  }));
  check(resumed.name === 'Draft Cliente', 'Resume restores client fields', resumed.name);
  check(resumed.sigLabel.includes('capturada'), 'Resume restores signature', resumed.sigLabel);
  // Complete the resumed RO (service was added before signing — new flow)
  await page.evaluate(`gotoStep(8)`);
  await page.locator(`#pan-8 [onclick="saveRO()"]`).click();
  await page.waitForTimeout(500);
  const final = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    const matches = d.ordenes.filter(x => x.cliente === 'Draft Cliente');
    return { count: matches.length, estado: matches[0] && matches[0].estado, keptInk: !!(matches[0] && matches[0].sigData && matches[0].sigData.sig1), garage: d.garage.filter(g => g.roId === matches[0].id).length };
  });
  check(final.count === 1, 'Complete upserts (no duplicate order)', `count=${final.count}`);
  check(final.estado === 'pendiente', 'Completed RO defaults to PENDIENTE (not pagado)', final.estado);
  check(final.keptInk, 'Signature ink survived completion');
  check(final.garage === 1, 'Garage entry created once', `garage=${final.garage}`);

  // ===== Marcar pagado + WhatsApp =====
  const draftId = await page.evaluate(() => JSON.parse(localStorage.getItem('sf_v1')).ordenes.find(x => x.cliente === 'Draft Cliente').id);
  await page.evaluate(`openRODetail('${draftId}')`);
  await page.waitForTimeout(500);
  const waBtn = await page.locator(`#ro-detail-body [onclick^="waRecibo"]`).count();
  check(waBtn === 1, 'WhatsApp receipt button shown (order has phone)');
  await page.locator(`#ro-detail-body [onclick^="markPaid"]`).first().click();
  await page.waitForTimeout(600);
  const paid = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('sf_v1')).ordenes.find(x => x.cliente === 'Draft Cliente'); return { estado: o.estado, fecha: !!o.pagadoFecha }; });
  check(paid.estado === 'pagado' && paid.fecha, 'Marcar pagado works + records payment date', JSON.stringify(paid));
  const waNumOk = await page.evaluate(`waNum('787-555-0100')`);
  check(waNumOk === '17875550100', 'waNum normalizes PR phone', waNumOk);
  // Reminder button on home for upcoming maintenance
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('sf_v1'));
    d.ordenes.find(x => x.cliente === 'Draft Cliente').nextDate = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
    localStorage.setItem('sf_v1', JSON.stringify(d));
    DB = JSON.parse(localStorage.getItem('sf_v1'));
    go('home');
  });
  await page.waitForTimeout(400);
  const remindBtn = await page.locator(`#home-notifs [onclick^="waRemind"]`).count();
  check(remindBtn >= 1, 'WhatsApp reminder button on home notification', `buttons=${remindBtn}`);

  // ===== PWA: manifest, icons, service worker =====
  const pwa = await page.evaluate(async () => ({
    manifestLink: !!document.querySelector('link[rel="manifest"]'),
    sw: (await fetch('sw.js')).ok,
    manifest: (await fetch('manifest.json')).ok,
    icon192: (await fetch('icon-192.png')).ok,
    icon512: (await fetch('icon-512.png')).ok,
    swReg: !!(await navigator.serviceWorker.getRegistration()),
  }));
  check(pwa.manifestLink && pwa.manifest, 'Manifest linked and served');
  check(pwa.sw && pwa.icon192 && pwa.icon512, 'Service worker + icons served');
  check(pwa.swReg, 'Service worker registered');

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

  // ===== v1.4: Citas / Agenda =====
  await page.evaluate(`go('citas')`);
  await page.waitForTimeout(400);
  await page.fill('#ct-n', 'Cita Smoke');
  await page.fill('#ct-t', '787-555-0100');
  await page.fill('#ct-v', '2019 Honda Civic');
  await page.fill('#ct-s', 'Frenos');
  await page.evaluate(`saveCita()`);
  await page.waitForTimeout(300);
  const cita = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { n: d.citas.length, cliente: (d.citas[0] || {}).cliente, rendered: document.getElementById('citas-body').innerHTML.includes('Cita Smoke') }; });
  check(cita.n === 1 && cita.cliente === 'Cita Smoke' && cita.rendered, 'Cita created + rendered', JSON.stringify({ n: cita.n }));
  await page.evaluate(`go('home')`);
  await page.waitForTimeout(300);
  const homeCita = await page.evaluate(() => document.getElementById('home-citas').innerHTML.includes('Cita Smoke'));
  check(homeCita, 'Cita shows on home (Citas de hoy)');
  // cita → RO prefill (year/make/model parsed from "2019 Honda Civic")
  await page.evaluate(`citaToRO(DB.citas[0].id)`);
  await page.waitForTimeout(500);
  const pre = await page.evaluate(() => ({ c: RO.cliente, y: RO.vehiculo.year, ma: RO.vehiculo.make, mo: RO.vehiculo.model, estado: DB.citas[0].estado }));
  check(pre.c === 'Cita Smoke' && pre.y === '2019' && pre.ma === 'Honda' && pre.mo === 'Civic' && pre.estado === 'completada', 'Cita → RO prefill + marked completada', JSON.stringify(pre));

  // ===== v1.4: Seguimientos + DVI + Cobro (seeded data, window.open stubbed) =====
  const seg = await page.evaluate(`(function(){
    var D=86400000;
    DB.settings.reviewLink='https://g.page/r/test';DB.settings.athMovil='787-555-0199';
    DB.ordenes.push({id:'RO-SM1',fecha:new Date(Date.now()-5*D).toISOString(),cliente:'Seg Smoke',tel:'787-555-0122',
      vehiculo:{year:'2017',make:'Toyota',model:'Yaris'},servicios:[{id:'s1',n:'Aceite',ep:45,qty:1}],
      denegados:[{nombre:'Frenos',precio:180,nota:'al 15%'}],insp:{oil:'verde',belt:'rojo'},inspNotes:{belt:'agrietada'},
      total:50,pago:'ATH Móvil',estado:'pendiente',fotos:[]});
    saveDB();
    var opened=[];window.open=function(u){opened.push(u);return null;};
    var types0=getSeguimientos().map(function(s){return s.type;});
    waFollowUp('RO-SM1');
    var afterFu=!!DB.ordenes.find(function(o){return o.id==='RO-SM1';}).segFu;
    var revQueued=getSeguimientos().some(function(s){return s.type==='rev';});
    waDVI('RO-SM1');
    var dvi=decodeURIComponent(opened[opened.length-1]);
    waCobro('RO-SM1');
    var cobro=decodeURIComponent(opened[opened.length-1]);
    openRODetail('RO-SM1');
    var det=document.getElementById('ro-detail-body').innerHTML;
    return {types0:types0,afterFu:afterFu,revQueued:revQueued,
      dviOk:dvi.indexOf('CRÍTICO')>-1&&dvi.indexOf('agrietada')>-1,
      cobroOk:cobro.indexOf('$50.00')>-1&&cobro.indexOf('787-555-0199')>-1,
      dviBtns:det.indexOf('DVI WhatsApp')>-1&&det.indexOf('DVI PDF')>-1,
      cobroBtn:det.indexOf('Cobrar por WhatsApp')>-1,
      dviPdfFn:typeof dviPDF==='function',kpiFn:typeof renderKPIs==='function'};
  })()`);
  check(seg.types0.includes('fu'), 'Seguimientos queue detects 3-day follow-up', JSON.stringify(seg.types0));
  check(seg.afterFu && seg.revQueued, 'Follow-up marks sent → review request queues next');
  check(seg.dviOk, 'DVI WhatsApp message includes critical findings + notes');
  check(seg.cobroOk, 'Cobro message includes total + ATH Móvil number');
  check(seg.dviBtns && seg.cobroBtn, 'RO detail shows DVI + Cobrar buttons');
  check(seg.dviPdfFn, 'dviPDF function present');

  // ===== v1.4: KPIs tab =====
  await page.evaluate(`go('finanzas');finTab('f-kpi')`);
  await page.waitForTimeout(400);
  const kpi = await page.evaluate(() => { const k = document.getElementById('f-kpi').innerHTML; return { tiles: k.includes('Ticket prom.') && k.includes('Aprobación') && k.includes('Retención'), bars: (k.match(/border-radius:4px 4px 0 0/g) || []).length }; });
  check(kpi.tiles && kpi.bars === 8, 'KPI panel renders (tiles + 8 weekly bars)', 'bars=' + kpi.bars);

  // ===== v1.4: Ajustes ATH + review link fields =====
  await page.evaluate(`go('ajustes')`);
  await page.waitForTimeout(300);
  const aj = await page.evaluate(() => ({ ath: (document.getElementById('set-ath') || {}).value, rev: (document.getElementById('set-review') || {}).value }));
  check(aj.ath === '787-555-0199' && aj.rev === 'https://g.page/r/test', 'Ajustes: ATH Móvil + review link persist', JSON.stringify(aj));

  // ===== Catálogo del taller: servicios y categorías propias =====
  await page.fill('#cs-n', 'Alineamiento 4 ruedas');
  await page.fill('#cs-p', '89');
  await page.selectOption('#cs-c', 'suspension');
  await page.evaluate(`addCustomSvc()`);
  await page.waitForTimeout(200);
  const cs = await page.evaluate(`(function(){var s=DB.svcsCustom[DB.svcsCustom.length-1];return {n:s.n,p:s.p,persisted:JSON.parse(localStorage.getItem('sf_v1')).svcsCustom.length>0,inCat:getSvcs('suspension').some(function(x){return x.id===s.id;})};})()`);
  check(cs.n === 'Alineamiento 4 ruedas' && cs.p === 89 && cs.persisted && cs.inCat, 'Custom service saved + merged into catalog', JSON.stringify(cs));
  const cc = await page.evaluate(`(function(){DB.catsCustom.push({id:'cc-test',l:'Escape'});DB.svcsCustom.push({id:'cs-test2',cat:'cc-test',n:'Soldadura de escape',p:60,c:0});saveDB();renderCatalogAdmin();return {cat:allCats().some(function(c){return c.id==='cc-test';}),svc:getSvcs('cc-test').length,listed:document.getElementById('cs-list').innerHTML.includes('Soldadura de escape'),inSelect:document.getElementById('cs-c').innerHTML.includes('Escape')};})()`);
  check(cc.cat && cc.svc === 1 && cc.listed && cc.inSelect, 'Custom category + service render in admin', JSON.stringify(cc));
  const roPick = await page.evaluate(`(async function(){go('ro');await new Promise(function(r){setTimeout(r,400);});await gotoStep(2);await new Promise(function(r){setTimeout(r,300);});activeCat='cc-test';renderROSvcMenu();var html=(document.getElementById('ro-sl')||{innerHTML:''}).innerHTML;var cats=(document.getElementById('ro-sc')||{innerHTML:''}).innerHTML;return {svcShown:html.includes('Soldadura de escape'),catShown:cats.includes('Escape')};})()`);
  check(roPick.svcShown && roPick.catShown, 'Custom service selectable in RO wizard', JSON.stringify(roPick));

  // ===== v1.4: NHTSA VIN decode (stubbed fetch → autofill) =====
  const vin = await page.evaluate(`(async function(){
    go('ro');await new Promise(function(r){setTimeout(r,400);});
    var realFetch=window.fetch;
    window.fetch=function(){return Promise.resolve({json:function(){return Promise.resolve({Results:[{ModelYear:'2003',Make:'HONDA',Model:'Accord'}]});}});};
    decodeVIN('1HGCM82633A004352');
    await new Promise(function(r){setTimeout(r,400);});
    window.fetch=realFetch;
    return {y:document.getElementById('v-y').value,ma:document.getElementById('v-ma').value,mo:document.getElementById('v-mo').value,
      info:document.getElementById('vin-decode-info').textContent.indexOf('NHTSA')>-1};
  })()`);
  check(vin.y === '2003' && vin.ma === 'Honda' && vin.mo === 'Accord' && vin.info, 'VIN decode (NHTSA) autofills año/marca/modelo', JSON.stringify(vin));

  // cleanup v1.4 seeds so the delete-RO check below still sees exactly one RO
  await page.evaluate(`(function(){DB.ordenes=DB.ordenes.filter(function(o){return o.id!=='RO-SM1';});DB.citas=[];saveDB();})()`);

  // Delete RO removes garage entry (no orphans)
  await page.evaluate(`go('historial')`);
  await page.waitForTimeout(400);
  await page.locator(`#historial [onclick^="openRODetail"]`).first().click();
  await page.waitForTimeout(400);
  await vclick(`[onclick*="deleteRO"]`);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { o: d.ordenes.length, g: d.garage.length, orphans: d.garage.filter(g => !d.ordenes.find(o => o.id === g.roId)).length }; });
  check(after.o === 1 && after.orphans === 0, 'deleteRO cleans garage entry (no orphans)', JSON.stringify(after));

  // ===== Técnicos: usernames automáticos TEC-n + asignación + reloj =====
  const tec = await page.evaluate(`(function(){
    document.getElementById('tec-n').value='Luis';document.getElementById('tec-c').value='15';addTecnico();
    document.getElementById('tec-n').value='Kevin';addTecnico();
    var d=JSON.parse(localStorage.getItem('sf_v1'));
    return {ids:DB.tecnicos.map(function(t){return t.id;}),com:DB.tecnicos[0].com,persisted:d.tecnicos.length===2,listed:document.getElementById('tec-list').innerHTML.includes('TEC-2')};
  })()`);
  check(tec.ids.join(',') === 'TEC-1,TEC-2' && tec.com === 15 && tec.persisted && tec.listed, 'Técnicos get auto usernames TEC-1/TEC-2 + persist + listed', JSON.stringify(tec));
  const asg = await page.evaluate(`(function(){
    var o=DB.ordenes[0];asignarTec(o.id,'TEC-1');
    var d=JSON.parse(localStorage.getItem('sf_v1'));
    return {saved:d.ordenes[0].tecnico==='TEC-1',sel:tecOptionsHTML('TEC-1').includes('value="TEC-1" selected')};
  })()`);
  check(asg.saved && asg.sel, 'Técnico assigned to job + selector marks it', JSON.stringify(asg));
  const clk = await page.evaluate(`(function(){
    var o=DB.ordenes[0];iniciarReloj(o.id);
    o.reloj.in=new Date(Date.now()-65000).toISOString();
    detenerReloj(o.id);
    return {secs:o.relojSecs,tec:o.relojLog[0].tec,stopped:!o.reloj};
  })()`);
  check(clk.secs >= 60 && clk.tec === 'TEC-1' && clk.stopped, 'Time clock accumulates seconds under the técnico', JSON.stringify(clk));

  // ===== Trabajos guardados (canned jobs con precio+horas+piezas) =====
  const job = await page.evaluate(`(async function(){
    go('ro');await new Promise(function(r){setTimeout(r,400);});
    RO.servicios.push({id:'x1',uid:'u1',n:'Frenos Smoke Job',p:100,ep:100,qty:1,laborHours:1.5,parts:[{name:'Pastillas',partNum:'',supplier:'',cost:10,sellPrice:25,qty:2,receipt:''}]});
    saveJobTemplate(RO.servicios.length-1);
    var d=JSON.parse(localStorage.getItem('sf_v1'));var j=d.jobsCustom[d.jobsCustom.length-1];
    RO.servicios=[];activeCat='__jobs';renderROSvcMenu();
    var shown=document.getElementById('ro-sl').innerHTML.includes('Frenos Smoke Job');
    addJobRO(DB.jobsCustom[DB.jobsCustom.length-1].id);
    var s=RO.servicios[0];
    return {saved:!!j&&j.laborHours===1.5&&j.parts.length===1,shown:shown,reused:s&&s.laborHours===1.5&&s.parts.length===1&&s.parts[0].sellPrice===25,total:jobTotal(j)};
  })()`);
  check(job.saved && job.shown && job.reused && job.total > 200, 'Trabajo guardado: saves + shows in ⭐ Guardados + re-adds with hours/parts', JSON.stringify(job));

  // ===== Recuperar denegado: cliente aprobó → mover a servicios =====
  const den = await page.evaluate(`(function(){
    var o=DB.ordenes[0];o.estado='pagado';o.tel='787-555-0100';
    var oldTotal=o.total||0;var oldSvcs=(o.servicios||[]).length;
    o.denegados=o.denegados||[];o.denegados.push({nombre:'Rotores traseros Smoke',precio:200,urgencia:'urgente'});
    apruebaDen(o.id,o.denegados.length-1);
    return {moved:o.servicios.length===oldSvcs+1&&o.servicios[o.servicios.length-1].n==='Rotores traseros Smoke',estado:o.estado,abonado:o.abonado===oldTotal,recalc:o.total>oldTotal};
  })()`);
  check(den.moved && den.estado === 'pendiente' && den.abonado && den.recalc, 'Denegado aprobado moves to servicios + recalcs total + credits abono', JSON.stringify(den));

  // ===== IVU en P&L + CSV para el contable =====
  const ivu = await page.evaluate(`(function(){
    go('finanzas');renderPL();
    var ym=new Date().getFullYear()+'-'+('0'+(new Date().getMonth()+1)).slice(-2);
    var csv=buildContableCSV(ym);
    return {row:document.getElementById('f-pl').innerHTML.includes('IVU cobrado'),tecCard:document.getElementById('f-pl').innerHTML.includes('TEC-1'),csvBtn:document.getElementById('f-pl').innerHTML.includes('exportContableCSV'),csvOrden:csv.includes(DB.ordenes[0].id),csvSecciones:csv.includes('ORDENES')&&csv.includes('GASTOS')&&csv.includes('TOTAL')};
  })()`);
  check(ivu.row && ivu.tecCard && ivu.csvBtn && ivu.csvOrden && ivu.csvSecciones, 'P&L shows IVU cobrado + técnicos card; CSV has órdenes/IVU/gastos', JSON.stringify(ivu));

  // ===== Seguimientos: denegado 30d + recordatorio de cita mañana =====
  const segNew = await page.evaluate(`(function(){
    var D=86400000;
    DB.ordenes.push({id:'RO-SEGDEN',fecha:new Date(Date.now()-35*D).toISOString(),cliente:'Seg Den',tel:'787-555-0177',vehiculo:{},servicios:[],denegados:[{nombre:'Amortiguadores',precio:260,urgencia:'pronto'}],estado:'pagado',total:100,insp:{}});
    var tm=new Date(Date.now()+D);var ymd=tm.getFullYear()+'-'+('0'+(tm.getMonth()+1)).slice(-2)+'-'+('0'+tm.getDate()).slice(-2);
    DB.citas.push({id:'CITA-SEG',cliente:'Cita Seg',tel:'787-555-0178',fecha:ymd,hora:'10:00',vehiculo:'',servicio:'Frenos',direccion:'',estado:'agendada',creado:new Date().toISOString()});
    var types=getSeguimientos().map(function(s){return s.type;});
    // limpiar los seeds para no ensuciar los checks del modo demo
    DB.ordenes=DB.ordenes.filter(function(o){return o.id!=='RO-SEGDEN';});
    DB.citas=DB.citas.filter(function(c){return c.id!=='CITA-SEG';});
    saveDB();
    return {den:types.indexOf('den')>-1,cita:types.indexOf('cita')>-1,citaFirst:types[0]==='cita'};
  })()`);
  check(segNew.den && segNew.cita && segNew.citaFirst, 'Seguimientos queue: denied-work 30d + cita-mañana (cita first)', JSON.stringify(segNew));

  // ===== Promociones (combos a precio fijo) =====
  const promo = await page.evaluate(`(async function(){
    DB.promos.push({id:'pr-smoke',n:'Aceite y filtro te regalamos un lavado de motor',det:'Cambio de aceite y filtro + lavado de motor',p:120,hasta:'',on:true});
    DB.promos.push({id:'pr-dead',n:'Promo vencida',det:'',p:50,hasta:'2020-01-01',on:true});
    DB.promos.push({id:'pr-off',n:'Promo pausada',det:'',p:50,hasta:'',on:false});
    saveDB();
    go('ro');await new Promise(function(r){setTimeout(r,400);});
    RO.servicios=[];activeCat='__promos';renderROSvcMenu();
    var list=document.getElementById('ro-sl').innerHTML;
    var chip=document.getElementById('ro-sc').innerHTML.includes('Promos');
    addPromoRO('pr-smoke');
    var s=RO.servicios[0];
    return {chip:chip,shows:list.includes('lavado de motor'),hidesDead:!list.includes('vencida')&&!list.includes('pausada'),added:s&&s.ep===120&&s.promo===true&&s.n.includes('incluye')};
  })()`);
  check(promo.chip && promo.shows && promo.hidesDead && promo.added, 'Promo: 🎁 chip + only vigentes shown + adds combo line at fixed price', JSON.stringify(promo));

  // ===== Descuento en $ o % con motivo =====
  const desc = await page.evaluate(`(function(){
    RO.servicios=[{id:'d1',uid:'ud1',n:'Test',p:100,ep:100,qty:1,parts:[],laborHours:0}];
    RO.cortesia=false;RO.descuento=20;RO.descTipo='$';RO.descMotivo='cliente frecuente';
    var totD=calcEst();
    var okD=Math.abs(totD-(80*1.115))<0.01&&RO.descValor===20;
    RO.descTipo='%';var totP=calcEst();
    var okP=Math.abs(totP-(80*1.115))<0.01;
    return {okD:okD,okP:okP,valor:RO.descValor};
  })()`);
  check(desc.okD && desc.okP, 'Descuento: $ fijo y % calculan bien y guardan descValor', JSON.stringify(desc));

  // ===== Cortesía interna (el taller asume el costo) =====
  const cort = await page.evaluate(`(function(){
    RO.servicios=[{id:'c1',uid:'uc1',n:'Cambio de aceite',p:45,ep:45,qty:1,parts:[],laborHours:0}];
    RO.descuento=0;RO.cortesia=true;RO.cortesiaMotivo='disculpa por demora';
    var tot=calcEst();
    var o={servicios:RO.servicios,cortesia:true,cortesiaMotivo:'disculpa por demora',descuento:0};
    recalcROTotal(o);
    DB.ordenes.push({id:'RO-CORT',fecha:new Date().toISOString(),cliente:'Cortesia Smoke',tel:'',vehiculo:{},servicios:o.servicios,estado:'pagado',pago:'Cortesía',cortesia:true,cortesiaMotivo:'disculpa por demora',cortesiaValor:o.cortesiaValor,descValor:0,total:0,insp:{}});
    var ym=new Date().getFullYear()+'-'+('0'+(new Date().getMonth()+1)).slice(-2);
    var csv=buildContableCSV(ym);
    go('finanzas');renderKPIs();
    var kpi=document.getElementById('f-kpi').innerHTML;
    DB.ordenes=DB.ordenes.filter(function(x){return x.id!=='RO-CORT';});saveDB();RO.cortesia=false;RO.cortesiaMotivo='';
    return {tot0:tot===0,valor:o.cortesiaValor===45&&o.total===0,csv:csv.includes('Cortesia')&&csv.includes('disculpa por demora'),kpi:kpi.includes('Regalado')&&kpi.includes('Cortesías')};
  })()`);
  check(cort.tot0 && cort.valor && cort.csv && cort.kpi, 'Cortesía: total $0 + cortesiaValor registrado + CSV con motivo + KPI Regalado', JSON.stringify(cort));

  // ===== Modo demo (entra → datos de ejemplo + backup pausado; sale → datos reales intactos) =====
  const preDemo = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { o: d.ordenes.length, svcs: d.svcsCustom.map(s => s.n) }; });
  await page.evaluate(`setTimeout(function(){enterDemo();},50)`); // reload va fuera del evaluate (destruye el contexto)
  await page.waitForTimeout(2500);
  const demo = await page.evaluate(() => ({
    flag: !!DB._demo,
    ordenes: DB.ordenes.length,
    pill: !!document.getElementById('demo-pill'),
    realSaved: localStorage.getItem('sf_v1_real') !== null,
    fotos: DB.ordenes.some(o => (o.fotos || []).length > 0),
    sigs: DB.ordenes.some(o => o.sigData && o.sigData.sig1),
    abierta: DB.ordenes.some(o => o.estado === 'abierta'),
    citas: DB.citas.length
  }));
  check(demo.flag && demo.ordenes >= 25 && demo.pill && demo.realSaved && demo.fotos && demo.sigs && demo.abierta && demo.citas >= 3, 'Demo mode seeds full dataset + banner + real-data snapshot', JSON.stringify({ o: demo.ordenes, citas: demo.citas, pill: demo.pill, saved: demo.realSaved }));
  const demoBk = await page.evaluate(`(function(){DB.settings.backup={repo:'x/y',token:'t-fake'};var before=_cbTimer;scheduleCloudBackup();var scheduled=_cbTimer!==before&&_cbTimer!=null;cloudBackup(false);return {scheduled:scheduled,busy:_cbBusy};})()`);
  check(!demoBk.scheduled && !demoBk.busy, 'Cloud backup fully paused while in demo', JSON.stringify(demoBk));
  await page.evaluate(`setTimeout(function(){exitDemo();},50)`);
  await page.waitForTimeout(2500);
  const postDemo = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('sf_v1')); return { o: d.ordenes.length, svcs: d.svcsCustom.map(s => s.n), flag: !!d._demo, snapGone: localStorage.getItem('sf_v1_real') === null, pill: !!document.getElementById('demo-pill') }; });
  check(postDemo.o === preDemo.o && JSON.stringify(postDemo.svcs) === JSON.stringify(preDemo.svcs) && !postDemo.flag && postDemo.snapGone && !postDemo.pill, 'Exit demo restores real data exactly + clears snapshot', JSON.stringify({ before: preDemo.o, after: postDemo.o, snapGone: postDemo.snapGone }));

  console.log('\nPage errors: ' + (errors.join(' | ') || '(none)'));
  console.log(`\n=== ${failures === 0 ? 'SMOKE TEST PASSED' : failures + ' FAILURE(S)'} ===`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
