// SE TIENE QUE PODER LLEGAR HASTA EL FINAL DE CADA PANTALLA.
// Bug reportado por Roberto el 31-jul-2026: "la pagina no me deja bajar hasta abajo completamente".
//
// QUÉ PASABA: `.pg` (el contenedor de cada pantalla) tenía `height:100vh` a secas. En iOS,
// `100vh` NO es lo que se ve: es la altura de la pantalla COMO SI la barra de direcciones y la
// de abajo estuvieran escondidas. Así que `.pg` quedaba más alta que el área visible y, como
// lleva `overflow:hidden` y el body no scrollea (`height:100%` + `overscroll-behavior:none`),
// el final del contenedor que sí scrollea (`flex:1;overflow-y:auto`) quedaba POR DEBAJO de la
// pantalla, sin manera de llegar. Se perdían los últimos renglones de las listas y los botones
// del final de los formularios — justo donde están "Agendar cita" y "Guardar".
//
// EL ARREGLO: `height:100dvh` (la altura visible de verdad, que se ajusta sola cuando la barra
// aparece o se va), con `100vh` delante como respaldo, más `viewport-fit=cover` y padding de
// abajo para que la última fila no quede debajo de la barra del home.
//
// OJO CON ESTA PRUEBA (honestidad): un Chromium de escritorio NO reproduce la barra dinámica de
// Safari en iOS, así que aquí no se puede "ver" el bug original. Lo que sí se prueba es (a) que
// la declaración correcta está puesta y no se pierda en un refactor, y (b) la CLASE del problema:
// que con una pantalla bajita y una lista larga, el último renglón se pueda alcanzar y quede
// completo dentro del área visible.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node llegar-hasta-abajo.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (got === exp ? ok(n, got) : no(n, { got, exp }));

(async () => {
  const browser = await chromium.launch();
  // iPhone de los apretados: pantalla corta, que es donde el bug mordía
  const page = await browser.newPage({ viewport: { width: 390, height: 560 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // (a) la declaración está puesta
  const css = await page.evaluate(async () => {
    const t = await (await fetch(location.href)).text();
    const m = t.match(/\.pg\{[^}]*\}/);
    return { regla: m ? m[0] : '', viewport: (t.match(/<meta name="viewport"[^>]*>/) || [''])[0] };
  });
  is('.pg declara 100dvh (la altura visible de verdad)', /height:100dvh/.test(css.regla), true);
  is('...y deja 100vh delante como respaldo', /height:100vh;height:100dvh/.test(css.regla), true);
  is('.pg respeta la barra del home', /padding-bottom:env\(safe-area-inset-bottom/.test(css.regla), true);
  is('el viewport trae viewport-fit=cover (sin eso env() vale 0)', /viewport-fit=cover/.test(css.viewport), true);

  // (b) la clase del problema: con lista larga, ¿se llega al último renglón?
  const r = await page.evaluate(async () => {
    const out = {};
    DB.ordenes = [];
    for (let i = 1; i <= 30; i++) {
      DB.ordenes.push({ id: 'RO-' + i, fecha: new Date().toISOString(), cliente: 'Cliente ' + i,
        tel: '', vehiculo: { make: 'Honda', model: 'Civic', year: 2015 }, servicios: [], denegados: [],
        total: 100 + i, estado: 'pagado', insp: {}, abonado: 100 + i });
    }
    localStorage.setItem('sf_v1', JSON.stringify(DB)); _lastGood = censo(DB);
    go('ordenes'); try { renderOrdenes(); } catch (e) { out.err = e.message; }
    await new Promise(r => setTimeout(r, 600));

    const pg = document.getElementById('ordenes');
    out.pgAlto = Math.round(pg.getBoundingClientRect().height);
    out.ventanaAlto = window.innerHeight;
    // el contenedor que scrollea dentro de la pantalla
    const sc = [...pg.querySelectorAll('*')].find(e => {
      const s = getComputedStyle(e);
      return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 5;
    });
    if (!sc) { out.sinScroller = true; return out; }
    sc.scrollTop = sc.scrollHeight;                 // hasta el final
    await new Promise(r => setTimeout(r, 400));
    out.llegoAlFinal = Math.abs(sc.scrollTop + sc.clientHeight - sc.scrollHeight) < 3;
    // ¿el último renglón queda COMPLETO dentro de la ventana?
    const filas = sc.querySelectorAll('.card, [onclick*="openRODetail"]');
    const ult = filas[filas.length - 1];
    if (ult) {
      const rct = ult.getBoundingClientRect();
      out.ultimoAbajo = Math.round(rct.bottom);
      out.ultimoVisible = rct.bottom <= window.innerHeight + 1 && rct.top < window.innerHeight;
    }
    return out;
  });

  console.log('-- la clase del bug: llegar al final con la pantalla bajita --');
  is('la pantalla no es más alta que la ventana', r.pgAlto <= r.ventanaAlto, true);
  ok('   alto de .pg vs ventana', r.pgAlto + ' vs ' + r.ventanaAlto);
  is('el contenedor llega hasta el final del scroll', r.llegoAlFinal, true);
  is('🐛 el último renglón queda completo dentro de la pantalla', r.ultimoVisible, true);
  ok('   borde de abajo del último renglón', r.ultimoAbajo + 'px (ventana: ' + r.ventanaAlto + 'px)');

  is('sin errores de JavaScript', errs.length, 0, errs);

  await browser.close();
  console.log('\n' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();
