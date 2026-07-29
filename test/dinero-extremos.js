// LOS EXTREMOS DEL DINERO — donde la caja se descuadra sin que nadie lo note.
// ---------------------------------------------------------------------------
// Sonda del 28-jul (5ta auditoría). Tres situaciones reales que ninguna prueba había corrido:
//   A. Una orden con muchos renglones de centavos: ¿la suma de las líneas es el subtotal que
//      imprime la factura? (el cliente SÍ suma las líneas)
//   B. Una orden que YA se cobró y después se marca cortesía o garantía: el libro de pagos sigue
//      con el dinero adentro y el total baja a $0 ⇒ "Vendido $0 / Cobrado $223". Descuadre.
//   C. El cliente paga de MÁS (te da $200 sobre un balance de $167.25): ¿qué hace la app con la
//      diferencia? Si la traga callada, su gaveta no va a cuadrar al cierre.
// Usage:  python -m http.server 8931  (raíz del repo) + node dinero-extremos.js
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
  let cola = [];
  page.on('dialog', async d => {
    dialogos.push(d.message());
    if (d.type() === 'prompt') { const r = cola.length ? cola.shift() : null; await d.accept(r === null ? d.defaultValue() : String(r)); }
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ================= A. CENTAVOS: la suma de las líneas vs el subtotal =================
  const cent = await ev(page, `
    DB.settings.laborRate=103;
    var svcs=[];
    // 7 renglones que no dan redondo, con labor en fracciones de hora y una pieza
    [33.33,16.67,49.99,12.34,7.77,101.01,5.05].forEach(function(p,i){
      svcs.push({n:'Servicio '+(i+1),ep:p,qty:(i===2?2:1),laborHours:(i%3===0?0.33:0),
                 parts:(i===5?[{name:'Tornillería',partNum:'',supplier:'NAPA',cost:3.33,sellPrice:6.66,qty:3,receipt:''}]:[])});
    });
    var o={id:'RO-1',cliente:'Prueba Centavos',tel:'787-555-0001',estado:'pendiente',
      fecha:new Date().toISOString(),vehiculo:{year:'2018',make:'Kia',model:'Rio',tag:'CEN-001'},
      servicios:svcs,denegados:[],insp:{},fotos:[]};
    DB.ordenes=[o];recalcROTotal(o);saveDB({force:true});
    // la suma renglón por renglón, como la calcula la app para pintarla
    var rate=DB.settings.laborRate;
    var lineas=svcs.map(function(s){
      return (s.ep||0)*(s.qty||1)+(s.laborHours||0)*rate+(s.parts||[]).reduce(function(a,p){return a+p.sellPrice*p.qty;},0);
    });
    var sumaLineas=lineas.reduce(function(a,b){return a+b;},0);
    return { lineas:lineas.map(function(x){return Math.round(x*100)/100;}),
             sumaLineas:Math.round(sumaLineas*100)/100, total:o.total,
             ivuImplicito:Math.round((o.total-sumaLineas)*100)/100 };`);
  num('La suma de los renglones + IVU 11.5% da el total de la orden',
      Math.round(cent.sumaLineas * 1.115 * 100) / 100, cent.total);
  yes('Ningún renglón queda con más de 2 decimales al pintarse',
      cent.lineas.every(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001), cent.lineas);

  // el mismo número en la página que ve el cliente
  const cliCent = await ev(page, `
    var capt=null,_o=window.open;window.open=function(u){capt=u;return null;};
    try{ shareStatus('RO-1'); }catch(e){}
    window.open=_o;
    var h=String(capt||'').split('%23s%3D')[1]||String(capt||'').split('#s=')[1]||'';
    h=decodeURIComponent(h.split('&')[0]||'');
    var snap=null;try{snap=JSON.parse(_b64d(h));}catch(e){}
    return snap?{sub:snap.sub,ivu:snap.ivu,sv:(snap.sv||[]).length,
                 sumaSv:Math.round((snap.sv||[]).reduce(function(a,s){return a+(s.p||0);},0)*100)/100}:null;`);
  yes('El link del cliente se genera', !!cliCent, cliCent);
  if (cliCent) {
    num('⭐ En la página del cliente, la suma de los renglones ES el subtotal que le enseña',
        cliCent.sumaSv, cliCent.sub);
    num('Y su IVU es el 11.5% de ese subtotal', cliCent.ivu, Math.round(cliCent.sub * 0.115 * 100) / 100);
    num('Y subtotal + IVU es el total de la orden', cliCent.sub + cliCent.ivu, cent.total);
  }

  // ================= B. YA COBRADA Y DESPUÉS SIN CARGO =================
  // Pasa de verdad: cobra, y después se entera de que la pieza estaba en garantía.
  const yaCobrada = await ev(page, `
    var o={id:'RO-2',cliente:'Ana Delgado',tel:'787-555-0002',estado:'pendiente',
      fecha:new Date().toISOString(),vehiculo:{year:'2017',make:'Ford',model:'Focus',tag:'ABC-777'},
      servicios:[{n:'Alternador',ep:200,qty:1,laborHours:0,parts:[]}],denegados:[],insp:{},fotos:[]};
    DB.ordenes.push(o);recalcROTotal(o);
    registrarPago(o,o.total,'ATH Móvil');
    o.estado='pagado';o.abonado=o.total;o.pagadoFecha=new Date().toISOString();
    saveDB({force:true});
    var antes=o.total;
    // ahora se marca garantía sobre esa MISMA orden ya cobrada
    o.garantia=true;o.garantiaMotivo='el alternador estaba en garantía';
    recalcROTotal(o);
    conciliarSinCargo(o);
    saveDB({force:true});
    var h0=new Date();h0.setHours(0,0,0,0);var fin=new Date(h0.getTime()+86400000);
    var cob=cobradoEnRango(h0,fin,[o]).total;
    return { antes:antes, ahora:o.total, cobrado:cob, abonado:o.abonado, balance:balanceRO(o),
             pagos:(o.pagos||[]).length,
             bita:(DB.bitacora||[]).filter(function(b){return b.tipo==='devolucion';}).length };`);
  num('La orden se había cobrado en $223', yaCobrada.antes, 223);
  num('Marcada como garantía el total baja a $0', yaCobrada.ahora, 0);
  console.log('   → vendido $' + yaCobrada.ahora + ' pero cobrado $' + yaCobrada.cobrado +
              ' (abonado $' + yaCobrada.abonado + ')');
  num('⭐ La caja del día vuelve a cuadrar: vendido $0 y cobrado $0 (neto)', yaCobrada.cobrado, 0);
  is('⭐ El cobro NO se borra: queda con su devolución al lado (auditable)', yaCobrada.pagos, 2);
  yes('Y le avisa en pantalla que ese dinero es del cliente y hay que devolverlo',
      dialogos.some(d => /DEV[UÉE]LVESELO|devolución/i.test(d)), dialogos.slice(-2));
  yes('Queda renglón en la bitácora', yaCobrada.bita > 0, yaCobrada.bita);

  // ================= C. LE PAGAN DE MÁS =================
  const demas = await ev(page, `
    var o={id:'RO-3',cliente:'Jose Ruiz',tel:'787-555-0003',estado:'pendiente',
      fecha:new Date().toISOString(),vehiculo:{year:'2014',make:'Mazda',model:'3',tag:'XYZ-909'},
      servicios:[{n:'Frenos',ep:100,qty:1,laborHours:0,parts:[]}],denegados:[],insp:{},fotos:[]};
    DB.ordenes.push(o);recalcROTotal(o);saveDB({force:true});
    return { total:o.total };`);
  num('Orden de $100 + IVU', demas.total, 111.5);

  cola = ['Cash', '150'];       // le da $150 sobre una orden de $111.50
  const trasDeMas = await ev(page, `
    cobrarYCerrar('RO-3');
    var o=DB.ordenes.find(function(x){return x.id==='RO-3';});
    var h0=new Date();h0.setHours(0,0,0,0);
    return { abonado:o.abonado, estado:o.estado, total:o.total,
             pagos:(o.pagos||[]).map(function(p){return p.monto;}),
             cobrado:cobradoEnRango(h0,new Date(h0.getTime()+86400000),[o]).total };`);
  num('Solo se registra lo que la orden vale ($111.50), no los $150', trasDeMas.cobrado, 111.5);
  is('La orden queda pagada', trasDeMas.estado, 'pagado');
  yes('⭐ Y la app le AVISA que le dieron de más y cuánto devolver ($38.50)',
      dialogos.some(d => /DEVU[ÉE]LVELE \$38\.50/.test(d)), dialogos.slice(-3));

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nEXTREMOS DEL DINERO — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
