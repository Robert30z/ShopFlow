// APROBACIÓN REMOTA DEL ESTIMADO — el cliente aprueba DESDE EL LINK.
// ---------------------------------------------------------------------------
// Lo que protege esta prueba (28-jul):
//  1. El token se RENUEVA si el presupuesto cambia. Si no, aprobar $500 valdría como haber
//     aprobado $900: mandas el link, el cliente aprueba, tú le añades trabajo, y el expediente
//     diría que aprobó el total nuevo. Eso es justo lo contrario de lo que esta pieza existe
//     para hacer.
//  2. Una decisión que llega para un token VIEJO no se aplica (el link ya se renovó).
//  3. Si la puerta anónima no está puesta o no hay señal, el cliente NO se queda colgado:
//     la página cae al WhatsApp de siempre y **no le dice "aprobado"** cuando no se registró.
//  4. La aprobación entra sola, deja bitácora y NO se aplica dos veces (dos pulls seguidos).
//  5. Rechazo = aviso rojo en la orden, no silencio.
// Se prueba con un cliente Supabase FALSO: la tabla real todavía no existe (hay que pegar
// supabase/aprobaciones.sql una vez), y el valor está en que los caminos de la app aguanten
// tanto la respuesta buena como la mala.
// Usage:  python -m http.server 8931   (raíz del repo) + node aprobacion-remota.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const is = (n, got, exp) => (JSON.stringify(got) === JSON.stringify(exp) ? ok(n, got) : no(n, { got, exp }));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));

// El cliente Supabase falso vive dentro de la página (string) para poder inyectarlo antes de cada caso.
const FAKE = `
window._fake = { filas: [], upserts: [], marcados: [], rpc: null, rpcErr: null, err: null };
window.sbReady = function(){
  function chain(res){
    const o = {};
    ['select','eq','is','not','limit','in','order'].forEach(m => o[m] = () => o);
    o.then = (r, j) => Promise.resolve(res).then(r, j);
    return o;
  }
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'uid-1' } } } }) },
    from: () => ({
      select: () => chain({ data: window._fake.filas, error: window._fake.err }),
      upsert: async (row) => { window._fake.upserts.push(row); return { error: window._fake.err }; },
      // .in(...) = marcar aprobaciones aplicadas · .eq(...).select(...) = el push normal de shops
      update: (patch) => ({
        in: async (col, vals) => { window._fake.marcados = vals; return { error: null }; },
        eq: () => ({ select: async () => ({ data: [{ rev: 1 }], error: null }) })
      })
    }),
    rpc: async (fn, args) => { window._fake.ultimaRpc = { fn, args };
      return window._fake.rpcErr ? { error: window._fake.rpcErr } : { data: window._fake.rpc }; },
    channel: () => ({ on: function(){ return this; }, subscribe: function(){ return this; } }),
    removeChannel: () => {}
  };
};`;

