// SE TIENE QUE PODER LLEGAR HASTA ABAJO TAMBIÉN CON LAS LETRAS GRANDES.
// Bug reportado por Roberto el 12-ago-2026: "cuando pongo las letras grandes no puedo ver la
// pantalla completa si le doy hacia abajo".
//
// Es primo del bug del 31-jul (llegar-hasta-abajo.js) pero por otra causa. Aquel era `100vh`
// contra la barra de Safari. Este es de UNIDADES: la app declara `html{font-size:14px}` y luego
// reserva el hueco de la barra de acciones con `.pan{padding-bottom:80px}`, un número fijo en
// píxeles. Cuando el usuario sube el tamaño de letra del sistema, la barra de abajo (`.act`,
// que es sticky) crece porque su contenido crece, pero el hueco reservado NO crece con ella.
// A partir de cierto tamaño la barra tapa el final del panel y no hay forma de llegar: los
// botones y los últimos campos quedan debajo de ella.
//
// Se prueba la CLASE del problema, midiendo el DOM real a varios tamaños de letra:
// el último elemento del panel tiene que quedar por ENCIMA del borde superior de la barra.
//
// Usage:  python -m http.server 8931   (raíz del repo) + node letras-grandes.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

(async () => {
  const browser = await chromium.launch();
  // Un teléfono de verdad, que es donde él la usa.
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // Entrar al asistente y pararse en un paso con barra de acciones abajo.
  await page.evaluate(() => { go('ro'); gotoStep(0); });
  await page.waitForTimeout(300);

  // CÓMO SE SIMULA DE VERDAD. El escalado de texto de Android (Ajustes → Accesibilidad → Tamaño
  // del texto) NO cambia el font-size raíz: multiplica el tamaño YA CALCULADO de cada elemento,
  // y deja los padding y margin en px intactos. Por eso subir `html{font-size}` no reproduce
  // nada aquí — la app declara `body{font-size:14px}` y todo lo de adentro está en px, así que
  // la raíz no manda. Se recorre el DOM y se multiplica cada font-size, que es lo que pasa
  // en su teléfono.
  async function medir(factor) {
    return await page.evaluate((factor) => {
      document.querySelectorAll('*').forEach(function (el) {
        if (!el._fsBase) el._fsBase = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (el._fsBase) el.style.fontSize = (el._fsBase * factor) + 'px';
      });
      const pan = document.querySelector('.pan.active');
      const act = document.getElementById('ro-nav');
      if (!pan || !act) return { err: 'no encontré panel o barra' };
      const wrap = document.getElementById('ro-panes-wrap');
      wrap.scrollTop = wrap.scrollHeight;           // hasta abajo del todo
      const hijos = pan.children;
      const ultimo = hijos[hijos.length - 1];
      const r = ultimo.getBoundingClientRect();
      const a = act.getBoundingClientRect();
      return {
        finalDelPanel: Math.round(r.bottom),
        topeDeLaBarra: Math.round(a.top),
        alturaBarra: Math.round(a.height),
        tapado: Math.round(r.bottom - a.top)        // >0 = queda debajo de la barra
      };
    }, factor);
  }

  // 1.0 normal · 1.3 "grande" de Android · 1.6 "muy grande" · 2.0 el tope de accesibilidad
  for (const f of [1.0, 1.3, 1.6, 2.0]) {
    const m = await medir(f);
    if (m.err) { no('medición a ' + f + 'x', m); continue; }
    if (m.tapado <= 0) ok('a ' + f + 'x de letra se llega al final del panel', m);
    else no('a ' + f + 'x de letra el final del panel queda TAPADO por la barra', m);
  }

  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(function (el) { el.style.fontSize = ''; });
  });

  if (errs.length) no('errores de JS en consola', errs); else ok('sin errores de JS');
  console.log('\n' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
