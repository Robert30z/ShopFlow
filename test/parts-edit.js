// ShopFlow — prueba de EDITAR una pieza ya ingresada (arreglar typo sin duplicar).
const { chromium } = require('playwright');
const BASE = 'http://localhost:8931/index.html';
let fail = 0;
const ok = (c, n, d) => { console.log(`[${c?'PASS':'FAIL'}] ${n}${d?' — '+d:''}`); if(!c) fail++; };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({viewport:{width:390,height:844}})).newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message.slice(0,200)));
  page.on('dialog', async d=>{ await d.accept().catch(()=>{}); });
  await page.goto(BASE,{waitUntil:'load'}); await page.waitForTimeout(1000);

  // preparar una orden con un servicio y abrir el modal de piezas
  await page.evaluate(()=>{
    RO={servicios:[{id:'svc1',uid:'u1',n:'Frenos delanteros',p:139,qty:1,ep:139,parts:[],laborHours:0}], fotos:[]};
    openPartsModalRO(0);
  });

  // 1) agregar una pieza CON UN TYPO en el nombre
  const add = await page.evaluate(()=>{
    document.getElementById('pp-name').value='Pastias Brembo'; // typo a propósito
    document.getElementById('pp-cost').value='45';
    document.getElementById('pp-sell').value='70';
    document.getElementById('pp-qty').value='1';
    savePart();
    return { n: RO.servicios[0].parts.length, name: RO.servicios[0].parts[0].name };
  });
  ok(add.n===1 && add.name==='Pastias Brembo', 'Pieza agregada (con typo)', JSON.stringify(add));

  // 2) darle EDITAR → el form se llena y el botón cambia a Actualizar
  const edit = await page.evaluate(()=>{
    editPartRO(0);
    return { formName: document.getElementById('pp-name').value, formCost: document.getElementById('pp-cost').value,
             btn: document.getElementById('pm-save-btn').innerText.trim(), idx: _editPartIdx };
  });
  ok(edit.formName==='Pastias Brembo' && edit.formCost==='45', 'Editar llena el form con la pieza', JSON.stringify(edit));
  ok(/Actualizar/i.test(edit.btn) && edit.idx===0, 'Botón cambia a "Actualizar" en modo edición', JSON.stringify(edit));

  // 3) arreglar el typo + cambiar precio y guardar → NO duplica, actualiza
  const upd = await page.evaluate(()=>{
    document.getElementById('pp-name').value='Pastillas Brembo'; // typo arreglado
    document.getElementById('pp-sell').value='80';
    savePart();
    var p=RO.servicios[0].parts;
    return { n:p.length, name:p[0] && p[0].name, sell:p[0] && p[0].sellPrice, idx:_editPartIdx,
             btn: document.getElementById('pm-save-btn').innerText.trim() };
  });
  ok(upd.n===1, 'NO se duplicó — sigue habiendo 1 pieza', JSON.stringify(upd));
  ok(upd.name==='Pastillas Brembo' && upd.sell===80, 'La pieza se ACTUALIZÓ (nombre + precio)', JSON.stringify(upd));
  ok(upd.idx===-1 && /Agregar/i.test(upd.btn), 'Modo edición se resetea tras guardar', JSON.stringify(upd));

  ok(errors.length===0, 'Sin errores de página', errors.join(' | '));
  await browser.close();
  console.log(fail? `\n=== ${fail} FALLO(S) ===` : '\n=== EDITAR PIEZA: TODO VERDE ===');
  process.exit(fail?1:0);
})();