const SEMILLA = `
  DB.ordenes = [{
    id: 'RO-900', fecha: new Date().toISOString(), cliente: 'Migdalia Cotto', tel: '7871234567',
    vehiculo: { year: 2020, make: 'Kia', model: 'Forte', tag: 'JLJ712' },
    servicios: [{ id: 's1', n: 'Frenos delanteros', p: 139, ep: 139, qty: 1, parts: [], laborHours: 0 }],
    denegados: [], insp: {}, fotos: [], total: 154.99, estado: 'pendiente', abonado: 0, pagos: []
  }];
  DB.settings.shopPhone = '7875550000';
  saveDB({ force: true });`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();          // contexto limpio = "incógnito"
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // ---------- 1. EL TOKEN SE RENUEVA CUANDO EL PRESUPUESTO CAMBIA ----------
  const tok = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = null;
    const o = DB.ordenes[0];
    const t1 = aprobTokenDe(o);
    const t2 = aprobTokenDe(o);                                  // sin cambios: el MISMO
    o.servicios.push({ id: 's2', n: 'Alternador', p: 450, ep: 450, qty: 1, parts: [], laborHours: 0 });
    o.total = 656.99;
    const t3 = aprobTokenDe(o);                                  // subió el precio: OTRO
    return { largo: t1.length, hex: /^[0-9a-f]+$/.test(t1), estable: t1 === t2, renovado: t1 !== t3 };
  `);
  is('El token es de 128 bits en hex', { largo: tok.largo, hex: tok.hex }, { largo: 32, hex: true });
  yes('Mismo presupuesto = mismo token (el link no se invalida solo)', tok.estable);
  yes('⭐ Subió el precio = token NUEVO (aprobar $154 no vale por $656)', tok.renovado);

  // ---------- 2. shareStatus mete el token en el link y publica la fila ----------
  const link = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = null;
    const abiertos = []; window.open = (u) => { abiertos.push(u); return { focus(){} }; };
    shareStatus('RO-900');
    return new Promise(r => setTimeout(() => {
      const u = abiertos[0] || '';
      const hash = decodeURIComponent(u).split('#s=')[1] || '';
      let snap = {}; try { snap = JSON.parse(decodeURIComponent(escape(atob(hash)))); } catch(e) {}
      r({ tk: snap.tk || '', guardado: (DB.ordenes[0] || {}).aprobTok || '',
          fila: window._fake.upserts[0] || null, puerta: APROB_PUERTA });
    }, 300));
  `);
  yes('El link del cliente lleva el token', !!link.tk, link.tk.slice(0, 8) + '…');
  is('El token quedó guardado en la orden (si no, la aprobación no encuentra dueño)', link.guardado, link.tk);
  is('La fila publicada trae orden, total y huella', link.fila && {
    ro: link.fila.ro, total: link.fila.total, tieneFp: !!link.fila.fp, owner: link.fila.owner
  }, { ro: 'RO-900', total: 154.99, tieneFp: true, owner: 'uid-1' });
  is('La puerta quedó marcada como viva', link.puerta, true);

  // ---------- 3. SIN PUERTA (falta el SQL): el link sale sin token, no roto ----------
  const sinPuerta = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = false;
    const abiertos = []; window.open = (u) => { abiertos.push(u); return { focus(){} }; };
    shareStatus('RO-900');
    const u = decodeURIComponent(abiertos[0] || ''); const hash = u.split('#s=')[1] || '';
    let snap = {}; try { snap = JSON.parse(decodeURIComponent(escape(atob(hash)))); } catch(e) {}
    return { tieneTk: !!snap.tk, tieneTotal: snap.tot };
  `);
  is('⭐ Sin la puerta puesta el link va SIN token (y sigue funcionando)', sinPuerta, { tieneTk: false, tieneTotal: 154.99 });

  // ---------- 4. LA DECISIÓN DEL CLIENTE ENTRA SOLA ----------
  const entra = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = true;
    const o = DB.ordenes[0]; o.aprobTok = 'a'.repeat(32); o.aprobTokFp = fpFactura(o); saveDB({force:true});
    window._fake.filas = [{ token: 'a'.repeat(32), ro: 'RO-900', total: 154.99, fp: o.aprobTokFp,
      decision: 'aprobado', decidido_at: '2026-07-28T14:03:00Z', nombre: 'Migdalia Cotto', nota: '', ip: '72.44.1.9' }];
    await aprobPull();
    const a = DB.ordenes[0].aprob || {};
    const bits = (DB.bitacora || []).filter(b => b.tipo === 'estimado-aprobado');
    const marcadosPrimera = window._fake.marcados.slice();
    await aprobPull();                                   // otra vez: NO puede duplicar
    const bits2 = (DB.bitacora || []).filter(b => b.tipo === 'estimado-aprobado');
    return { total: a.total, canal: a.canal, remota: !!a.remota, nombre: a.nombre, ip: a.ip,
             ts: a.ts, bitacora: bits.length, bitacora2: bits2.length,
             marcado: marcadosPrimera, desfasada: aprobDesfasada(DB.ordenes[0]) };
  `);
  is('Entró la aprobación con su monto y su vía', { total: entra.total, canal: entra.canal, remota: entra.remota }, { total: 154.99, canal: 'link del cliente', remota: true });
  is('Guarda quién y desde dónde (evidencia, no nota del taller)', { n: entra.nombre, ip: entra.ip }, { n: 'Migdalia Cotto', ip: '72.44.1.9' });
  is('La hora es la del SERVIDOR, no la del iPad', entra.ts, '2026-07-28T14:03:00Z');
  is('Queda en la bitácora una sola vez (dos pulls seguidos)', { uno: entra.bitacora, dos: entra.bitacora2 }, { uno: 1, dos: 1 });
  is('La fila se marca como aplicada (no vuelve a bajar)', entra.marcado, ['a'.repeat(32)]);
  is('Con la orden intacta NO sale el aviso de desfase', entra.desfasada, false);

  // ---------- 5. DECISIÓN DE UN LINK VIEJO: NO se aplica ----------
  const viejo = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = true;
    const o = DB.ordenes[0]; o.aprobTok = 'b'.repeat(32); o.aprobTokFp = fpFactura(o); saveDB({force:true});
    window._fake.filas = [{ token: 'c'.repeat(32), ro: 'RO-900', total: 89, fp: 'viejo',
      decision: 'aprobado', decidido_at: '2026-07-28T14:03:00Z', nombre: 'X', nota: '', ip: '1.1.1.1' }];
    await aprobPull();
    return { aprob: !!DB.ordenes[0].aprob, marcados: window._fake.marcados.length };
  `);
  is('⭐ Una aprobación de un link ya renovado NO se cuela', { aprob: viejo.aprob, marcados: viejo.marcados }, { aprob: false, marcados: 0 });

  // ---------- 6. EL TRABAJO CRECE DESPUÉS DE APROBAR: la orden avisa ----------
  const crecio = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = true;
    const o = DB.ordenes[0]; o.aprobTok = 'd'.repeat(32); o.aprobTokFp = fpFactura(o); saveDB({force:true});
    window._fake.filas = [{ token: 'd'.repeat(32), ro: 'RO-900', total: 154.99, fp: o.aprobTokFp,
      decision: 'aprobado', decidido_at: '2026-07-28T14:03:00Z', nombre: 'Migdalia', nota: '', ip: '' }];
    await aprobPull();
    DB.ordenes[0].servicios.push({ id: 's9', n: 'Cambio de bomba', p: 400, ep: 400, qty: 1, parts: [], laborHours: 0 });
    DB.ordenes[0].total = 600; saveDB({ force: true });
    openRODetail('RO-900');
    const t = document.getElementById('ro-detail-body').innerText;
    return { desfasada: aprobDesfasada(DB.ordenes[0]), aviso: /cambió después de que aprobó/i.test(t),
             montoViejo: /154\\.99/.test(t) };
  `);
  is('⭐ Si el trabajo crece después, la orden lo grita', crecio, { desfasada: true, aviso: true, montoViejo: true });

  // ---------- 7. RECHAZO: aviso rojo, no silencio ----------
  const rech = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = true;
    const o = DB.ordenes[0]; o.aprobTok = 'e'.repeat(32); o.aprobTokFp = fpFactura(o); saveDB({force:true});
    window._fake.filas = [{ token: 'e'.repeat(32), ro: 'RO-900', total: 154.99, fp: o.aprobTokFp,
      decision: 'rechazado', decidido_at: '2026-07-28T15:00:00Z', nombre: 'Migdalia', nota: 'muy caro', ip: '' }];
    await aprobPull();
    openRODetail('RO-900');
    const t = document.getElementById('ro-detail-body').innerText;
    return { rech: !!DB.ordenes[0].aprobRech, aviso: /NO APROBÓ/i.test(t), nota: /muy caro/.test(t),
             sigueBoton: /aprobó el estimado/i.test(t) };
  `);
  is('El "no lo apruebo" sale en rojo en la orden', { rech: rech.rech, aviso: rech.aviso, nota: rech.nota }, { rech: true, aviso: true, nota: true });
  yes('Y el taller todavía puede registrarlo a mano si después dice que sí', rech.sigueBoton);

  // ---------- 8. LA PÁGINA DEL CLIENTE: aprobar con un toque ----------
  const p2 = await ctx.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  const snap = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = null;
    const abiertos = []; window.open = (u) => { abiertos.push(u); return { focus(){} }; };
    shareStatus('RO-900');
    return new Promise(r => setTimeout(() => r(decodeURIComponent(abiertos[0]||'').split('#s=')[1]||''), 300));
  `);
  await p2.goto(BASE + '#s=' + snap, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const cli = await ev(p2, FAKE + `
    return { hayCaja: !!document.getElementById('apr-box'), hayBtn: !!document.getElementById('apr-btn'),
             nombre: (document.getElementById('apr-nom')||{}).value, texto: document.body.innerText.slice(0, 1200) };
  `);
  yes('El cliente ve la caja de autorización', cli.hayCaja);
  yes('Con su nombre ya puesto', cli.nombre && cli.nombre.length > 0, cli.nombre);
  yes('Y el total a autorizar a la vista', /154\.99/.test(cli.texto));

  const aprobado = await ev(p2, `
    window._fake.rpc = { ok: true, decision: 'aprobado', decidido_at: '2026-07-28T14:03:00Z', total: 154.99, nombre: 'Migdalia Cotto' };
    await aprobDesdeLink('aprobado');
    return { txt: document.getElementById('apr-box').innerText, args: window._fake.ultimaRpc };
  `);
  yes('Al tocar "Apruebo" le sale el sello con fecha', /Trabajo aprobado/i.test(aprobado.txt) && /14 de|02:03|2:03|jul/i.test(aprobado.txt), aprobado.txt.replace(/\n/g, ' | '));
  is('Y se manda con el token y la decisión correctos', { fn: aprobado.args.fn, dec: aprobado.args.args.p_decision, tok: aprobado.args.args.p_token.length }, { fn: 'aprob_registrar', dec: 'aprobado', tok: 32 });

  // ---------- 9. SIN SEÑAL: no le miente al cliente ----------
  await p2.goto('about:blank');
  await p2.goto(BASE + '#s=' + snap, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const caido = await ev(p2, FAKE + `
    window._fake.rpc = null; window._fake.rpcErr = { message: 'Failed to fetch' };
    await aprobDesdeLink('aprobado');
    const box = document.getElementById('apr-box');
    return { txt: box.innerText, dijoAprobado: /Trabajo aprobado/i.test(box.innerText),
             botonVivo: !document.getElementById('apr-btn').disabled,
             wa: (box.innerHTML.match(/wa\\.me[^"]*/) || [''])[0] };
  `);
  yes('⭐ Sin señal NO le dice "aprobado"', !caido.dijoAprobado);
  yes('Le explica y le da el WhatsApp con el mensaje listo', /No hubo señal/i.test(caido.txt) && /wa\.me/.test(caido.wa), caido.wa.slice(0, 60));
  yes('El botón queda vivo para reintentar', caido.botonVivo);

  // ---------- 10. LINK VENCIDO ----------
  await p2.goto('about:blank');
  await p2.goto(BASE + '#s=' + snap, { waitUntil: 'load' });
  await p2.waitForTimeout(900);
  const venc = await ev(p2, FAKE + `
    window._fake.rpc = { ok: false, err: 'vencido' };
    await aprobDesdeLink('aprobado');
    return document.getElementById('apr-box').innerText;
  `);
  yes('Link vencido: se lo dice claro', /venció/i.test(venc), venc.replace(/\n/g, ' | ').slice(0, 120));

  // ---------- 11. LA ORDEN PAGADA NO PIDE APROBACIÓN ----------
  const pagada = await ev(page, SEMILLA + FAKE + `
    _syncOn = true; APROB_PUERTA = true;
    DB.ordenes[0].estado = 'pagado'; saveDB({ force: true });
    const abiertos = []; window.open = (u) => { abiertos.push(u); return { focus(){} }; };
    shareStatus('RO-900');
    const hash = decodeURIComponent(abiertos[0]||'').split('#s=')[1] || '';
    let snap = {}; try { snap = JSON.parse(decodeURIComponent(escape(atob(hash)))); } catch(e) {}
    return !!snap.tk;
  `);
  is('Una orden ya pagada no le pide aprobar nada al cliente', pagada, false);

  is('Sin errores de JavaScript (app)', errs, []);
  is('Sin errores de JavaScript (página del cliente)', errs2, []);

  await browser.close();
  console.log('\n' + (fail ? `❌ ${fail} FALLOS de ${pass + fail}` : `TODO VERDE — ${pass} pass / 0 fail`));
  process.exit(fail ? 1 : 0);
})();
