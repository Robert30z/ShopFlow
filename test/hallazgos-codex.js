// LO QUE ENCONTRO CODEX Y A MI SE ME FUE — auditoria independiente del 29-jul.
// ---------------------------------------------------------------------------
// Roberto instalo el plugin de Codex (OpenAI) y se le puso a auditar la logica de dinero que yo
// mismo acababa de escribir. Encontro 5 defectos; 4 resultaron reales despues de verificarlos
// contra el codigo. Esta prueba los reproduce para que no puedan volver.
//
// La leccion: yo audite mi propio trabajo toda la noche y no vi ninguno de estos. Mis pruebas
// tenian un punto ciego heredado de como yo pensaba el problema — por ejemplo, `precio-final.js`
// probaba `exportPDF()` directo y nunca `reExportPDF()`, que es el boton que el toca de verdad.
// Usage:  python -m http.server 8931  (raiz del repo) + node hallazgos-codex.js
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
  let respuestas = [];          // respuestas a los confirm(), en orden
  page.on('dialog', async d => {
    dialogos.push(d.message());
    const r = respuestas.length ? respuestas.shift() : true;
    if (d.type() === 'prompt') await d.accept(r === true ? d.defaultValue() : String(r));
    else if (r === false) await d.dismiss();
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ================= #2 — VOLVER A GENERAR EL PDF LE CAMBIABA EL DINERO AL CLIENTE =================
  // `reExportPDF` copiaba los campos a mano y se le olvidaban garantia, cortesia, descTipo y
  // totalManual. Una orden por GARANTIA se reimprimia cobrando $111.50 en vez de $0.00.
  const pdf = await ev(page, `
    function base(extra){
      var o={id:'RO-1',cliente:'Ana Ruiz',tel:'787-555-0001',estado:'pendiente',
        fecha:new Date().toISOString(),vehiculo:{year:'2018',make:'Kia',model:'Rio',tag:'AAA-111'},
        servicios:[{n:'Servicio',ep:100,qty:1,laborHours:0,parts:[]}],denegados:[],insp:{},fotos:[]};
      Object.keys(extra||{}).forEach(function(k){o[k]=extra[k];});
      recalcROTotal(o); return o;
    }
    function totalDelPDF(o){
      DB.ordenes=[o];
      var visto=null, _s=RO;
      var _exp=window.exportPDF;
      window.exportPDF=function(){ visto=dineroRO(RO); };   // se mira el RO que reExportPDF prepara
      reExportPDF(o.id);
      window.exportPDF=_exp; RO=_s;
      return visto;
    }
    return {
      garantia: totalDelPDF(base({garantia:true,garantiaMotivo:'pieza cubierta'})),
      manual:   totalDelPDF(base({totalManual:'140'})),
      descDolar:totalDelPDF(base({descuento:10,descTipo:'$'})),
      cortesia: totalDelPDF(base({cortesia:true,cortesiaMotivo:'disculpa'}))
    };`);
  num('⭐ #2 Una orden por GARANTÍA se reimprime en $0.00, no cobrando', pdf.garantia.total, 0);
  num('⭐ #2 El "precio final acordado" sobrevive al re-generar el PDF', pdf.manual.total, 140);
  num('⭐ #2 Un descuento de $10 sigue siendo $10, no 10%', pdf.descDolar.total, (100 - 10) * 1.115);
  num('#2 La cortesía también se respeta', pdf.cortesia.total, 0);

  // ================= #5 — DESCUENTO PORCENTUAL SIN TOPE =================
  const desc = await ev(page, `
    function t(d,tipo){ var o={servicios:[{n:'X',ep:100,qty:1,laborHours:0,parts:[]}],descuento:d,descTipo:tipo};
      return dineroRO(o); }
    return { normal:t(20,'%').total, exagerado:t(200,'%').total, dolarExagerado:t(500,'$').total,
             descAmt200:t(200,'%').descAmt };`);
  num('Un 20% normal sigue funcionando', desc.normal, 89.2);
  num('⭐ #5 Un 200% (typo de 20) NO da un total negativo', desc.exagerado, 0);
  num('⭐ #5 Y el descuento se topa en el subtotal', desc.descAmt200, 100);
  num('#5 El descuento en $ también topa', desc.dolarExagerado, 0);

  // ================= #3 — EL MERGE ROMPÍA "abonado = suma de pagos" =================
  // iPad marca la orden por garantía (pago +111.50 y devolución −111.50 ⇒ $0).
  // iPhone todavía tiene la copia vieja con abonado 111.50. Al unir, el libro manda.
  const merge = await ev(page, `
    var ipad={id:'RO-2',cliente:'Ana Ruiz',total:0,garantia:true,estado:'pagado',abonado:0,
      fecha:new Date().toISOString(),servicios:[],_editedAt:'2026-07-29T05:00:00.000Z',
      pagos:[{id:'PG-1',ts:'2026-07-28T14:00:00.000Z',monto:111.5,metodo:'Cash'},
             {id:'DV-1',ts:'2026-07-29T05:00:00.000Z',monto:-111.5,metodo:'Cash',devolucion:true}]};
    var iphone={id:'RO-2',cliente:'Ana Ruiz',total:111.5,estado:'pagado',abonado:111.5,
      fecha:new Date().toISOString(),servicios:[],_editedAt:'2026-07-28T14:00:00.000Z',
      pagos:[{id:'PG-1',ts:'2026-07-28T14:00:00.000Z',monto:111.5,metodo:'Cash'}]};
    var u=mergeDB({ordenes:[ipad]},{ordenes:[iphone]});
    var o=u.ordenes[0];
    return { abonado:o.abonado, suma:Math.round(sumaPagos(o)*100)/100, pagos:(o.pagos||[]).length, total:o.total };`);
  is('#3 Los dos renglones del libro se conservan (auditable)', merge.pagos, 2);
  num('⭐ #3 Tras sincronizar, "abonado" es la suma REAL del libro ($0), no el máximo', merge.abonado, 0);
  num('#3 Y coincide con la suma de pagos', merge.abonado, merge.suma);

  // ================= #1 — REABRIR UNA ORDEN PAGADA Y SUBIRLE EL PRECIO =================
  // Antes apuntaba la diferencia como cobrada sin que el cliente diera un peso.
  const subir = await ev(page, `
    var o={id:'RO-3',cliente:'Ana Ruiz',tel:'787-555-0001',estado:'pagado',
      fecha:new Date().toISOString(),vehiculo:{make:'Kia'},
      servicios:[{n:'Servicio',ep:100,qty:1,laborHours:0,parts:[]}],denegados:[],insp:{},fotos:[]};
    recalcROTotal(o); DB.ordenes=[o];
    registrarPago(o,o.total,'Cash'); o.abonado=sumaPagos(o); sellarFactura(o);
    saveDB({force:true});
    return { total:o.total, cobrado:sumaPagos(o) };`);
  num('Arranca cobrada en $111.50', subir.cobrado, 111.5);

  respuestas = [false];   // NO, no recibí la diferencia (reabrirOrden va callado, no pregunta)
  const trasSubir = await ev(page, `
    // El orden importa y es el de la app: PRIMERO se reabre la factura sellada, y DESPUES se
    // carga en el asistente (continueRO). Al reves, el RO en memoria lleva el sello viejo y el
    // guard revierte el guardado — que fue lo que le paso a esta misma prueba.
    reabrirOrden('RO-3',{motivo:'el cliente aprobó más trabajo',callado:true});
    RO=JSON.parse(JSON.stringify(DB.ordenes[0]));
    RO.totalManual='223';
    calcEst(); saveRO();
    var o=DB.ordenes.find(function(x){return x.id==='RO-3';});
    return { total:o.total, cobrado:Math.round(sumaPagos(o)*100)/100, estado:o.estado, balance:balanceRO(o) };`);
  num('El total sube a $223', trasSubir.total, 223);
  num('⭐ #1 Si él dice que NO recibió la diferencia, NO se apunta como cobrada', trasSubir.cobrado, 111.5);
  is('⭐ #1 Y la orden queda PENDIENTE por lo que falta', trasSubir.estado, 'pendiente');
  num('#1 Debiendo exactamente la diferencia', trasSubir.balance, 111.5);
  yes('#1 Se lo preguntó con los números en pantalla',
      dialogos.some(d => /ya recibiste/i.test(d) && /111\.50/.test(d)), dialogos.filter(d => /recibiste/i.test(d)));

  // ================= #4 — BORRAR UNA ORDEN COBRADA =================
  const borrar = await ev(page, `
    var o={id:'RO-4',cliente:'Luis Paz',tel:'787-555-0002',estado:'pagado',
      fecha:new Date().toISOString(),vehiculo:{make:'Honda'},
      servicios:[{n:'Servicio',ep:100,qty:1,laborHours:0,parts:[]}],denegados:[],insp:{},fotos:[]};
    recalcROTotal(o); DB.ordenes=[o];
    registrarPago(o,o.total,'Cash'); o.abonado=sumaPagos(o);
    saveDB({force:true}); return 1;`);
  respuestas = [false];         // él dice que NO al aviso
  const noBorro = await ev(page, `deleteRO('RO-4','prueba'); return DB.ordenes.length;`);
  is('⭐ #4 Le avisa antes de borrar una orden con dinero cobrado, y puede cancelar', noBorro, 1);
  yes('#4 El aviso le dice CUÁNTO dinero sale de la caja',
      dialogos.some(d => /111\.50/.test(d) && /caja del dia|caja del día/i.test(d)), dialogos.slice(-1));


  // ================= #6 (2da ronda) — DISCO CORRUPTO: LA APP ARRANCABA VACIA =================
  // Es la forma exacta del desastre del 26-jul. Si `sf_v1` se lee danado, antes la app seguia como
  // taller nuevo y el primer guardado escribia ese vacio encima.
  await ev(page, `
    var o={id:'RO-77',cliente:'Cliente Real',tel:'787-555-7777',estado:'pagado',total:200,
      fecha:new Date().toISOString(),vehiculo:{make:'Honda'},servicios:[{n:'X',ep:100,qty:1,parts:[]}],
      denegados:[],insp:{},fotos:[]};
    DB.ordenes=[o]; saveDB({force:true});
    // se corrompe el disco como lo haria Safari al cortar el archivo
    var bueno=localStorage.getItem('sf_v1');
    localStorage.setItem('sf_v1', bueno.slice(0, Math.floor(bueno.length/2)));
    return 1;`);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const corrupto = await ev(page, `
    var claves=Object.keys(localStorage).filter(function(k){return k.indexOf('sf_v1_corrupto_')===0;});
    return { ordenes:(DB.ordenes||[]).length, marcado:!!_discoCorrupto,
             guardadoCopia:claves.length, guardaAhora:saveDB() };`);
  yes('⭐ La app AVISA que el disco se leyo danado, no arranca callada', corrupto.marcado, corrupto);
  is('⭐ Guarda el texto danado aparte (no se pierde nada)', corrupto.guardadoCopia, 1);
  is('⭐⭐ Y BLOQUEA los guardados para no escribir el vacio encima', corrupto.guardaAhora, false);
  yes('El aviso le dice que restaure', dialogos.some(d => /DA[ÑN]ADOS|danados/i.test(d) && /Restaurar/i.test(d)),
      dialogos.filter(d => /danad|dañad/i.test(d)).slice(0, 1));

  yes('Sin errores de JavaScript', errs.length === 0, errs);

  console.log('\nHALLAZGOS DE CODEX — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
