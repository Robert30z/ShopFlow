// EN EL CIERRE SE VE LA ORDEN COMPLETA (Boss 18-nov-2026: "en la ultima pagina, la del cierre, poder ver el RO
// completo para confirmar que hice todo bien"). Vigila que el resumen salga lleno con lo que se escribio.
// Usage:  python -m http.server 8931 (raiz del repo) + node cierre-resumen.js [carpeta-captura]
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let fail = 0;
const check = (ok, n, d) => { console.log('[' + (ok ? 'PASS' : 'FAIL') + '] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); if (!ok) fail++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 200))); page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(1500);
  await page.evaluate(() => go('ro')); await page.waitForTimeout(400);
  await page.fill('#c-n', 'Cliente Resumen'); await page.fill('#v-y', '2015'); await page.fill('#v-ma', 'Toyota'); await page.fill('#v-mo', 'Corolla');
  await page.evaluate(() => gotoStep(2)); await page.waitForTimeout(300);
  const svc = await page.locator('#ro-sl [onclick^="addSvcRO"]').filter({ visible: true }).first();
  await svc.click(); await page.waitForTimeout(200);
  const nombreSvc = await page.evaluate(() => RO.servicios[0] && RO.servicios[0].n);
  await page.evaluate(() => gotoStep(8)); await page.waitForTimeout(500);
  const txt = (await page.textContent('#cier-resumen')) || '';
  check(txt.includes('Cliente Resumen'), 'el resumen trae al cliente');
  check(/Corolla/.test(txt), 'el resumen trae el carro');
  check(!!nombreSvc && txt.includes(nombreSvc), 'el resumen trae el servicio', nombreSvc);
  check(/Total/.test(txt), 'el resumen trae el total');
  check(await page.locator('#cier-resumen-card button', { hasText: 'pantalla completa' }).isVisible(), 'boton de pantalla completa visible');
  check(await page.locator('#pan-8 [onclick="saveRO()"]').isVisible(), 'el boton de guardar sigue en el Cierre');
  // cambiar algo y volver al cierre: el resumen se actualiza
  await page.evaluate(() => gotoStep(0)); await page.fill('#c-n', 'Cliente Cambiado'); await page.evaluate(() => { RO.cliente = 'Cliente Cambiado'; gotoStep(8); }); await page.waitForTimeout(400);
  check(((await page.textContent('#cier-resumen')) || '').includes('Cliente Cambiado'), 'el resumen se repinta al volver al Cierre');
  // Codex 18-nov: lo que se escribe NO se ejecuta como codigo al pintar el resumen (ahora sale solo al entrar a Cierre)
  await page.evaluate(() => { RO.cliente = '<img src=x onerror="window.__xss=1">'; RO.servicios[0].n = '<b onmouseover=1>Aceite</b>'; RO.queja = '<script>window.__xss=2</script>'; gotoStep(8); });
  await page.waitForTimeout(500);
  check(!(await page.evaluate(() => window.__xss)), 'XSS: un nombre con HTML no se ejecuta en el resumen');
  check(((await page.textContent('#cier-resumen')) || '').includes('<img src=x'), 'XSS: el nombre sale como texto, tal cual');
  check(await page.evaluate(() => !document.querySelector('#cier-resumen img, #cier-resumen b[onmouseover]')), 'XSS: no se crean etiquetas desde lo escrito');
  if (process.argv[2]) await page.screenshot({ path: process.argv[2] + '/cierre-390.png', fullPage: false });
  check(errs.length === 0, 'Sin errores de JS', errs);
  await browser.close();
  console.log(fail ? '\n' + fail + ' FALLO(S)' : '\nTODO VERDE'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
