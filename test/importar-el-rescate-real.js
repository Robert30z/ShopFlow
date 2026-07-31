// EL CAMINO DE RECUPERACIÓN, PROBADO CON EL ARCHIVO DE VERDAD.
// Inspección del 31-jul-2026, eje 3 del estándar: "probar el camino de recuperación con el
// archivo de verdad, no solo generarlo". La lección del 07-26 fue justo esa: el respaldo se
// generaba bien pero el import habría fallado, y nadie lo sabía porque nunca se importó.
//
// Este archivo NO es de mentira: es `ShopFlow-Rescate/RESCATE-shopflow-2026-07-24.json`, el
// respaldo real de Roberto. Lo que lo hace peligroso:
//   · 4.59 MB, con 35 FOTOS INLINE en base64 (4.57 MB solos). Meter eso en localStorage revienta
//     la cuota de Safari (~5 MB) — es exactamente el fallo "ALMACENAMIENTO LLENO" del 24-jul.
//     Tienen que acabar en IndexedDB antes del primer saveDB.
//   · NO trae `papelera` ni `bitacora` (no son listas): si no se normaliza, la app revienta al
//     renderizar o el guard cuenta mal.
//   · RO-2 está PAGADA y firmada pero SIN sellar (`_cerrada` ausente) — hay que confirmar que
//     importarla no la marca como alterada ni tranca los guardados siguientes.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node importar-el-rescate-real.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
const RESCATE = process.env.SHOPFLOW_RESCATE ||
  'C:/Users/Roberto Mendez/Desktop/HQ/Pit Stop/ShopFlow-Rescate/RESCATE-shopflow-2026-07-24.json';

let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  if (!fs.existsSync(RESCATE)) {
    console.log('[SKIP] no encuentro el respaldo real en ' + RESCATE);
    process.exit(0);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [], avisos = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { avisos.push(d.message()); await d.accept(); });   // confirma y acepta
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Equipo limpio: nada guardado, como cuando uno restaura en un teléfono nuevo.
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  await page.setInputFiles('#import-file', path.resolve(RESCATE));
  await page.waitForTimeout(9000);   // leer 4.6 MB + mover 35 fotos a IndexedDB

  const r = await page.evaluate(async () => {
    const out = {};
    out.ordenes = (DB.ordenes || []).length;
    out.clientes = (DB.clientes || []).length;
    out.garage = (DB.garage || []).length;
    const ro1 = (DB.ordenes || []).find(o => o.id === 'RO-1');
    const ro2 = (DB.ordenes || []).find(o => o.id === 'RO-2');
    out.totalRO1 = ro1 ? ro1.total : null;
    out.totalRO2 = ro2 ? ro2.total : null;
    out.firmaRO2 = !!(ro2 && ro2.sigData && (ro2.sigData.sig1 || ro2.sigData.sig2));
    out.fotosRO2 = ro2 && Array.isArray(ro2.fotos) ? ro2.fotos.length : 0;
    // ¿las fotos quedaron como referencia (id) en vez de base64 pegado?
    out.fotosConId = ro2 && Array.isArray(ro2.fotos) ? ro2.fotos.filter(f => f && f.id).length : 0;
    out.fotosInline = ro2 && Array.isArray(ro2.fotos)
      ? ro2.fotos.filter(f => { const u = (typeof f === 'string') ? f : (f && f.d); return u && !(f && f.id); }).length : 0;
    // normalización de lo que el archivo NO traía
    out.papeleraEsLista = Array.isArray(DB.papelera);
    out.bitacoraEsLista = Array.isArray(DB.bitacora);
    // ¿de verdad quedó en disco, y sin reventar la cuota?
    let crudo = '';
    try { crudo = localStorage.getItem('sf_v1') || ''; } catch (e) { }
    out.enDisco = crudo.length > 0;
    out.kbEnDisco = Math.round(crudo.length / 1024);
    out.ordenesEnDisco = crudo ? (JSON.parse(crudo).ordenes || []).length : 0;
    // y lo más importante: ¿la app puede seguir guardando después de restaurar?
    DB.citas = DB.citas || [];
    DB.citas.push({ id: 'CITA-POST-IMPORT', cliente: 'Prueba', fecha: '2026-08-05', hora: '09:00', estado: 'agendada' });
    out.guardaDespues = saveDB();
    return out;
  });

  console.log('-- llegó todo --');
  is('las 2 órdenes están', r.ordenes, 2);
  is('los 2 clientes están', r.clientes, 2);
  is('el carro del garage está', r.garage, 1);
  is('RO-1 conserva su total', r.totalRO1, 50.18);
  is('RO-2 conserva su total', r.totalRO2, 88.2);
  is('RO-2 conserva la firma del cliente', r.firmaRO2, true);
  is('RO-2 conserva sus 35 fotos', r.fotosRO2, 35);

  console.log('-- el fallo del 24-jul: 4.57 MB de fotos en base64 --');
  is('🔍 las fotos se movieron a IndexedDB (quedan como referencia)', r.fotosConId, 35);
  is('...y no quedó ninguna pegada en base64', r.fotosInline, 0);
  const cupo = r.kbEnDisco < 3000;
  is('lo guardado en localStorage cabe de sobra (< 3 MB)', cupo, true);
  ok('   tamaño real en disco', r.kbEnDisco + ' KB');

  console.log('-- lo que el archivo NO traía --');
  is('papelera se normalizó a lista', r.papeleraEsLista, true);
  is('bitácora se normalizó a lista', r.bitacoraEsLista, true);

  console.log('-- quedó en disco y la app sigue viva --');
  is('el respaldo se escribió en disco', r.enDisco, true);
  is('...con las 2 órdenes', r.ordenesEnDisco, 2);
  is('🔍 después de restaurar todavía se puede GUARDAR', r.guardaDespues, true);

  const seQuejo = avisos.some(m => /LLENO|lleno|no se pudieron mover/i.test(m));
  is('no salió ningún aviso de almacenamiento lleno', seQuejo, false);
  const dijoOk = avisos.some(m => /importado correctamente/i.test(m));
  is('avisó que se importó correctamente', dijoOk, true);
  is('sin errores de JavaScript', errs.length, 0, errs);

  await browser.close();
  console.log('\navisos que dio la app: ' + JSON.stringify(avisos.map(a => a.slice(0, 70))));
  console.log(pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
