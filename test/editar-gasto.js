// Un gasto se puede CORREGIR y ELIMINAR.
// Hallazgo de auditoría (2026-07-27): los gastos solo se podían CREAR — no existía ninguna
// función para editarlos ni borrarlos. Un cero de más ($5,000 en vez de $500) quedaba clavado
// para siempre en la ganancia del mes y en el CSV que va al contable, sin arreglo posible.
// Era el peor hueco de esta clase: el error entra directo en una cifra que se reporta.
// Usage:  python -m http.server 8931   (raíz del repo) + node editar-gasto.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: 'America/Puerto_Rico' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const sembrar = () => page.evaluate(() => {
    DB.gastos = [{ id: 'G-X', desc: 'Aceite a granel', cat: 'Consumibles', monto: 5000, fecha: localDateStr() }];
    _gastoEdit = null; try { localStorage.removeItem('sf_gasto_edit'); } catch (e) {}
    go('finanzas'); renderGas();
  });

  // --- 1. El cero de más se puede corregir ---
  await sembrar();
  let r = await page.evaluate(() => {
    editG('G-X');
    const cargado = { d: document.getElementById('gd').value, m: document.getElementById('gm').value };
    document.getElementById('gm').value = '500';
    saveG();
    const g = DB.gastos.find(x => x.id === 'G-X');
    return { cargado, cuantos: DB.gastos.length, monto: g.monto, editado: !!g.editado };
  });
  r.cargado.d === 'Aceite a granel' && r.cuantos === 1 && r.monto === 500 && r.editado
    ? ok('Un gasto mal tecleado se corrige sin duplicarlo', r)
    : no('Un gasto mal tecleado se corrige sin duplicarlo', r);

  // --- 2. Queda rastro en la bitácora (es dinero que se reporta) ---
  r = await page.evaluate(() => {
    const b = (DB.bitacora || []).filter(x => x.tipo === 'gasto-editado');
    return { n: b.length, det: b.length ? b[b.length - 1].det : null };
  });
  r.n >= 1 && /5000\.00 -> \$500\.00/.test(r.det || '')
    ? ok('La corrección queda anotada en la bitácora con el antes y el después', r)
    : no('La corrección queda anotada en la bitácora con el antes y el después', r);

  // --- 3. El P&L del mes refleja la corrección ---
  r = await page.evaluate(() => {
    const hoy = new Date(), y = hoy.getFullYear(), m = hoy.getMonth();
    return DB.gastos.filter(g => { const d = dDia(g.fecha); return d.getMonth() === m && d.getFullYear() === y; })
      .reduce((s, g) => s + g.monto, 0);
  });
  r === 500 ? ok('La ganancia del mes usa el monto corregido', { total: r })
            : no('La ganancia del mes usa el monto corregido', { total: r });

  // --- 4. Eliminar un gasto ---
  await sembrar();
  r = await page.evaluate(() => { delG('G-X'); return { cuantos: DB.gastos.length, bita: (DB.bitacora || []).some(x => x.tipo === 'gasto-borrado') }; });
  r.cuantos === 0 && r.bita
    ? ok('Un gasto se puede eliminar y queda anotado', r)
    : no('Un gasto se puede eliminar y queda anotado', r);

  // --- 5. Recargar a media edición no duplica el gasto ---
  await sembrar();
  await page.evaluate(() => { editG('G-X'); document.getElementById('gm').value = '500'; saveFields(); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1700);
  r = await page.evaluate(() => {
    DB.gastos = [{ id: 'G-X', desc: 'Aceite a granel', cat: 'Consumibles', monto: 5000, fecha: localDateStr() }];
    go('finanzas'); renderGas(); saveG();
    return { cuantos: DB.gastos.length, monto: DB.gastos[0].monto };
  });
  r.cuantos === 1 ? ok('Recargar a media edición NO duplica el gasto', r)
                  : no('Recargar a media edición NO duplica el gasto', r);

  errs.length === 0 ? ok('Sin errores de JavaScript') : no('Sin errores de JavaScript', errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
