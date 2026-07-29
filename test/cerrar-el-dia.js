// CERRAR EL DIA — el chequeo que lo PARA si algo quedo mal.
// ---------------------------------------------------------------------------
// Lo pidio Roberto el 29-jul: "que crees si anadimos un boton para finalizar el dia".
// No es un resumen bonito. Cada cosa que revisa salio de algo que le paso de verdad:
//   · el RESPALDO — el 26-jul estuvo DOS DIAS atendiendo clientes sin que corriera, y la app
//     nunca se lo dijo. Ese dia se quedo sin datos.
//   · la CAJA POR METODO — para contar el efectivo del bolsillo contra lo que dice la app.
//   · ORDENES ABIERTAS — no cuentan en NINGUNA pantalla de finanzas: dinero invisible.
//   · CARROS EN EL GARAGE — se quedaban "en trabajo" para siempre.
//   · SEGUIMIENTOS — su hueco #1 es que tiene 0 resenas.
// Usage:  python -m http.server 8931  (raiz del repo) + node cerrar-el-dia.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  const dialogos = [];
  page.on('dialog', async d => { dialogos.push(d.message()); await d.accept(); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Un día de trabajo de verdad: 2 órdenes cobradas por métodos distintos, una con abono,
  // una abierta, un carro sin entregar, un gasto, y el respaldo SIN correr.
  await ev(page, `
    var hoy=new Date();
    function ro(id,cli,total,estado){
      return {id:id,cliente:cli,tel:'787-555-0000',estado:estado,fecha:hoy.toISOString(),
        vehiculo:{year:'2019',make:'Kia',model:'Rio',tag:id},
        servicios:[{n:'Servicio',ep:total/1.115,qty:1,laborHours:0,parts:[]}],
        denegados:[],insp:{},fotos:[]};
    }
    var a=ro('RO-1','Ana',111.5,'pagado');   recalcROTotal(a);
    var b=ro('RO-2','Luis',223,'pendiente'); recalcROTotal(b);
    var c=ro('RO-3','Jose',150,'abierta');   recalcROTotal(c);
    DB.ordenes=[a,b,c];
    registrarPago(a,a.total,'Cash');
    registrarPago(b,100,'ATH Móvil');
    DB.garage=[{id:'G1',roId:'RO-2',cliente:'Luis',vehiculo:'2019 Kia Rio',estado:'working',log:[]}];
    DB.gastos=[{id:'GA1',desc:'Gasolina',cat:'Gasolina',monto:40,fecha:localDateStr()}];
    DB.settings.backup={token:'x',repo:'y',last:new Date(Date.now()-50*3600000).toISOString()};
    DB.citas=[{id:'CT1',cliente:'Marta',tel:'787-555-1111',estado:'agendada',
               fecha:localDateStr(new Date(Date.now()+86400000)),hora:'09:00'}];
    saveDB({force:true}); return 1;`);

  const r = await ev(page, `return resumenDelDia();`);

  num('⭐ Cobrado hoy: $111.50 en efectivo + $100 de abono = $211.50', r.caja.total, 211.5);
  is('⭐ Y desglosado por método, para contar el bolsillo', r.caja.porMetodo, { 'Cash': 111.5, 'ATH Móvil': 100 });
  num('Vendido hoy (sin contar la abierta): $334.50', r.vendidoHoy, 334.5);
  num('Gastos del día', r.gastosHoy, 40);
  num('Neto del día = cobrado − gastos', r.netoHoy, 171.5);
  num('Lo que le deben', r.porCobrar, 123);

  // ---------- LOS AVISOS QUE LO PARAN ----------
  const criticos = r.avisos.filter(a => a.n === 'critico');
  yes('🛑 ⭐ AVISA que el respaldo no ha corrido hoy', criticos.some(a => /respaldo/i.test(a.t)), criticos);
  yes('Y le dice cuántas horas lleva sin subir nada', criticos.some(a => /\d+ horas/.test(a.t)), criticos.map(a => a.t));
  yes('⚠️ Avisa de la orden que quedó ABIERTA, con su número', r.avisos.some(a => /ABIERTA/.test(a.t) && /RO-3/.test(a.t)), r.avisos.map(a => a.t));
  yes('⚠️ Avisa del carro que sigue en el garage', r.avisos.some(a => /garage/i.test(a.t)), r.avisos.map(a => a.t));
  yes('💵 Avisa de lo que le deben', r.avisos.some(a => /deben \$123/.test(a.t)), r.avisos.map(a => a.t));
  yes('📅 Le dice las citas de mañana', r.avisos.some(a => /Manana|Mañana/.test(a.t)), r.avisos.map(a => a.t));
  is('No dice "todo bien" cuando hay algo crítico', r.todoBien, false);

  // ---------- EL TEXTO QUE VE EN PANTALLA ----------
  await ev(page, `cerrarElDia();return 1;`);
  const txt = dialogos[dialogos.length - 1] || '';
  yes('El cierre en pantalla trae la caja por método', /Cash: \$111\.50/.test(txt) && /ATH/.test(txt), txt.slice(0, 300));
  yes('Y le dice que cuente eso contra lo que tiene encima', /Cuenta esto contra/.test(txt), true);
  yes('Y que hay algo que atender antes de cerrar', /antes de cerrar/i.test(txt), true);
  yes('Sin basura técnica en lo que lee', !/(undefined|NaN|\[object)/.test(txt), txt.slice(0, 200));

  // ---------- UN DIA LIMPIO SI DICE QUE TODO BIEN ----------
  const limpio = await ev(page, `
    DB.ordenes.forEach(function(o){ if(o.estado==='abierta')o.estado='pagado'; });
    DB.garage=[];
    DB.settings.backup.last=new Date().toISOString();
    saveDB({force:true});
    return resumenDelDia();`);
  is('⭐ Con el respaldo al día y nada suelto, dice que todo quedó bien', limpio.todoBien, true);
  is('Y ya no hay ningún aviso crítico', limpio.avisos.filter(a => a.n === 'critico').length, 0);

  // ---------- QUEDA ESCRITO EN LA BITACORA ----------
  const bita = await ev(page, `
    cerrarElDia();
    var b=(DB.bitacora||[]).filter(function(x){return x.tipo==='cierre-dia';});
    return { n:b.length, det:(b[b.length-1]||{}).det||'' };`);
  yes('El cierre queda anotado en la bitácora, con los números', bita.n >= 1 && /cobrado \$/.test(bita.det), bita.det);
  yes('Y anota si el respaldo corrió o no', /respaldo hoy/.test(bita.det), bita.det);

  // ---------- EL BOTON EXISTE Y SE PUEDE TOCAR ----------
  await ev(page, `go('home');renderHome();return 1;`);
  await page.waitForTimeout(400);
  const boton = await page.locator('#home button:has-text("Cerrar el día")').count();
  is('El botón está en el home, donde lo va a ver', boton, 1);

  yes('Sin errores de JavaScript', errs.length === 0, errs);

  console.log('\nCERRAR EL DÍA — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
