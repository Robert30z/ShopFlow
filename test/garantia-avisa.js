// EL AVISO DE GARANTÍA — que la app te la recuerde antes de que se venza.
// ---------------------------------------------------------------------------
// Roberto: "realizar el aviso de garantía por vencer". Dos avisos, dos momentos distintos:
//   1. EN EL HOME: la que vence pronto (≤60 días) — para avisarle al cliente ANTES, no después.
//   2. AL ABRIR LA ORDEN NUEVA: "este cliente trae piezas EN GARANTÍA" — el que te ahorra plata,
//      porque cobrarle una pieza que el suplidor repone gratis es dinero regalado.
// Se prueba con el reloj movido: una garantía a 30 días de vencer, una vigente de sobra y
// una ya vencida, para que las tres caigan donde deben.
// Usage:  python -m http.server 8931  (raíz del repo) + node garantia-avisa.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Tres piezas vendidas en fechas distintas, todas con garantía:
  //   · batería 5 años comprada hace 4 años y 11 meses  → vence en ~30 días  ⇒ AVISO
  //   · alternador 2 años comprado hace 1 mes           → vigente de sobra   ⇒ sin aviso
  //   · bomba de agua 1 año comprada hace 2 años        → vencida            ⇒ sin aviso
  const sem = await ev(page, `
    function menos(dias){var d=new Date(Date.now()-dias*86400000);return localDateStr(d);}
    DB.ordenes=[
      { id:'RO-1', cliente:'Carmen Rivera', tel:'787-555-3344', estado:'pagado', total:256.45,
        fecha:new Date(Date.now()-1795*86400000).toISOString(),
        vehiculo:{year:'2016',make:'Toyota',model:'Corolla',tag:'IAB-330'},
        servicios:[{n:'Cambio de batería',ep:45,qty:1,parts:[
          {name:'Batería Duralast Gold 35-DLG',partNum:'35-DLG',supplier:'AutoZone Bayamón',
           cost:129.99,sellPrice:185,qty:1,receipt:'ADV-789012',date:menos(1795),warrantyMonths:60}]}]},
      { id:'RO-2', cliente:'Carmen Rivera', tel:'787-555-3344', estado:'pagado', total:320,
        fecha:new Date(Date.now()-30*86400000).toISOString(),
        vehiculo:{year:'2016',make:'Toyota',model:'Corolla',tag:'IAB-330'},
        servicios:[{n:'Alternador',ep:120,qty:1,parts:[
          {name:'Alternador remanufacturado',partNum:'AL-9902',supplier:'AutoZone Bayamón',
           cost:180,sellPrice:245,qty:1,receipt:'ADV-991144',date:menos(30),warrantyMonths:24}]}]},
      { id:'RO-3', cliente:'Luis Torres', tel:'787-555-7788', estado:'pagado', total:210,
        fecha:new Date(Date.now()-730*86400000).toISOString(),
        vehiculo:{year:'2012',make:'Honda',model:'Accord',tag:'HGT-201'},
        servicios:[{n:'Bomba de agua',ep:90,qty:1,parts:[
          {name:'Bomba de agua Gates',partNum:'WP-4410',supplier:'NAPA',
           cost:70,sellPrice:120,qty:1,receipt:'NP-5511',date:menos(730),warrantyMonths:12}]}]}
    ];
    DB.clientes=[
      {id:'CLI-1',nombre:'Carmen Rivera',tel:'787-555-3344',vehiculos:[{tag:'IAB-330',desc:'2016 Toyota Corolla'}],creado:'2021-01-01T10:00:00.000Z'},
      {id:'CLI-2',nombre:'Luis Torres',tel:'787-555-7788',vehiculos:[{tag:'HGT-201',desc:'2012 Honda Accord'}],creado:'2024-01-01T10:00:00.000Z'}
    ];
    saveDB({force:true});
    return garantiasPiezas().map(function(g){return {p:g.pieza,d:g.dias,viva:g.vigente};});`);

  const bat = sem.find(g => /Duralast/.test(g.p));
  const alt = sem.find(g => /Alternador/.test(g.p));
  const bom = sem.find(g => /Bomba/.test(g.p));
  yes('La batería de 5 años está a punto de vencer (~30 días)', bat && bat.viva && bat.d > 20 && bat.d < 45, bat);
  yes('El alternador de 2 años sigue vigente de sobra', alt && alt.viva && alt.d > 600, alt);
  yes('La bomba de 1 año ya está vencida', bom && !bom.viva, bom);

  const porVencer = await ev(page, `return garantiasPorVencer(60).map(function(g){return g.pieza;});`);
  is('Solo la que vence pronto entra en "por vencer"', porVencer, ['Batería Duralast Gold 35-DLG']);

  // ---------- AVISO 1: EN EL HOME ----------
  await ev(page, `go('home');renderHome();return 1;`);
  await page.waitForTimeout(600);
  const home = await ev(page, `
    var el=document.getElementById('home-notifs');
    return { txt:el?el.innerText:'', botones:el?el.querySelectorAll('button').length:0,
             html:el?el.innerHTML:'' };`);
  yes('El home avisa que la garantía está por vencer', /garant/i.test(home.txt) && /Duralast/.test(home.txt), home.txt);
  yes('Y dice a cuántos días y hasta cuándo', /\d+d/.test(home.txt) && /20\d\d/.test(home.txt), home.txt);
  yes('No mete en el aviso la que ya venció', !/Bomba/.test(home.txt), home.txt);
  yes('Ni la que le queda año y medio', !/Alternador/.test(home.txt), home.txt);
  yes('Trae botón de WhatsApp para avisarle al cliente', /waGarantia/.test(home.html), home.botones);

  // El mensaje al cliente: de servicio, NUNCA sembrando que algo va a fallar
  const msg = await ev(page, `
    var enviado='';
    var _s=window.waSend; window.waSend=function(tel,m){enviado=m;};
    waGarantia('RO-1','Batería Duralast Gold 35-DLG');
    window.waSend=_s;
    return enviado;`);
  yes('El WhatsApp nombra la pieza y hasta cuándo está cubierta', /Duralast/.test(msg) && /20\d\d/.test(msg), msg);
  yes('Trata al cliente por su nombre y con respeto', /Carmen/.test(msg) && /Saludos/.test(msg), msg);
  yes('NO le siembra que la pieza va a fallar ni que algo salió mal',
      !/(falla|fallar|dañ|problema|mal\b|defect)/i.test(msg), msg);
  yes('Sin "undefined" ni basura en el mensaje al cliente', !/(undefined|NaN|\[object)/.test(msg), msg);

  // ---------- AVISO 2: AL ABRIR LA ORDEN NUEVA ----------
  await page.click('#home .mc');
  await page.waitForTimeout(400);
  await page.fill('#c-n', 'Carmen Rivera');
  await page.waitForTimeout(600);
  const banner = await ev(page, `
    var b=document.getElementById('cli-garantias');
    return { visible:!!(b&&b.style.display!=='none'&&b.innerText.trim()), txt:b?b.innerText:'' };`);
  yes('Al escribir el nombre, la orden avisa que trae piezas en garantía', banner.visible, banner.txt);
  yes('Nombra las DOS vigentes (batería y alternador)', /Duralast/.test(banner.txt) && /Alternador/.test(banner.txt), banner.txt);
  yes('Y enseña el invoice con el que se le reclama al suplidor', /ADV-789012/.test(banner.txt), banner.txt);
  yes('La vencida NO aparece como si estuviera cubierta', !/Bomba/.test(banner.txt), banner.txt);

  // Un cliente sin garantías vivas no debe ver el aviso
  await page.fill('#c-n', 'Luis Torres');
  await page.waitForTimeout(600);
  const sinGar = await ev(page, `
    var b=document.getElementById('cli-garantias');
    return { visible:!!(b&&b.style.display!=='none'&&b.innerText.trim()), txt:b?b.innerText:'' };`);
  is('Un cliente con la garantía vencida NO ve el aviso', sinGar.visible, false);

  // ---------- LA FICHA DEL CLIENTE ----------
  await ev(page, `go('clientes');openCliDetail('CLI-1');return 1;`);
  await page.waitForTimeout(500);
  const ficha = await ev(page, `return (document.getElementById('clientes-body')||{}).innerText||'';`);
  yes('La ficha del cliente tiene su sección de Garantías', /Garant/i.test(ficha), ficha.slice(0, 200));
  yes('Con las 2 vigentes contadas', /2 vigentes/.test(ficha), (ficha.match(/Garantías[^\n]*/) || [''])[0]);

  await ev(page, `go('clientes');openCliDetail('CLI-2');return 1;`);
  await page.waitForTimeout(500);
  const ficha2 = await ev(page, `return (document.getElementById('clientes-body')||{}).innerText||'';`);
  yes('La vencida sí sale en la ficha, marcada como vencida (explica por qué esta vez se cobra)',
      /vencida/i.test(ficha2), (ficha2.match(/Bomba[^\n]*\n?[^\n]*/) || [''])[0]);

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nAVISO DE GARANTÍA — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
