// LO QUE LA APP LE ESCRIBE A SUS CLIENTES — el guardian de su reputacion.
// ---------------------------------------------------------------------------
// Roberto, 29-jul, despues de cazar un mensaje que le salio a una clienta:
//   "hoy le escribiste a mi clienta que me lo dijera en la cara, que horrible, eso no puede pasar"
//   "yo nunca te he dicho algo asi a ti. dimelo en la cara ESTA PROHIBIDO, es una falta de respeto
//    y todo lo que sea similar a esto NO VA NUNCA"
//   "un error de dinero o lo que sea cuesta reputacion tambien, y un cliente que deje un mal review
//    es horrendo"
//
// El mensaje culpable era el seguimiento automatico: "Si nota algo raro, aviseme" y, en el que
// vio la clienta, "Si algo no te gusto me avisas". Eso le SIEMBRA al cliente la idea de que algo
// pudo salir mal justo cuando quedo contento, y le sale a TODOS los clientes automaticamente.
//
// Esta prueba renderiza CADA mensaje que la app le manda a un cliente y lo revisa. No es una
// prueba de estilo: un mal review por un mensaje torpe le cuesta meses de trabajo.
// Usage:  python -m http.server 8931  (raiz del repo) + node mensajes-al-cliente.js
const { chromium } = require('playwright');
const BASE = process.env.SHOPFLOW_URL || 'http://localhost:8931/index.html';
let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log('[PASS] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const no = (n, d) => { fail++; console.log('[FAIL] ' + n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const yes = (n, got, d) => (got ? ok(n, d) : no(n, d !== undefined ? d : got));
const ev = (pg, code) => pg.evaluate('(async()=>{' + code + '})()');

// 🚫 PROHIBIDO — le siembra al cliente que algo pudo salir mal, o suena a reclamo.
const PROHIBIDO = [
  [/en la cara/i,                       'suena a confrontacion'],
  [/d[ií]melo de frente|d[ií]gamelo de frente/i, 'suena a reclamo'],
  [/si algo no te gust|si algo no le gust/i,     'siembra que algo salio mal'],
  [/si nota algo raro|si algo anda mal|si algo sale mal/i, 'siembra que algo salio mal'],
  [/alguna queja|si tiene queja|reclamo/i,       'invita al reclamo'],
  [/si no qued[oó] (contento|conforme|satisfech)/i, 'siembra insatisfaccion'],
  // OJO: "si todo quedo bien y esta satisfecho, me ayudaria un review" SI va — es su propio texto
  // y enmarca en positivo. Lo prohibido es la version que invita a la queja o que va SOLA,
  // condicionando el agradecimiento ("y si quedaste contenta, ...") sin nada positivo delante.
  [/^(?!.*todo qued[oó] bien).*y si qued(aste|[oó]) (content|conform|satisfech)/is, 'condiciona el agradecimiento sin enmarcarlo en positivo'],
  [/inconform/i,                        'siembra insatisfaccion'],
  [/disculpe la molestia|perdone la molestia/i,  'se disculpa sin razon'],
  [/no me falle|no me quede mal/i,      'presiona al cliente'],
];
// 🚫 ARROGANCIA — regla suya del 29-jul: humildes, nunca por encima de nadie.
const ARROGANTE = [
  [/el mejor|los mejores|el [uú]nico|la [uú]nica/i, 'superlativo'],
  [/mal rato en (un|otro) taller|otros talleres/i,  'insinua que otros lo hacen mal'],
  [/a diferencia de/i,                              'se compara'],
  [/garantizado 100|100% garantizado/i,             'promesa absoluta'],
  [/soy experto|somos expertos/i,                   'se alaba'],
];
// 🚫 BASURA TECNICA que nunca puede llegarle a un cliente.
const BASURA = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /Invalid Date/, /\bnull\b/];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { await d.accept(); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // Una orden y un cliente completos, para que ningun mensaje salga con campos vacios.
  const mensajes = await ev(page, `
    DB.settings.shopName='Pit Stop';
    DB.settings.shopPhone='787-454-6513';
    DB.settings.ath='787-454-6513';
    DB.settings.reviewLink='https://www.facebook.com/61591704942839/reviews/';
    var hoy=new Date();
    var o={id:'RO-9',cliente:'Amanda Ortiz',tel:'787-555-1212',estado:'pendiente',
      fecha:new Date(Date.now()-5*86400000).toISOString(),
      vehiculo:{year:'2020',make:'Kia',model:'Soul',tag:'ABC-123'},
      servicios:[{n:'Cambio de aceite sintético',ep:140,qty:1,laborHours:0,
        parts:[{name:'Batería Duralast',partNum:'35-DLG',supplier:'AutoZone',cost:129,sellPrice:185,qty:1,receipt:'ADV-1',date:localDateStr(),warrantyMonths:60}]}],
      denegados:[{nombre:'Pastillas de freno delanteras',precio:139}],
      insp:{},fotos:[],nextDate:localDateStr(new Date(Date.now()+30*86400000)),abonado:100};
    recalcROTotal(o);
    DB.ordenes=[o];
    DB.clientes=[{id:'CLI-9',nombre:'Amanda Ortiz',tel:'787-555-1212',vehiculos:[{tag:'ABC-123',desc:'2020 Kia Soul'}],creado:'2025-01-01T10:00:00.000Z'}];
    DB.citas=[{id:'CT-9',cliente:'Amanda Ortiz',tel:'787-555-1212',fecha:localDateStr(),hora:'09:00',
               servicio:'Cambio de aceite',vehiculo:'2020 Kia Soul',direccion:'Bayamón',estado:'agendada'}];
    saveDB({force:true});

    // Se intercepta waSend para capturar el texto sin abrir WhatsApp.
    var capt=[]; var _s=window.waSend;
    window.waSend=function(tel,texto){ capt.push({texto:texto}); };
    var _open=window.open; window.open=function(){return null;};

    function probar(nombre,fn){ var antes=capt.length; try{ fn(); }catch(e){ capt.push({texto:'EXCEPCION: '+e.message}); }
      for(var i=antes;i<capt.length;i++) capt[i].de=nombre; }

    probar('seguimiento después del servicio', function(){ waFollowUp('RO-9'); });
    probar('pedir reseña',                     function(){ waReview('RO-9'); });
    probar('recordatorio de mantenimiento',    function(){ waRemind('RO-9'); });
    probar('el carro está listo',              function(){ waListo('RO-9',false); });
    probar('cobrar el balance',                function(){ waCobro('RO-9'); });
    probar('confirmar la cita',                function(){ waCita('CT-9'); });
    probar('win-back (6+ meses)',              function(){ waWinback('CLI-9'); });
    probar('garantía por vencer',              function(){ waGarantia('RO-9','Batería Duralast'); });
    probar('trabajos recomendados pendientes', function(){ if(window.waDenegados) waDenegados('RO-9'); });
    probar('recordatorio de cita de mañana',   function(){ if(window.waCitaManana) waCitaManana('CT-9'); });
    probar('resumen de la inspección',         function(){ if(window.waDVI) waDVI('RO-9'); });

    window.waSend=_s; window.open=_open;
    return capt;`);

  yes('Se capturaron los mensajes que la app le manda al cliente', mensajes.length >= 8, mensajes.length);

  let sucios = 0;
  mensajes.forEach(m => {
    const t = m.texto || '';
    if (/^EXCEPCION/.test(t)) { no('"' + m.de + '" revienta al generarse', t); return; }
    PROHIBIDO.forEach(([rx, por]) => { if (rx.test(t)) { no('🚫 "' + m.de + '" ' + por, t.slice(0, 180)); sucios++; } });
    ARROGANTE.forEach(([rx, por]) => { if (rx.test(t)) { no('🚫 "' + m.de + '" ' + por, t.slice(0, 180)); sucios++; } });
    BASURA.forEach(rx => { if (rx.test(t)) { no('🚫 "' + m.de + '" tiene basura técnica', t.slice(0, 180)); sucios++; } });
  });
  yes('⭐ NINGÚN mensaje le siembra al cliente que algo pudo salir mal', sucios === 0, sucios);

  // Su firma: que suenen a él, no a una plantilla generica
  const conSaludo  = mensajes.filter(m => /^Saludos/.test(m.texto || '')).length;
  const conCierre  = mensajes.filter(m => /Quedo al pendiente/.test(m.texto || '')).length;
  const conBandera = mensajes.filter(m => /🏁/.test(m.texto || '')).length;
  yes('Suenan a él: abren con "Saludos"', conSaludo >= mensajes.length - 2, conSaludo + '/' + mensajes.length);
  yes('Y cierran con "Quedo al pendiente"', conCierre >= mensajes.length - 2, conCierre + '/' + mensajes.length);
  yes('Con su bandera 🏁', conBandera >= mensajes.length - 2, conBandera + '/' + mensajes.length);

  // Que traten al cliente por su nombre y digan el carro bien
  const sinNombre = mensajes.filter(m => !/Amanda/.test(m.texto || ''));
  yes('Todos llaman al cliente por su nombre', sinNombre.length === 0, sinNombre.map(m => m.de));

  console.log('\n  ── lo que le llega al cliente ──');
  mensajes.forEach(m => console.log('  · ' + m.de + ': ' + String(m.texto).split('\n').filter(Boolean)[1] || ''));

  yes('Sin errores de JavaScript', errs.length === 0, errs);

  console.log('\nMENSAJES AL CLIENTE — ' + pass + ' pass / ' + fail + ' fail');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
