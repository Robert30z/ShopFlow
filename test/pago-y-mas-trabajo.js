// YA PAGÓ Y DESPUÉS APROBÓ MÁS TRABAJO — el caso que ningún test había corrido.
// ---------------------------------------------------------------------------
// Sonda del 28-jul (4ta auditoría). Pasa de verdad en el taller: el cliente paga los $200,
// el técnico encuentra algo más, el cliente lo aprueba, y el trabajo crece DESPUÉS del cobro.
// Ahí chocan tres cosas que se construyeron por separado: el candado de la factura sellada
// (batch 12), el libro de pagos (batch 15) y `recalcROTotal`.
// Se le pregunta lo mismo a varias pantallas: ¿cuánto entró hoy? ¿cuánto debe? ¿cuánto vendí?
// Usage:  python -m http.server 8931  (raíz del repo) + node pago-y-mas-trabajo.js
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
  let cola = [];   // respuestas a los prompts, en orden; null = dejar el valor por defecto
  page.on('dialog', async d => {
    dialogos.push(d.message());
    if (d.type() === 'prompt') {
      const r = cola.length ? cola.shift() : null;
      await d.accept(r === null ? d.defaultValue() : String(r));
    } else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const hoy = () => ev(page, `
    var h0=new Date();h0.setHours(0,0,0,0);
    var c=cobradoEnRango(h0,new Date(h0.getTime()+86400000));
    return { cobrado:c.total, porMetodo:c.porMetodo, porCobrar:porCobrarTotal(DB.ordenes) };`);

  // Orden de $200 + IVU, cobrada completa y sellada.
  const inicio = await ev(page, `
    var o={id:'RO-1',cliente:'Marta Colón',tel:'787-555-2020',estado:'pendiente',
      fecha:new Date().toISOString(),vehiculo:{year:'2019',make:'Nissan',model:'Sentra',tag:'JKL-505'},
      servicios:[{n:'Frenos delanteros',ep:200,qty:1,laborHours:0,parts:[]}],
      denegados:[{nombre:'Gomas delanteras (par)',precio:150}],insp:{},fotos:[],pago:'ATH Móvil'};
    DB.ordenes=[o];recalcROTotal(o);
    cobrarYCerrar? null : null;
    registrarPago(o,o.total,'ATH Móvil');
    o.estado='pagado';o.pagadoFecha=new Date().toISOString();o.abonado=o.total;
    sellarFactura(o);
    saveDB({force:true});
    return { total:o.total, sellada:facturaSellada(o), intacta:facturaIntacta(o) };`);
  num('La orden se cobra completa ($200 + IVU)', inicio.total, 223);
  yes('Y la factura queda SELLADA e intacta', inicio.sellada && inicio.intacta, inicio);

  const c1 = await hoy();
  num('Entró el pago completo a la caja del día', c1.cobrado, 223);
  num('Y no queda nada por cobrar', c1.porCobrar, 0);

  // ---------- CAMINO A: EL CLIENTE APRUEBA UN RECOMENDADO QUE HABIA DENEGADO ----------
  // Este es el camino que la app ofrece de verdad (`apruebaDen`), y el que mas usa el.
  const den = await ev(page, `
    apruebaDen('RO-1',0);
    var o;
    o=DB.ordenes[0];
    return { total:o.total, estado:o.estado, abonado:o.abonado, balance:balanceRO(o),
             pagos:(o.pagos||[]).length, sumaPagos:(o.pagos||[]).reduce(function(s,p){return s+(p.monto||0);},0),
             servicios:(o.servicios||[]).length, denegados:(o.denegados||[]).length };`);
  num('El total sube a $350 + IVU', den.total, 390.25);
  is('El recomendado pasa a servicios', { s: den.servicios, d: den.denegados }, { s: 2, d: 0 });
  is('⭐ La orden vuelve a PENDIENTE (ya no está saldada)', den.estado, 'pendiente');
  num('⭐ Lo que ya pagó queda acreditado como abono', den.abonado, 223);
  num('⭐ Y debe exactamente la diferencia ($390.25 − $223)', den.balance, 167.25);
  is('El libro de pagos sigue con UN solo cobro (no se inventó otro)', den.pagos, 1);
  num('Y ese cobro sigue siendo de $223', den.sumaPagos, 223);

  const c2 = await hoy();
  num('⭐ El dinero que YA entró hoy no cambia (nadie pagó de más)', c2.cobrado, 223);
  num('⭐ Y el "por cobrar" es la diferencia, no el total nuevo', c2.porCobrar, 167.25);

  // ---------- SE COBRA LA DIFERENCIA (camino real: cobrarYCerrar) ----------
  cola = ['Cash', null];   // método, y el monto por defecto (que DEBE ser el balance, no el total)
  const saldo = await ev(page, `
    var o=DB.ordenes[0];
    cobrarYCerrar('RO-1');
    o=DB.ordenes[0];
    var h0=new Date();h0.setHours(0,0,0,0);
    var c=cobradoEnRango(h0,new Date(h0.getTime()+86400000));
    return { cobrado:c.total, metodos:c.porMetodo, porCobrar:porCobrarTotal(DB.ordenes),
             pagos:(o.pagos||[]).length, estado:o.estado, sellada:facturaSellada(o), intacta:facturaIntacta(o) };`);
  num('Cobrada la diferencia, la caja del día es el total de la orden', saldo.cobrado, 390.25);
  is('⭐ Y el desglose separa los dos métodos de verdad', saldo.metodos, { 'ATH Móvil': 223, 'Cash': 167.25 });
  num('No queda nada por cobrar', saldo.porCobrar, 0);
  is('Quedan los DOS cobros en el libro (auditable)', saldo.pagos, 2);
  is('La orden queda pagada', saldo.estado, 'pagado');
  yes('Y la factura se vuelve a sellar, intacta', saldo.sellada && saldo.intacta, saldo);

  // ---------- QUE LAS PANTALLAS DIGAN LO MISMO ----------
  const pantallas = await ev(page, `
    var o=DB.ordenes[0];
    var h0=new Date();h0.setHours(0,0,0,0);
    var fin=new Date(h0.getTime()+86400000);
    // 1) Historial → Resumen del día   2) Finanzas → Cierre de hoy   3) el detalle de la orden
    var resumen=(typeof resumenDia==='function')?resumenDia(h0,fin):null;
    var cierre=cobradoEnRango(h0,fin).total;
    var ym=new Date().getFullYear()+'-'+('0'+(new Date().getMonth()+1)).slice(-2);
    var csv=buildContableCSV(ym);
    var fila=csv.split('\\n').filter(function(l){return l.indexOf('RO-1')>=0;})[0]||'';
    return { cierre:cierre, resumen:resumen, total:o.total, fila:fila };`);
  num('El total del CSV del contable es el total final de la orden',
      Number((pantallas.fila.split(',')[9] || '0')), 390.25);
  yes('La fila del contable dice PAGADO', /pagado/i.test(pantallas.fila), pantallas.fila);

  // ---------- Y LA PÁGINA QUE VE EL CLIENTE ----------
  const cli = await ev(page, `
    var o=DB.ordenes[0];
    var capt=null;
    var _o=window.open, _s=navigator.share;
    window.open=function(u){capt=u;return null;};
    try{ shareStatus('RO-1'); }catch(e){ capt='ERR '+e.message; }
    window.open=_o;
    var h=String(capt||'').split('%23s%3D')[1]||String(capt||'').split('#s=')[1]||'';
    h=decodeURIComponent(h.split('&')[0]||'');
    var snap=null; try{ snap=JSON.parse(_b64d(h)); }catch(e){}
    return snap?{ sub:snap.sub, ivu:snap.ivu, sv:(snap.sv||[]).length }:{err:String(capt||'').slice(0,120)};`);
  if (cli && cli.sub !== undefined) {
    num('La página del cliente suma los DOS servicios ($350)', cli.sub, 350);
    is('Y le enseña los dos renglones', cli.sv, 2);
    num('Con su IVU correcto', cli.ivu, 40.25);
  } else no('No pude leer el link del cliente', cli);

  // ⭐ EL DIÁLOGO DE COBRO NO PUEDE PEDIRLE EL TOTAL CUANDO YA HAY UN ABONO
  const prompts = dialogos.join(' | ');
  yes('⭐ El diálogo de cobro le dice lo que DEBE ($167.25), no el total ($390.25)',
      /167\.25/.test(prompts), dialogos.filter(d => /Cuánto recibiste/i.test(d)));
  yes('⭐ Y le avisa que ya tenía un abono, para que no le cobre de más al cliente',
      /ya te abonó|Ya abonó/i.test(prompts), dialogos.filter(d => /abon/i.test(d)));
  yes('El aviso final dice lo que entró AHORA, no el total de la orden',
      dialogos.some(d => /Recibido ahora: \$167\.25/.test(d)), dialogos.filter(d => /Recibido/.test(d)));

  yes('Ningún aviso de "pérdida de datos" salió en todo el camino',
      !dialogos.some(d => /GUARDADO BLOQUEADO|pérdida de datos/i.test(d)), dialogos);
  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nPAGÓ Y CRECIÓ EL TRABAJO — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
