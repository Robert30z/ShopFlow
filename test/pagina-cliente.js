// LO QUE VE EL CLIENTE TIENE QUE CUADRAR CON LO QUE PAGA.
// Auditoría 2026-07-27 (parte 3). La página de estado (el link "#s=" que se le manda por
// WhatsApp) es la única superficie que ve el cliente por su cuenta. Dos bugs medidos:
//   · los renglones traían solo el precio base del servicio: una orden con 1.5 h de mano de obra
//     y $72 de piezas listaba "Frenos delanteros $139" y abajo "TOTAL $407.53", sin línea de IVU
//     en ningún sitio. Desde el celular eso se lee como un cobro escondido.
//   · los recomendados salían todos como la palabra "Recomendado": el código leía `d.n`/`d.desc`
//     y el campo real es `d.nombre`. El cliente no sabía qué le hacía falta al carro — y ese es
//     el trabajo que se vende después.
// Usage:  python -m http.server 8931   (raíz del repo) + node pagina-cliente.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const num = (n, got, exp) => (Math.abs(got - exp) < 0.02 ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  const armar = (desc) => page.evaluate(d => {
    DB.ordenes = [{
      id: 'RO-500', fecha: new Date().toISOString(), cliente: 'Ana Rivera', tel: '',
      vehiculo: { year: '2019', make: 'Toyota', model: 'Corolla' },
      servicios: [{
        id: 's1', uid: 'u1', n: 'Frenos delanteros', p: 139, ep: 139, qty: 1, laborHours: 1.5,
        parts: [{ name: 'Pastillas cerámicas', cost: 38, sellPrice: 72, qty: 1 }]
      }],
      denegados: [{ nombre: 'Gomas delanteras', precio: 240, urgencia: 'urgente' },
                  { autoId: 'pf', nombre: 'Revisar: Front pads', precio: 0, auto: true }],
      insp: {}, descuento: d, descTipo: '%', total: 0, estado: 'pendiente'
    }];
    recalcROTotal(DB.ordenes[0]);
    saveDB({ force: true });
    let url = null;
    const op = window.prompt, ow = window.open;
    window.prompt = (a, b) => { url = b; return null; };
    window.open = () => { };
    shareStatus('RO-500');
    window.prompt = op; window.open = ow;
    return { total: DB.ordenes[0].total, url: url, snap: JSON.parse(decodeURIComponent(escape(atob(url.split('#s=')[1])))) };
  }, desc);

  // ---------- 1. SIN DESCUENTO: renglones + IVU = total ----------
  const a = await armar(0);
  const suma = a.snap.sv.reduce((s, x) => s + x.p * (x.q || 1), 0);
  num('el renglón incluye servicio + mano de obra + piezas ($139 + 1.5h×$103 + $72)', a.snap.sv[0].p, 365.50);
  num('el subtotal enviado = suma de los renglones', a.snap.sub, suma);
  num('subtotal + IVU = el total que se le cobra', a.snap.sub + a.snap.ivu, a.total);
  num('el IVU es el 11.5% del subtotal', a.snap.ivu, 42.03);
  is('el recomendado lleva su nombre real', a.snap.dn.map(x => x.n), ['Gomas delanteras']);
  num('y su precio', a.snap.dn[0].p, 240);
  is('los "revisar" automáticos sin confirmar no se le mandan al cliente', a.snap.dn.length, 1);

  // ---------- 2. CON DESCUENTO: el cliente ve la rebaja ----------
  const b = await armar(10);
  num('con 10% de descuento, subtotal − descuento + IVU = total', b.snap.sub - b.snap.desc + b.snap.ivu, b.total);
  num('el descuento va a la vista', b.snap.desc, 36.55);

  // ---------- 3. LA PÁGINA RENDERIZADA (lo que el cliente lee de verdad) ----------
  const vista = await page.evaluate(u => {
    location.hash = u.split('#')[1];
    renderCustomerStatus();
    const t = document.body.innerText;
    return {
      tieneIVU: /IVU \(11\.5%\)/.test(t),
      tieneSubtotal: /Subtotal/.test(t),
      tieneGomas: /Gomas delanteras/.test(t),
      diceRecomendadoGenerico: /^Recomendado$/m.test(t),
      total: (t.match(/Total\s*\$([\d.,]+)/) || [])[1],
      // el importe del renglón va en su propia columna; se comprueba que esté impreso tal cual
      renglon: /\$365\.50/.test(t) ? '365.50' : t.slice(0, 200),
      manoDeObra: /1\.5 h de mano de obra/.test(t)
    };
  }, a.url);
  is('la página muestra Subtotal e IVU', [vista.tieneSubtotal, vista.tieneIVU], [true, true]);
  is('la página nombra el trabajo recomendado', [vista.tieneGomas, vista.diceRecomendadoGenerico], [true, false]);
  is('explica la mano de obra debajo del renglón', vista.manoDeObra, true);
  is('el renglón y el total que lee el cliente', [vista.renglon, vista.total], ['365.50', '407.53']);

  console.log('\n' + (fail === 0 ? 'TODO VERDE' : 'HAY FALLOS') + ' — ' + pass + ' pass / ' + fail + ' fail');
  if (errs.length) { console.log('page errors:', errs); process.exitCode = 1; }
  if (fail) process.exitCode = 1;
  await browser.close();
})();
