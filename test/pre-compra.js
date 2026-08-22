// INSPECCIÓN PRE-COMPRA — el reporte que el comprador se lleva al vendedor.
// Batch 34 (12-ago-2026). Lo pidió él después de que le llegara el scanner Launch.
//
// POR QUÉ EXISTE ESTE MODO. El DVI está hecho para un carro que YA es del cliente y vino a
// arreglarse: sus términos hablan de garantía de piezas, de denegados y de vehículos no
// reclamados, y su pie dice "inspección visual de cortesía". Nada de eso aplica cuando alguien
// PAGA desde $80 por que le revisen un carro ajeno antes de comprarlo. Mandarle ese papel es
// documentar el trabajo con el documento equivocado.
//
// LO QUE SE PRUEBA (los 3 ejes por donde esto se rompe de verdad):
//  1. QUE NO SE MEZCLEN LOS DOCUMENTOS. Una orden de pre-compra NO puede ofrecer el botón de DVI,
//     y una orden normal NO puede ofrecer el de pre-compra.
//  2. QUE EL NÚMERO CUADRE ENTRE SUPERFICIES. El total para negociar sale de los denegados y
//     tiene que ser el MISMO en pantalla, en el PDF y en el WhatsApp. (Es la lección del bug de
//     dinero del 31-jul: el mismo número calculado en tres sitios termina discrepando.)
//  3. QUE SOBREVIVA AL GUARDADO. `upsertRO` clona la orden; si el veredicto no viaja, el técnico
//     lo escribe y desaparece al guardar.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node pre-compra.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. ARRANCA APAGADA Y SE ENCIENDE ----------
  const t = await page.evaluate(() => {
    go('ro'); gotoStep(5);
    const apagada = !esPreCompra({ preCompra: RO.preCompra });
    togglePreCompra();
    const hayVeredictos = document.querySelectorAll('#pc-wrap button').length;
    return { apagada, encendida: !!RO.preCompra.activo, hayVeredictos };
  });
  is('la pre-compra arranca apagada', t.apagada, true);
  is('el toggle la enciende', t.encendida, true);
  is('salen los 3 veredictos', t.hayVeredictos, 3);

  // ---------- 2. EL NÚMERO PARA NEGOCIAR ----------
  const num = await page.evaluate(() => {
    RO.denegados = [
      { nombre: 'Frenos delanteros', precio: 139, urgencia: 'urgente' },
      { nombre: 'Dos gomas delanteras', precio: 220, urgencia: 'importante' },
      { nombre: 'Sin precio todavía', precio: 0, urgencia: 'recomendado' },
      { nombre: 'Auto no confirmado', precio: 90, auto: true }   // no cuenta: auto sin confirmar
    ];
    setPCVer('negociar');
    setPCPedido(6500);
    const txt = document.getElementById('pc-math').textContent;
    return {
      total: pcTotalNecesita(RO),
      pedido: RO.preCompra.precioPedido,
      enPantalla: /359\.00/.test(txt),
      conversar: /6,?141\.00/.test(txt)
    };
  });
  is('el total suma solo los denegados con precio y confirmados', num.total, 359);
  is('el precio pedido se guarda', num.pedido, 6500);
  is('el total sale en pantalla', num.enPantalla, true);
  is('el precio a conversar sale en pantalla (6500 - 359)', num.conversar, true);

  // ---------- 3. EL VEREDICTO Y LA NOTA SOBREVIVEN AL GUARDADO ----------
  const guardado = await page.evaluate(() => {
    RO.preCompra.nota = 'Motor y transmisión sanos. Necesita frenos y dos gomas.';
    RO.cliente = 'Ejemplo Comprador';
    RO.tel = '7875551234';
    RO.vehiculo = { year: '2016', make: 'Toyota', model: 'Corolla', tag: 'ABC123' };
    RO.insp = { pf: 'rojo', tfl: 'amarillo', bat: 'verde' };
    RO.servicios = [{ id: 'd2', uid: 'u1', n: 'Inspección pre-compra (desde)', p: 80, ep: 80, qty: 1, parts: [], laborHours: 0 }];
    const sel = document.getElementById('est-estado'); if (sel) sel.value = 'pagado';
    const oa = window.alert; window.alert = () => { };
    saveRO();
    window.alert = oa;
    const o = DB.ordenes[DB.ordenes.length - 1];
    return {
      id: o.id,
      activo: !!(o.preCompra || {}).activo,
      veredicto: (o.preCompra || {}).veredicto,
      nota: ((o.preCompra || {}).nota || '').slice(0, 20),
      pedido: (o.preCompra || {}).precioPedido,
      esPre: esPreCompra(o),
      totalGuardado: pcTotalNecesita(o)
    };
  });
  is('la pre-compra sobrevive al guardado', guardado.activo, true);
  is('el veredicto sobrevive', guardado.veredicto, 'negociar');
  is('la nota sobrevive', guardado.nota, 'Motor y transmisión ');
  is('el precio pedido sobrevive', guardado.pedido, 6500);
  is('la orden se reconoce como pre-compra', guardado.esPre, true);
  is('el total no cambia al guardar', guardado.totalGuardado, 359);

  // ---------- 4. NO SE MEZCLAN LOS DOCUMENTOS ----------
  const botones = await page.evaluate((roId) => {
    openRODetail(roId);
    const h = document.body.innerHTML;
    return {
      ofreceDVI: /dviPDF\('/.test(h) || /waDVI\('/.test(h),
      ofrecePre: /preCompraPDF\('/.test(h) && /waPreCompra\('/.test(h)
    };
  }, guardado.id);
  is('una pre-compra NO ofrece el DVI', botones.ofreceDVI, false);
  is('una pre-compra SÍ ofrece su propio reporte', botones.ofrecePre, true);

  // y al revés: una orden normal sigue con su DVI intacto
  const normal = await page.evaluate(() => {
    const o = JSON.parse(JSON.stringify(DB.ordenes[DB.ordenes.length - 1]));
    o.id = 'RO-PRUEBA-NORMAL'; delete o.preCompra;
    DB.ordenes.push(o); saveDB();
    openRODetail(o.id);
    const h = document.body.innerHTML;
    return { ofreceDVI: /dviPDF\('/.test(h), ofrecePre: /preCompraPDF\('/.test(h) };
  });
  is('una orden normal conserva su DVI', normal.ofreceDVI, true);
  is('una orden normal NO ofrece pre-compra', normal.ofrecePre, false);

  // ---------- 5. EL WHATSAPP DICE EL MISMO NÚMERO QUE LA PANTALLA ----------
  const wa = await page.evaluate((roId) => {
    let capturado = '';
    const orig = window.waSend;
    window.waSend = (tel, msg) => { capturado = msg; };
    waPreCompra(roId);
    window.waSend = orig;
    return {
      trae359: capturado.indexOf('359.00') !== -1,
      trae6500: capturado.indexOf('6500.00') !== -1,
      traeConversar: capturado.indexOf('6141.00') !== -1,
      traeVeredicto: capturado.indexOf('Se puede comprar tomando en cuenta lo que necesita') !== -1,
      cierraComoEl: capturado.indexOf('Quedo al pendiente 🏁') !== -1,
      abreComoEl: capturado.indexOf('Saludos') === 0,
      // reglas duras de su voz y de lo legal
      sinRayaLarga: capturado.indexOf('—') === -1,
      sinCredencial: !/certificad|licenciad/i.test(capturado),
      sinPalabraFea: !/tirado|varado|botar dinero|estafa/i.test(capturado),
      decideElCliente: /decisión de comprarlo es suya/i.test(capturado)
    };
  }, guardado.id);
  is('el WhatsApp trae el total que necesita', wa.trae359, true);
  is('el WhatsApp trae el precio del vendedor', wa.trae6500, true);
  is('el WhatsApp trae el precio a conversar', wa.traeConversar, true);
  is('el WhatsApp trae el veredicto completo', wa.traeVeredicto, true);
  is('abre como él (Saludos)', wa.abreComoEl, true);
  is('cierra como él (Quedo al pendiente 🏁)', wa.cierraComoEl, true);
  is('sin rayas largas (él nunca las usa)', wa.sinRayaLarga, true);
  is('sin "certificado" ni "licenciado"', wa.sinCredencial, true);
  is('sin palabras que pinten mal al cliente', wa.sinPalabraFea, true);
  is('deja la decisión en manos del comprador', wa.decideElCliente, true);

  // ---------- 6. LOS TÉRMINOS SON DE PRE-COMPRA, NO DE REPARACIÓN ----------
  const term = await page.evaluate(() => ({
    hablaDeAlcance: /ALCANCE/.test(DISC_PC),
    diceQueNoEsLegal: /título|gravámenes/i.test(DISC_PC),
    decideElComprador: /DECISIÓN ES DEL COMPRADOR/i.test(DISC_PC),
    sinGarantiaDePiezas: !/GARANTÍA \(30 DÍAS/i.test(DISC_PC),
    sinVehiculosNoReclamados: !/NO RECLAMADOS/i.test(DISC_PC),
    sinCredencial: !/certificad|licenciad/i.test(DISC_PC)
  }));
  is('los términos declaran el alcance', term.hablaDeAlcance, true);
  is('los términos aclaran que no es revisión legal ni de historial', term.diceQueNoEsLegal, true);
  is('los términos dejan la decisión al comprador', term.decideElComprador, true);
  is('los términos NO traen la garantía de piezas del taller', term.sinGarantiaDePiezas, true);
  is('los términos NO traen lo de vehículos no reclamados', term.sinVehiculosNoReclamados, true);
  is('los términos no usan "certificado" ni "licenciado"', term.sinCredencial, true);

  // ---------- 7. EL PDF SE GENERA DE VERDAD ----------
  const pdf = await page.evaluate((roId) => {
    let guardado = null;
    // jsPDF pone `save` como propiedad de LA INSTANCIA, no del prototipo, así que parcharlo
    // arriba no atrapa nada. El punto real por donde sale todo PDF de la app es sharePDFDoc.
    const orig = window.sharePDFDoc;
    let paginas = 0;
    window.sharePDFDoc = function (doc, fname) { guardado = fname; paginas = doc.internal.getNumberOfPages(); };
    try { preCompraPDF(roId); } catch (e) { window.sharePDFDoc = orig; return { err: String(e) }; }
    window.sharePDFDoc = orig;
    return { nombre: guardado, paginas: paginas };
  }, guardado.id);
  is('el PDF de pre-compra se genera con su propio nombre', pdf.nombre, 'PreCompra_' + guardado.id + '.pdf');
  // Los términos van en su propia página al final, así que nunca puede salir de una sola.
  if (pdf.paginas >= 2) ok('el PDF trae la página de términos', pdf.paginas); else no('el PDF no llegó a la página de términos', pdf);

  // ---------- 8. LO QUE ENCONTRÓ CODEX (12-ago) ----------
  // Un respaldo restaurado o un import pueden traer el precio como TEXTO. Con `+` a secas,
  // "139"+"220" da "139220" y el comprador se lleva un número inventado a negociar.
  const str = await page.evaluate(() => {
    const falsa = { denegados: [{ nombre: 'A', precio: '139' }, { nombre: 'B', precio: '220' }] };
    return { total: pcTotalNecesita(falsa) };
  });
  is('un precio guardado como texto SUMA, no se concatena', str.total, 359);

  const basura = await page.evaluate(() => ({
    negativo: pcTotalNecesita({ denegados: [{ precio: -50 }, { precio: 100 }] }),
    nulo: pcTotalNecesita({ denegados: [{ precio: null }, { precio: undefined }, {}] }),
    texto: pcTotalNecesita({ denegados: [{ precio: 'abc' }, { precio: 100 }] }),
    sinNada: pcTotalNecesita({})
  }));
  is('un precio negativo no resta del total', basura.negativo, 100);
  is('precios vacíos no rompen el total', basura.nulo, 0);
  is('texto que no es número no rompe el total', basura.texto, 100);
  is('una orden sin denegados da cero', basura.sinNada, 0);

  // Un trabajo sin cotizar SIGUE siendo trabajo que el carro necesita: se lista, no se esconde.
  const sinPrecio = await page.evaluate(() => {
    const o = { denegados: [{ nombre: 'Frenos', precio: 139 }, { nombre: 'Falta cotizar', precio: 0 }] };
    return { enLista: pcNecesita(o).length, enTotal: pcTotalNecesita(o) };
  });
  is('lo que no tiene precio igual aparece en el desglose', sinPrecio.enLista, 2);
  is('pero no infla el total', sinPrecio.enTotal, 139);

  // Sin veredicto, el reporte pregunta antes de salir (es lo que el cliente compró).
  const sinVer = await page.evaluate((roId) => {
    const o = DB.ordenes.find(x => x.id === roId);
    const antes = o.preCompra.veredicto;
    o.preCompra.veredicto = '';
    let preguntó = false, salió = null;
    const oc = window.confirm; window.confirm = () => { preguntó = true; return false; };
    const os = window.sharePDFDoc; window.sharePDFDoc = function (d, f) { salió = f; };
    preCompraPDF(roId);
    window.confirm = oc; window.sharePDFDoc = os;
    o.preCompra.veredicto = antes;
    return { preguntó, salió };
  }, guardado.id);
  is('sin veredicto el reporte pregunta antes', sinVer.preguntó, true);
  is('y si dices que no, no genera nada', sinVer.salió, null);

  // Una nota larguísima no puede empujar el número para negociar fuera de la página.
  const larga = await page.evaluate((roId) => {
    const o = DB.ordenes.find(x => x.id === roId);
    const antes = o.preCompra.nota;
    o.preCompra.nota = ('Este vehículo fue revisado punto por punto y a continuación se detalla todo lo observado durante la inspección. ').repeat(14);
    let pgs = 0, nombre = null;
    const os = window.sharePDFDoc;
    window.sharePDFDoc = function (d, f) { nombre = f; pgs = d.internal.getNumberOfPages(); };
    preCompraPDF(roId);
    window.sharePDFDoc = os;
    o.preCompra.nota = antes;
    return { pgs, nombre };
  }, guardado.id);
  if (larga.nombre && larga.pgs >= 2) ok('una nota larguísima genera el PDF sin romperlo', larga); else no('la nota larga rompió el PDF', larga);

  if (errs.length) no('errores de JS en consola', errs); else ok('sin errores de JS');
  console.log('\n' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
