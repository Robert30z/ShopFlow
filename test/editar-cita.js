// Una cita ya agendada se puede CORREGIR sin rehacerla.
// Pedido de Roberto (2026-07-27): "si ya tengo una cita hecha no me deja editarla, escribí
// algo mal". Antes la única salida era borrar y crear otra — eso perdía el estado
// (completada / no llegó) y la hora original en que se agendó.
// La trampa de este cambio: si iOS mata la app a media edición, los campos se reponen solos
// (restoreFields) pero hay que RECORDAR que era una edición; si no, Guardar crearía una cita
// DUPLICADA en vez de corregir la vieja. Eso se prueba abajo.
// Usage:  python -m http.server 8931   (raíz del repo) + node editar-cita.js
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
  await page.waitForTimeout(1400);

  const sembrar = () => page.evaluate(() => {
    DB.citas = [{ id: 'CITA-X', cliente: 'Migdalya Coto', tel: '787-555-0134', fecha: '2030-02-10',
                  hora: '10:00', vehiculo: '2024 Kia Sol', servicio: 'Diagnostico',
                  direccion: 'Bayamón', estado: 'completada', creado: '2026-01-01T10:00:00.000Z' }];
    _citaEdit = null; try { localStorage.removeItem('sf_cita_edit'); } catch (e) {}
    go('citas');
  });

  // --- 1. Editar carga la cita en el formulario ---
  await sembrar();
  let r = await page.evaluate(() => {
    editCita('CITA-X');
    return { n: document.getElementById('ct-n').value, v: document.getElementById('ct-v').value,
             f: document.getElementById('ct-f').value, titulo: document.querySelector('#citas-body .ch').innerText.trim() };
  });
  r.n === 'Migdalya Coto' && r.v === '2024 Kia Sol' && r.f === '2030-02-10' && /Editando/.test(r.titulo)
    ? ok('Editar carga los datos de la cita en el formulario', r)
    : no('Editar carga los datos de la cita en el formulario', r);

  // --- 2. Guardar CORRIGE la cita: no crea otra, y conserva estado e historial ---
  r = await page.evaluate(() => {
    document.getElementById('ct-n').value = 'Migdalia Cotto';
    document.getElementById('ct-v').value = '2024 Kia Soul';
    saveCita();
    const c = DB.citas.find(x => x.id === 'CITA-X');
    return { cuantas: DB.citas.length, n: c.cliente, v: c.vehiculo, estado: c.estado, creado: c.creado, editado: !!c.editado };
  });
  r.cuantas === 1 && r.n === 'Migdalia Cotto' && r.estado === 'completada' && r.creado === '2026-01-01T10:00:00.000Z' && r.editado
    ? ok('Guardar corrige la cita sin duplicarla y conserva estado + fecha de creación', r)
    : no('Guardar corrige la cita sin duplicarla y conserva estado + fecha de creación', r);

  // --- 3. Tras guardar, el formulario vuelve a modo "Nueva cita" ---
  r = await page.evaluate(() => ({ titulo: document.querySelector('#citas-body .ch').innerText.trim(),
                                   n: document.getElementById('ct-n').value }));
  /Nueva cita/.test(r.titulo) && !r.n
    ? ok('Tras guardar vuelve a modo Nueva cita, con el formulario limpio', r)
    : no('Tras guardar vuelve a modo Nueva cita, con el formulario limpio', r);

  // --- 4. Cancelar no toca la cita ---
  await sembrar();
  r = await page.evaluate(() => {
    editCita('CITA-X');
    document.getElementById('ct-n').value = 'NO GUARDAR ESTO';
    cancelEditCita();
    const c = DB.citas.find(x => x.id === 'CITA-X');
    return { n: c.cliente, cuantas: DB.citas.length, campo: document.getElementById('ct-n').value };
  });
  r.n === 'Migdalya Coto' && r.cuantas === 1 && !r.campo
    ? ok('Cancelar deja la cita intacta y limpia el formulario', r)
    : no('Cancelar deja la cita intacta y limpia el formulario', r);

  // --- 5. LA TRAMPA: iOS mata la app a media edición. Al volver NO puede duplicar ---
  await sembrar();
  await page.evaluate(() => { editCita('CITA-X'); document.getElementById('ct-n').value = 'Migdalia Cotto'; saveFields(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1700);
  r = await page.evaluate(() => {
    DB.citas = [{ id: 'CITA-X', cliente: 'Migdalya Coto', tel: '787-555-0134', fecha: '2030-02-10',
                  hora: '10:00', vehiculo: '2024 Kia Sol', servicio: 'Diagnostico',
                  direccion: 'Bayamón', estado: 'completada', creado: '2026-01-01T10:00:00.000Z' }];
    go('citas');
    saveCita();
    return { cuantas: DB.citas.length, n: DB.citas[0].cliente, recordo: DB.citas[0].id === 'CITA-X' };
  });
  r.cuantas === 1 && r.recordo
    ? ok('Recargar a media edición NO duplica la cita: recuerda que era una corrección', r)
    : no('Recargar a media edición NO duplica la cita: recuerda que era una corrección', r);

  errs.length === 0 ? ok('Sin errores de JavaScript') : no('Sin errores de JavaScript', errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
