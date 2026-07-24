// ShopFlow — prueba del ROUND-TRIP de fotos en la nube (Supabase Storage).
// Crea un usuario temporal, captura una foto (se sube a la nube), borra la copia
// local y verifica que se puede BAJAR de la nube (simula un 2do equipo).
// Imprime TEST_UID= al final para limpiar el usuario temporal por el Management API.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8931/index.html';
let fail = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message.slice(0,200)));
  page.on('console', m => { if(m.type()==='error' && !/cdn|favicon|Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0,160)); });
  page.on('dialog', async d => { await d.accept().catch(()=>{}); });

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(1400);

  const email='sftest_'+Date.now()+'@example.com', pass='Test123456!';

  // 1) crear usuario temporal + sesión
  const up = await page.evaluate(async ([email,pass]) => {
    const c=sbReady(); if(!c) return {err:'no client'};
    const r=await c.auth.signUp({email,password:pass});
    if(r.error) return {err:r.error.message};
    _syncOn=true;
    const s=(await c.auth.getSession()).data.session;
    return { uid:s&&s.user.id };
  }, [email,pass]);
  ok(!up.err && !!up.uid, 'Usuario temporal + sesión en la nube', up.err||up.uid);
  if(up.err || !up.uid){ console.log('TEST_UID='); await browser.close(); process.exit(1); }

  // 2) capturar una foto → debe subir a Storage y el ref recibe sp
  const cap = await page.evaluate(async () => {
    RO = { fotos:[] };
    const cvs=document.createElement('canvas'); cvs.width=800; cvs.height=800; const x=cvs.getContext('2d');
    x.fillStyle='#c1121f'; x.fillRect(0,0,800,800); x.fillStyle='#fff'; x.fillRect(120,120,240,240);
    const url=cvs.toDataURL('image/jpeg',0.6);
    const ref=storePhoto(url); RO.fotos.push(ref);
    await new Promise(r=>setTimeout(r,5000)); // deja subir (schedulePhotoUpload debounce 2s + upload)
    return { id:ref.id, sp:ref.sp||'' };
  });
  ok(!!cap.sp && cap.sp.indexOf('/')>-1, 'Foto subió a Supabase Storage (ref tiene sp)', JSON.stringify(cap));

  // 3) confirmar que el archivo existe en Storage (list de la carpeta del usuario)
  const inStorage = await page.evaluate(async (uid) => {
    const c=sbReady();
    const r=await c.storage.from('fotos').list(uid);
    if(r.error) return {err:r.error.message};
    return { n:(r.data||[]).length, names:(r.data||[]).map(o=>o.name) };
  }, up.uid);
  ok(!inStorage.err && inStorage.n>=1, 'El archivo existe en el bucket de la nube', JSON.stringify(inStorage));

  // 4) SIMULAR 2do EQUIPO: borrar la copia local (cache + IndexedDB) y bajar de la nube
  const dl = await page.evaluate(async ([id,sp]) => {
    delete _photoCache[id];
    await photoDel(id); // borra de IDB local — este "equipo" ya no tiene la foto localmente
    const u = await photoResolve({ id:id, sp:sp }); // debe bajarla de Storage
    return { got: !!(u && u.indexOf('data:image')===0), cachedBack: !!_photoCache[id] };
  }, [cap.id, cap.sp]);
  ok(dl.got, 'Otro equipo BAJA la foto desde la nube (photoResolve por sp)', JSON.stringify(dl));
  ok(dl.cachedBack, 'La foto bajada se re-cachea local para la próxima', JSON.stringify(dl));

  ok(errors.length===0, 'Sin errores de página', errors.join(' | '));
  console.log('TEST_UID='+up.uid);
  await browser.close();
  console.log(fail? `\n=== ${fail} FALLO(S) ===` : '\n=== FOTOS NUBE: TODO VERDE ===');
  process.exit(fail?1:0);
})();
