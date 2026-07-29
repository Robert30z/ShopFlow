// BORRAR Y RESTAURAR UNA ORDEN — ¿qué pasa con el estante y con la caja?
// ---------------------------------------------------------------------------
// Sonda del 28-jul (4ta auditoría). El ciclo completo papelera → restaurar nunca se había
// corrido mirando el INVENTARIO ni el LIBRO DE PAGOS. Se le pregunta lo mismo a dos sitios:
//   "¿cuántas bujías me quedan?"  → la pantalla de Inventario vs el estante de verdad
//   "¿cuánto entró hoy?"          → el cierre de caja vs lo que el cliente pagó
// El bug que ya se arregló el 27-jul (borrar UNA pieza devolvía el stock) tiene un hermano:
// borrar la ORDEN COMPLETA.
// Usage:  python -m http.server 8931  (raíz del repo) + node papelera-inventario.js
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
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  const stock = () => ev(page, `var i=DB.inventario.find(function(x){return x.id==='INV-BUJ';});return i?i.qty:null;`);
  const caja = () => ev(page, `
    var h0=new Date();h0.setHours(0,0,0,0);
    return cobradoEnRango(h0,new Date(h0.getTime()+86400000)).total;`);

  // Estante: 10 bujías. Una orden real que gasta 4 y se cobra.
  await ev(page, `
    DB.inventario=[{id:'INV-BUJ',nombre:'Bujía NGK Iridium',cat:'Motor',costo:9,precio:18,qty:10,min:4,loc:'A-3'}];
    saveDB({force:true});return 1;`);
  is('El estante arranca con 10 bujías', await stock(), 10);

  await ev(page, `
    var o={id:'RO-1',cliente:'Pedro Santos',tel:'787-555-1010',estado:'pagado',
      fecha:new Date().toISOString(),vehiculo:{year:'2015',make:'Honda',model:'Civic',tag:'PQR-808'},
      servicios:[{n:'Tune up',ep:80,qty:1,laborHours:1,parts:[
        {name:'Bujía NGK Iridium',partNum:'',supplier:'NAPA',cost:9,sellPrice:18,qty:4,receipt:'NP-77',date:localDateStr()}]}],
      denegados:[],insp:{},fotos:[]};
    DB.ordenes=[o];
    // el estante se descuenta como lo hace la app al agregar la pieza
    ajustarInventario('Bujía NGK Iridium','',-4);
    recalcROTotal(o);
    registrarPago(o,o.total,'ATH Móvil');
    sellarFactura(o);
    saveDB({force:true});
    return 1;`);
  is('Tras la orden quedan 6 en el estante', await stock(), 6);
  const cobrado = await caja();
  yes('Y el cobro del día entró a la caja', cobrado > 0, cobrado);

  // ---------- SE BORRA LA ORDEN (mis-tap / orden hecha al cliente equivocado) ----------
  await ev(page, `deleteRO('RO-1','orden creada al cliente equivocado');return 1;`);
  await page.waitForTimeout(500);
  const trasBorrar = await ev(page, `return { activas:DB.ordenes.length, papelera:DB.papelera.length,
    stock:(DB.inventario.find(function(x){return x.id==='INV-BUJ';})||{}).qty, caja:(function(){
      var h0=new Date();h0.setHours(0,0,0,0);return cobradoEnRango(h0,new Date(h0.getTime()+86400000)).total;})() };`);
  is('La orden se va a la papelera (no se destruye)', { a: trasBorrar.activas, p: trasBorrar.papelera }, { a: 0, p: 1 });
  num('El cobro sale de la caja del día (la orden ya no cuenta)', trasBorrar.caja, 0);
  is('⭐ Las 4 bujías VUELVEN al estante — el físico tiene 10', trasBorrar.stock, 10);

  // ---------- SE RESTAURA (era buena, se borró por error) ----------
  await ev(page, `restaurarDePapelera('RO-1');return 1;`);
  await page.waitForTimeout(500);
  const trasRestaurar = await ev(page, `return { activas:DB.ordenes.length, papelera:DB.papelera.length,
    stock:(DB.inventario.find(function(x){return x.id==='INV-BUJ';})||{}).qty, caja:(function(){
      var h0=new Date();h0.setHours(0,0,0,0);return cobradoEnRango(h0,new Date(h0.getTime()+86400000)).total;})() };`);
  is('La orden vuelve a la lista activa', { a: trasRestaurar.activas, p: trasRestaurar.papelera }, { a: 1, p: 0 });
  num('Y su cobro vuelve a la caja del día', trasRestaurar.caja, cobrado);
  is('⭐ Y las 4 bujías se vuelven a descontar (quedan 6)', trasRestaurar.stock, 6);

  // ---------- IDA Y VUELTA DOS VECES: el estante no puede irse a la deriva ----------
  await ev(page, `deleteRO('RO-1','prueba');restaurarDePapelera('RO-1');
    deleteRO('RO-1','prueba');restaurarDePapelera('RO-1');return 1;`);
  await page.waitForTimeout(500);
  is('Borrar y restaurar dos veces más deja el estante igual (6), no a la deriva', await stock(), 6);
  num('Y la caja tampoco se duplica', await caja(), cobrado);

  // ---------- EL MISMO BUG EN EL OTRO CAMINO: las piezas del CATÁLOGO ----------
  // (Menú → servicio → Piezas. Ahí se descontaba al agregar y no se devolvía al borrar,
  //  y editar la cantidad no ajustaba nada: de 1 a 3 descontaba 1 solo.)
  const cat = await ev(page, `
    DB.inventario=[{id:'INV-BUJ',nombre:'Bujía NGK Iridium',cat:'Motor',costo:9,precio:18,qty:10,min:4,loc:'A-3'}];
    DB.serviceParts={};
    currentPartService={id:'svc-cat-1',n:'Tune up'};partsContext='menu';_editPartIdx=-1;
    saveDB({force:true});
    function form(n,q){ document.getElementById('pp-name').value=n;
      document.getElementById('pp-qty').value=String(q);
      document.getElementById('pp-num').value='';document.getElementById('pp-sup').value='NAPA';
      document.getElementById('pp-cost').value='9';document.getElementById('pp-sell').value='18';
      document.getElementById('pp-receipt').value='';document.getElementById('pp-date').value=localDateStr();
      var w=document.getElementById('pp-warr');if(w)w.value=''; }
    var q=function(){return DB.inventario[0].qty;};
    form('Bujía NGK Iridium',4); savePart();            // agregar 4  → 6
    var trasAgregar=q();
    _editPartIdx=0; form('Bujía NGK Iridium',6); savePart();  // editar 4→6 → 4
    var trasEditar=q();
    _editPartIdx=-1;
    deletePart(0);                                       // borrar     → 10
    var trasBorrar=q();
    return { trasAgregar:trasAgregar, trasEditar:trasEditar, trasBorrar:trasBorrar };`);
  is('Catálogo: agregar 4 bujías baja el estante a 6', cat.trasAgregar, 6);
  is('⭐ Catálogo: subir la cantidad de 4 a 6 descuenta las 2 que faltaban (4)', cat.trasEditar, 4);
  is('⭐ Catálogo: borrar la pieza devuelve las 6 al estante (10)', cat.trasBorrar, 10);

  // ---------- LA BITÁCORA TIENE QUE DELATAR EL MOVIMIENTO ----------
  const bita = await ev(page, `return (DB.bitacora||[]).map(function(b){return b.tipo;});`);
  yes('La bitácora anota que la orden fue a la papelera', bita.indexOf('orden-a-papelera') >= 0, bita);
  yes('Y anota que se restauró', bita.some(t => /restaur/i.test(t)), bita);

  yes('Sin errores de JavaScript en toda la corrida', errs.length === 0, errs);

  console.log('\nPAPELERA E INVENTARIO — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
