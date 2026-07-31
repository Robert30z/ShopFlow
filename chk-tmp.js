const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('dialog', d => d.accept());
  await p.goto('http://localhost:8931/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  const r = await p.evaluate(() => {
    const monto = 200;
    const o = { id:'ING-TEST', fecha:new Date().toISOString(), cliente:'Trabajito en efectivo', tel:'',
      vehiculo:{}, servicios:[{id:'m',n:'Trabajito en efectivo',p:monto,qty:1,ep:monto}],
      total:monto, pago:'Cash', estado:'pagado', insp:{}, denegados:[], sinIVU:true, manual:true };
    const d = dineroRO(o);
    const tot=o.total||0, subCSV=o.sinIVU?tot:tot/1.115, ivuCSV=tot-subCSV;
    return { guardado:o.total, dineroRO_total:d.total, dineroRO_ivu:d.ivu, dineroRO_base:d.base,
             csv_sub:+subCSV.toFixed(2), csv_ivu:+ivuCSV.toFixed(2), csv_total:tot };
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close();
})();
