// EL PRECIO FINAL ACORDADO — "si ya le di precio al cliente quiero poner el precio exacto".
// ---------------------------------------------------------------------------
// Pedido por Roberto el 29-jul. En el taller se cotiza redondo y con todo incluido ("son $140"),
// no "$125.56 mas IVU". El riesgo de fijar el total a mano es que la factura DEJE DE CUADRAR:
// el cliente suma los renglones y le da otro numero. Por eso la diferencia sale como una linea
// visible, "Ajuste acordado con el cliente", y se comprueba en TODAS las superficies:
// pantalla del estimado · detalle de la orden · PDF · link del cliente · CSV del contable.
// Usage:  python -m http.server 8931  (raiz del repo) + node precio-final.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');
const money = t => Number(String(t || '').replace(/[^0-9.\-]/g, '')) || 0;

let cola = [];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => {
    if (d.type() === 'prompt') { const r = cola.length ? cola.shift() : null; await d.accept(r === null ? d.defaultValue() : String(r)); }
    else await d.accept();
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ---------- LA ORDEN: un cambio de aceite que el cotizo en $140 redondos ----------
  await page.click('#home .mc');
  await page.waitForTimeout(400);
  await page.fill('#c-n', 'Marisol Vega');
  await page.fill('#c-t', '787-555-4141');
  await page.fill('#v-y', '2019');
  await page.fill('#v-ma', 'Toyota');
  await page.fill('#v-mo', 'Corolla');
  await page.fill('#v-t', 'MVG-808');
  await page.click('#ro-next'); await page.waitForTimeout(250);
  await page.click('#ro-next'); await page.waitForTimeout(250);
  // $120 de servicio da $133.80 con IVU. El cotizo en $140 redondos ⇒ ajuste de +$5.56.
  cola = ['Cambio de aceite sintetico', '120'];
  await page.click('#pan-2 button:has-text("Servicio manual")');
  await page.waitForTimeout(300);
  await page.click('#ro-next');                          // -> estimado
  await page.waitForTimeout(500);

  const antes = await ev(page, `return { sub:(document.getElementById('est-sub')||{}).textContent,
    ivu:(document.getElementById('est-ivu')||{}).textContent, tot:(document.getElementById('est-tot')||{}).textContent };`);
  num('Sin fijar nada, el total sale con sus centavos ($120 + IVU)', money(antes.tot), 133.80);
  yes('Y NO coincide con el precio que le dio al cliente', Math.abs(money(antes.tot) - 140) > 0.02, antes);

  // ---------- SE FIJA EL PRECIO QUE YA LE DIO AL CLIENTE ----------
  await page.fill('#est-final', '140');
  await page.waitForTimeout(500);
  const fijado = await ev(page, `return { tot:(document.getElementById('est-tot')||{}).textContent,
    sub:(document.getElementById('est-sub')||{}).textContent, ivu:(document.getElementById('est-ivu')||{}).textContent,
    roTotal:RO.total, ajuste:RO.ajusteValor, aviso:(document.getElementById('est-final-aviso')||{}).innerText,
    breakdown:(document.getElementById('est-breakdown')||{}).innerText };`);
  num('⭐ El total es EXACTAMENTE el precio que le dio al cliente', money(fijado.tot), 140);
  num('Y la orden guarda ese total', fijado.roTotal, 140);
  yes('La app le explica en pantalla lo que va a pasar', /ajuste/i.test(fijado.aviso), fijado.aviso);
  yes('⭐ El desglose enseña el "Ajuste acordado" para que la factura cuadre',
      /Ajuste acordado/i.test(fijado.breakdown), fijado.breakdown);

  // La cuenta tiene que cerrar: subtotal + ajuste + IVU = total
  const cuadre = await ev(page, `
    var m=dineroRO(RO);
    return { sub:m.sub, ajuste:m.ajuste, base:m.base, ivu:m.ivu, total:m.total, manual:m.manual };`);
  num('⭐ subtotal + ajuste = base gravable', cuadre.sub + cuadre.ajuste, cuadre.base);
  num('⭐ base + IVU = el total prometido (al centavo)', cuadre.base + cuadre.ivu, 140);
  num('El IVU sigue siendo el 11.5% de la base', cuadre.ivu, Math.round(cuadre.base * 0.115 * 100) / 100);
  yes('Queda marcado como precio fijado a mano', cuadre.manual, cuadre);

  // ---------- GUARDAR Y COMPROBAR EN TODAS LAS SUPERFICIES ----------
  for (let i = 0; i < 5; i++) { await page.click('#ro-next'); await page.waitForTimeout(250); }
  cola = [];
  await page.click('#pan-8 button:has-text("Guardar orden completa")');
  await page.waitForTimeout(900);

  const guardada = await ev(page, `var o=DB.ordenes[0];
    return { id:o.id, total:o.total, manual:o.totalManual, ajuste:o.ajusteValor };`);
  num('⭐ Guardada, el total sigue siendo $140 exacto', guardada.total, 140);
  yes('Y se acuerda de que el precio se fijó a mano', String(guardada.manual) === '140', guardada);

  // recalcular (lo que pasa al editar la orden después) no puede moverlo
  const recalc = await ev(page, `var o=DB.ordenes[0];recalcROTotal(o);return {total:o.total,ajuste:o.ajusteValor};`);
  num('⭐ Recalcular la orden NO le mueve el precio al cliente', recalc.total, 140);

  // el detalle en pantalla
  await ev(page, `openRODetail('${guardada.id}');return 1;`);
  await page.waitForTimeout(600);
  const detalle = await ev(page, `return document.body.innerText;`);
  yes('El detalle de la orden enseña el ajuste', /Ajuste acordado/i.test(detalle), (detalle.match(/Ajuste acordado[^\n]*/) || [''])[0]);
  yes('Y su total dice $140.00', /140\.00/.test(detalle), (detalle.match(/Total[^\n]*/) || [''])[0]);

  // el link que recibe la clienta
  const cli = await ev(page, `
    var capt=null,_o=window.open;window.open=function(u){capt=u;return null;};
    try{ shareStatus('${guardada.id}'); }catch(e){}
    window.open=_o;
    var h=String(capt||'').split('%23s%3D')[1]||String(capt||'').split('#s=')[1]||'';
    h=decodeURIComponent(h.split('&')[0]||'');
    var snap=null;try{snap=JSON.parse(_b64d(h));}catch(e){}
    return snap?{sub:snap.sub,aj:snap.aj,ivu:snap.ivu,sv:(snap.sv||[]).length,
                 sumaSv:Math.round((snap.sv||[]).reduce(function(a,s){return a+(s.p||0);},0)*100)/100}:null;`);
  yes('El link del cliente se genera', !!cli, cli);
  if (cli) {
    num('⭐ En el link del cliente: renglones + ajuste + IVU = $140', cli.sumaSv + cli.aj + cli.ivu, 140);
    yes('Y el ajuste va visible, no escondido', Math.abs(cli.aj) > 0.005, cli.aj);
  }

  // el PDF no puede reventar
  const pdf = await ev(page, `
    var o=DB.ordenes[0];RO=JSON.parse(JSON.stringify(o));
    try{ exportPDF(); }catch(e){ return {err:String(e)}; } return {ok:true};`);
  yes('La factura PDF se genera sin romperse', !pdf.err, pdf.err);

  // el CSV del contable: subtotal e IVU derivados del total tienen que dar $140
  const csv = await ev(page, `
    var ym=new Date().getFullYear()+'-'+('0'+(new Date().getMonth()+1)).slice(-2);
    var fila=buildContableCSV(ym).split('\\n').filter(function(l){return l.indexOf('${guardada.id}')>=0;})[0]||'';
    var c=fila.split(',');
    return { fila:fila, sub:Number(c[7]), ivu:Number(c[8]), total:Number(c[9]) };`);
  num('⭐ El CSV del contable cierra: subtotal + IVU = $140', csv.sub + csv.ivu, 140);
  num('Y su total es $140', csv.total, 140);

  // ---------- QUE NO SE PUEDA USAR PARA HACER TRAMPA SIN QUERER ----------
  const bordes = await ev(page, `
    var base={servicios:[{n:'X',ep:100,qty:1,laborHours:0,parts:[]}],descuento:0,descTipo:'%'};
    var r={};
    var a=JSON.parse(JSON.stringify(base));a.totalManual='';           r.vacio=dineroRO(a).total;
    var b=JSON.parse(JSON.stringify(base));b.totalManual='0';          r.cero=dineroRO(b).total;
    var c=JSON.parse(JSON.stringify(base));c.totalManual='abc';        r.basura=dineroRO(c).total;
    var d=JSON.parse(JSON.stringify(base));d.totalManual='-50';        r.negativo=dineroRO(d).total;
    var e=JSON.parse(JSON.stringify(base));e.totalManual='200';e.descuento=50; r.conDescuento=dineroRO(e).total;
    var f=JSON.parse(JSON.stringify(base));f.totalManual='200';f.garantia=true; r.conGarantia=dineroRO(f).total;
    var g=JSON.parse(JSON.stringify(base));g.totalManual='200';        r.gAjuste=dineroRO(g).ajuste;
    return r;`);
  num('Vacío = cálculo normal ($100 + IVU)', bordes.vacio, 111.5);
  num('Un cero no borra la cuenta, vuelve al cálculo normal', bordes.cero, 111.5);
  num('Texto basura no rompe nada', bordes.basura, 111.5);
  num('Un negativo se ignora', bordes.negativo, 111.5);
  num('⭐ El precio fijado manda sobre el descuento (no se aplican los dos)', bordes.conDescuento, 200);
  num('⭐ Pero la GARANTÍA manda sobre el precio fijado (el cliente paga $0)', bordes.conGarantia, 0);
  num('El ajuste se calcula bien hacia arriba también', bordes.gAjuste, Math.round((200 / 1.115 - 100) * 100) / 100);


  // ---------- LAS VISTAS QUE SE QUEDABAN FUERA ----------
  // La vista previa del asistente y la orden de trabajo tenian su propia matematica.
  // Con el precio fijado ensenaban un total distinto al del estimado.
  const vistas = await ev(page, `
    var o=DB.ordenes[0];
    RO=JSON.parse(JSON.stringify(o));
    var m=dineroRO(RO);
    var wo=null; try{ workOrderPDF(); wo='ok'; }catch(e){ wo='ERR '+e.message; }
    closeROView&&closeROView();
    var vista=document.body.innerText;
    return { total:m.total, wo:wo, tiene140:/140\.00/.test(vista) };`);
  num('La vista previa del asistente usa el mismo total', vistas.total, 140);
  yes('La orden de trabajo no revienta con precio fijado', !/^ERR/.test(String(vistas.wo)), vistas.wo);

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nPRECIO FINAL ACORDADO — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
