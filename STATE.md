# ShopFlow — STATE

> Update this file at the end of every working session so the next session resumes instead of restarting.

## 🚦 CONTINUA AQUI — cierre del 2026-07-27 (sesion larga: batches 14, 15, 16, 17)

**Estado: TODO EN VIVO Y VERDE.** `live == repo`, SW **v16**, suite **21 archivos / 368 pruebas /
0 fallos** corridas en local Y contra `robert30z.github.io/ShopFlow`. Working tree limpio, todo
pusheado a `main`. Supabase REST/auth 200, los 4 CDN 200, respaldo GitHub al dia (commit de hoy
19:06, 23.5 KB, RO-2 Migdalia con sus 35 fotos, sellada).

**LO UNICO QUE LE TOCA A ROBERTO:**
1. Abrir ShopFlow en el **iPad y el iPhone** y **recargar 2 veces** (para que baje el SW v16).
2. **Rotar el PAT de Supabase y cambiar la contrasena** de esa cuenta (pendiente desde el 26-jul).

**Lo que se hizo hoy** (detalle completo abajo, batch por batch): 13 bugs encontrados sondeando la
app real + 4 funciones que faltaban (libro de pagos, aprobacion del estimado, aviso "carro listo",
fotos por punto de inspeccion). Los mas gordos: el P&L no cuadraba con el CSV del contable, el
boton "Restaurar desde la nube" no restauraba y mentia, el merge se comia un cobro cuando dos
equipos cobraban la misma orden, y **la app abierta dos veces en el mismo equipo borraba ordenes
en silencio**.

**QUEDA EXPUESTO (dicho de frente, no arreglado):**
- Los nombres de cliente se pintan crudos en varias pantallas: un `<` rompe el layout. Probado que
  NO hay XSS explotable con un solo usuario, pero un pase de escape general esta pendiente.
- El link `#s=` de una orden con 25 servicios pesa 3.2 KB; con ~40 reventaria wa.me.
- Sin permisos/roles (importa al emplear o al vender). IndexedDB no existe en navegacion privada.
- El flujo de sincronizacion entre dos equipos esta probado sintetico (mergeDB, conflictos, pagos),
  **no con dos aparatos reales en la mano**.

**LO SIGUIENTE QUE YO ATACARIA (en orden):**
1. **Que la aprobacion del cliente entre SOLA desde el link** (hoy Roberto la registra a mano
   cuando le llega el WhatsApp). Con Supabase se puede, pero hay que abrir una puerta anonima
   (RPC + rate limit + token por orden) y eso se disena, no se improvisa.
2. **Video de 15 seg** (ej. alternador moviendose). DISENO CRITICO: SOLO a Supabase Storage,
   **nunca al respaldo GitHub** (30s = 30-60 MB = revienta el respaldo; 1 GB ~ 20 videos).
3. Historial por vehiculo en pantalla + recordatorio de `nextDate` (ya se guarda, nadie lo persigue).
4. Escape general de texto del usuario en el HTML (lo de arriba).
5. Editar jobs personalizados y promos (bajo riesgo, no entran en cifras reportadas).

**COMO SE AUDITA ESTO** (no negociable, ver memoria `feedback-auditoria-bulletproof`): una
auditoria que termina en "todo verde" sin un hallazgo, fallo. Sondear la app REAL en el navegador,
no releer lo ya arreglado. Ejes: datos en vuelo · que los numeros cuadren entre pantallas · probar
el camino de recuperacion con el archivo de verdad · arreglar la CLASE, no la instancia · una
prueba por bug · reportar honesto lo que NO se reviso.

**Correr las pruebas:** `python -m http.server 8931` en la raiz del repo y `node <archivo>.js`
desde `test/`. Contra el sitio en vivo: `SHOPFLOW_URL="https://robert30z.github.io/ShopFlow/index.html" node smoke.js`.

## Last updated: 2026-07-27 (batches 16-17: libro de pagos, aprobacion, fotos por punto + 4 bugs)

## 2026-07-27 (batch 17): LA APP ABIERTA DOS VECES SE COMIA ORDENES (SW v16, 368 verdes)
Sonda creativa, escenarios que nadie habia probado. **Hallazgo grave:** la PWA instalada Y Safari
con ShopFlow abierto (o dos ventanas) se pisan. Pestana A crea una orden con firma y pago y
guarda (disco: 2 ordenes); pestana B, cargada antes, cambia el telefono en Ajustes y guarda =>
**disco con 1 orden, la de A desaparecida, sin aviso y con `saveDB` devolviendo exito**. El guard
no lo veia: compara contra su memoria, no contra el disco.
- **Fix:** `DB._rev` por escritura + `reconciliarDisco()` en `saveDB`: si el disco trae una
  revision que este contexto no escribio, se UNE con `mergeDB` (gana la edicion mas reciente,
  pagos y versiones se suman) y queda en la bitacora (`otra-pestana`).
- **Ajustes a tres bandas:** se parte de lo del disco y solo se pisa lo que ESTE contexto cambio
  desde que leyo. Sin eso, el ultimo en guardar borraba el ajuste del otro.
- **Trampa que cazo la prueba:** si la revision reconciliada no SUBE por encima de la del disco,
  la otra pestana cree que nadie escribio y vuelve a pisar (colision de numeros).
- Probado sin hallazgos: nombres/servicios con comillas, `< >`, emoji y HTML inyectado (5
  pantallas + detalle + PDF + link del cliente: aguanta todo, no ejecuta nada); orden con fecha
  futura por reloj mal puesto (P&L, CSV y cobro del dia siguen cuadrando entre si).

## 2026-07-27 (batch 16): LO QUE FALTABA + 3 bugs (SW v15, 359 verdes)
1. **LIBRO DE PAGOS** (`o.pagos[]`): `abonado` decia CUANTO pero nunca CUANDO ni COMO. "Cobrado
   hoy" contaba la orden entera el dia que se saldaba (abono del martes + resto del jueves = $88
   el jueves, $0 el martes) => imposible cuadrar caja o separar ATH de efectivo. Cada cobro deja
   renglon {fecha, monto, metodo, equipo}; el cierre del dia desglosa por metodo. Migracion
   automatica de lo viejo + backfill defensivo en `registrarPago` (una orden que llegue de un
   equipo con version vieja no pierde su abono al recalcular).
2. **APROBACION DEL ESTIMADO** (`o.aprob`): fecha, canal, monto y huella. Si el trabajo crece
   despues, la app avisa "aprobo $X, ahora $Y" en vez de asumir. La firma del papel cubre la
   inspeccion, no el precio final — este es el hueco legal que quedaba.
3. **AVISO "SU CARRO ESTA LISTO"** por WhatsApp (sale solo al marcar listo + boton en el garage).
4. **FOTOS POR PUNTO DE INSPECCION** (`o.inspFotos[item]`): la camara cambia de destino
   (`_camDest`), el DVI PDF trae "EVIDENCIA POR PUNTO REVISADO" con la foto pegada a su punto.
   **Clave:** las tuberias (migrar a IDB, subir a Storage, censo del guard) recorren TODAS las
   listas via `listasDeFotos(o)` — si no, habrian sido fotos de segunda, sin respaldo.
5. 🐛 **EL MERGE SE COMIA PLATA:** cobrar $50 en el iPad y $38 en el iPhone sobre la misma orden
   => el merge se quedaba con UNA version entera y **un cobro desaparecia**. Igual con las
   versiones congeladas de una factura reabierta. `unirAppendOnly` une por id. Por esto `abonado`
   SALIO de la huella de la factura (`fpFactura`): un pago que llega de otro equipo cambiaria la
   huella y bloquearia la app por un cambio legitimo. Las selladas de antes se validan con
   `fpFacturaLegacy`.
6. 🐛 **EL INVENTARIO MENTIA:** se descontaba al agregar pero no se devolvia al borrar ni se
   ajustaba al cambiar cantidad (`ajustarInventario`).
7. 🐛 **IVU FANTASMA:** todo ingreso manual se reportaba con IVU incluido ($200 en efectivo =>
   $20.63 a la planilla que nunca cobro). Ahora se pregunta (`sinIVU`).

## Last updated antes: 2026-07-27 (batch 15: auditoria parte 3 - el boton Restaurar estaba roto)

## 2026-07-27 (batch 15): AUDITORIA PARTE 3 - 4 bugs (SW v14, 317 pruebas verdes, live==repo)
Eje 3 del estandar (*probar el camino de recuperacion con el archivo de verdad*) + la superficie
que ve el CLIENTE.

1. **"Restaurar desde la nube" no restauraba.** `importBackup` se blindo el 26-jul; su hermana
   `restoreFromCloud` -- el boton que usaria si PIERDE el equipo -- quedo cruda. Medido: respaldo
   de antes del 24-jul (fotos base64 inline, **5.15 MB**) => todo a localStorage => "ALMACENAMIENTO
   LLENO", en disco **641 bytes**, y la app decia igual **"Datos restaurados desde la nube ✓"**.
   Ahora migra fotos a IndexedDB antes de guardar (5.15MB -> 2.2KB), sube las que falten, y no
   avisa de exito si el guardado fallo.
2. **Sin normalizar, restaurar dejaba la app inservible:** una lista corrompida en el respaldo =>
   excepciones en home, clientes, finanzas, garage y citas *justo despues de recuperar*. Fix de
   clase: **`normalizarDB(db)` para las TRES puertas** (loadDB, importBackup, restoreFromCloud).
3. **Contadores a 0 al importar/restaurar** => con RO-7 en el respaldo la proxima orden seria RO-1
   y **pisaria una existente** (`upsertRO` une por id). Ahora `_maxIdNum` los deriva del id mas
   alto, papelera incluida.
4. **La pagina del cliente (link `#s=`) no cuadraba.** Los renglones traian solo el precio base:
   "Frenos delanteros $139" con "TOTAL $407.53" abajo y **sin linea de IVU en ningun sitio** = se
   lee como cobro escondido. Y los recomendados salian todos como la palabra "Recomendado"
   (leia `d.n`; el campo real es `d.nombre`). Ahora renglon = servicio+labor+piezas y van aparte
   subtotal, descuento e IVU; los "revisar" automaticos sin confirmar no se le mandan.

**Verificacion con datos REALES:** su respaldo de la nube de hoy (23.5 KB, commit `bb6fe94`
27-jul 19:06) restaura completo -- RO-2 Migdalia $88.20 **sellada**, 35 fotos como referencia con
ruta de Storage, firma, 35 puntos de inspeccion, 4 denegados, garage `ready`, proxima orden RO-3,
23 KB en localStorage, las 8 pantallas renderizan, factura cuadra (88.88 - 9.78 desc + 9.10 IVU =
88.20). Supabase REST/auth 200, los 4 CDN 200.

**Pruebas nuevas:** `test/restaurar-nube.js` (14), `test/pagina-cliente.js` (13).
**Suite: 17 archivos, 317 verdes, 0 fallos**, local y en vivo.

## Last updated antes: 2026-07-27 (batch 14: auditoria parte 2 - dinero entre pantallas + candado usable)

## 2026-07-27 (batch 14): AUDITORIA PARTE 2 - 5 bugs nuevos (SW v13, 290 pruebas verdes, live==repo)
Continuacion de la auditoria de la manana. Metodo: sonda en navegador contra la app REAL (no
repasar lo ya arreglado). Los 5 salieron de dos ejes del estandar: **que los numeros cuadren entre
superficies** y **datos en vuelo**.

1. **El P&L no cuadraba con el CSV del contable.** `renderPL` era la UNICA superficie que contaba
   las ordenes ABIERTAS (el CSV, el reporte semanal, Equipo, el home y la linea de IVU si las
   excluyen). Medido: una orden abierta de $557.50 => "Ingresos brutos" $1,115.00 vs CSV $557.50, y
   la linea "de esto, IVU cobrado" justo debajo contradecia al numero de encima **en la misma
   tarjeta**. Arrastraba tambien margen, ticket promedio, conteo de ordenes y costo de piezas.
   Fix de clase: `esContable(o)` decide en un sitio.
2. **El "Por cobrar" del home cobraba de mas.** Sumaba el TOTAL de las pendientes ignorando los
   abonos. Cliente que abono $200 de $446: home $446, Cierre de hoy $246, detalle $246. Fix de
   clase: `balanceRO(o)` + `porCobrarTotal(lista)`, usados por home, Equipo, reporte semanal,
   flotas y el detalle. **Raiz: no existia UNA definicion de "lo que deben"; cada pantalla la
   reimplementaba.**
3. **El candado paralizaba la venta.** Con la factura sellada, "Cliente aprobo - mover a servicios"
   (el upsell de los denegados) mutaba la orden, el guard rechazaba y salia *"GUARDADO BLOQUEADO -
   se detecto una perdida de datos"*: aviso FALSO (no se perdio nada) y sin salida. Fix:
   `conFacturaEditable(roId,queHace,fn)` ofrece reabrir en el sitio (version congelada + motivo en
   bitacora) y sigue; `reabrirOrden` acepta `{motivo,callado}`. Ademas reabrir ya lleva a algun
   sitio: boton **"Corregir la orden en el asistente"** en toda orden no sellada (antes reabrir una
   pagada quitaba el sello y te dejaba mirando la misma pantalla).
4. **El candado casi nunca se enganchaba.** De los 4 caminos a PAGADO solo sellaban `markPaid` y
   `cobrarYCerrar`. El PRINCIPAL - terminar el asistente con estado Pagado - NO sellaba, ni
   `registrarAbono` al saldar. O sea: la proteccion legal del batch 12 no cubria el uso normal.
   Ahora sellan los cuatro.
5. **Los campos a medias de los MODALES seguian a la intemperie.** El arreglo de la manana cubre
   `.pg.v`; los dos formularios mas largos de la app (piezas de la orden - 8 campos - e inventario
   - 11) son modales fuera de `.pg`. Medido: 19 campos sin red. Escribir una pieza en el mostrador
   del suplidor + iOS mata Safari = todo en blanco. Fix: borrador de modal **con contexto**
   (`pp:ro:<orden>:<svcIdx>`, `pp:cat:<svcId>`, `inv:<id|nuevo>`) que solo se repone si se abre el
   MISMO formulario - reponer una pieza en el servicio equivocado seria peor que perderla. El
   contexto lo declara quien abre el modal (`abrirModalCtx`), no se adivina mirando overlays.

**Pruebas nuevas:** `test/dinero-cuadra.js` (10), `test/factura-editable.js` (19),
`test/campos-modal.js` (9) - incluye un check que falla si aparece cualquier campo de formulario
fuera de la red. **Suite: 15 archivos, 290 verdes, 0 fallos**, local y contra el sitio en vivo.

## Last updated antes: 2026-07-26 (batch 12: FUNDACION DE INTEGRIDAD + cobrar y cerrar)

## 2026-07-26 (batch 12): FUNDACION DE INTEGRIDAD - "no puedo perder info de un cliente"
Roberto: *"me estoy arriesgando a una demanda... realiza una inspeccion bien carbona, compara con otras
companias, que yo pueda dormir en paz"* + *"no quiero un patch, quiero una fundacion"*.
**Diagnostico de raiz:** el problema nunca fueron 4 bugs sueltos, era que **ningun sitio garantizaba la
integridad**. Todo pasa por `saveDB()`, que serializaba y empujaba sin preguntarse jamas "acabo de
perder algo?". Por eso cada bug nuevo costaba datos. **Ahora hay UN camino de escritura con garantias.**

### Las 4 reglas de la casa (`index.html`, bloque FUNDACION DE INTEGRIDAD)
1. **NADA SE DESTRUYE.** `deleteRO` borraba la orden + sus fotos de IndexedDB **Y DE LA NUBE** + el
   garage con UN `confirm()`, y sincronizaba el borron a Supabase y GitHub. **Un mis-tap destruia un
   expediente legal con firma y 35 fotos en todos los sitios a la vez.** Ahora va completo a
   `DB.papelera` (con su entrada de garage para devolverlo) y se restaura desde cualquier equipo; las
   fotos **se quedan**. Destruir de verdad (`purgarDePapelera`) exige **30 dias + doble confirmacion**
   y es el UNICO sitio de la app que borra bytes. `deletePhoto` tambien destruia la foto de la nube
   ANTES de guardar (si te arrepentias y cerrabas, la orden nombraba una foto inexistente); ya solo
   quita la referencia. `reconciliarPapelera()` evita que un borrado revida por `mergeDB` (une por id).
2. **TODO QUEDA ESCRITO.** `DB.bitacora` append-only (id, fecha, equipo, tipo, detalle), techo 4000.
   Rastro legal + herramienta de diagnostico. `bita()` NO guarda (evita recursion); el que llama guarda.
3. **`saveDB` VERIFICA ANTES DE ESCRIBIR.** `verificaIntegridad()` rechaza el guardado si: (1) un
   expediente desapareceria de la union activas+papelera, (2) una orden perderia fotos sin baja
   declarada, (3) bajarian las firmas, (4) **una factura sellada se estaria alterando**. Ataja bugs
   FUTUROS, que es lo que lo hace fundacion y no parche.
4. **COPIAS LOCALES.** Ultimas `SNAP_MAX=20` en IndexedDB **propia** (`shopflow_snaps`, aparte de la de
   fotos para no arriesgar lo que ya funciona), sin fotos ni secretos. Volver atras **sin red** - lo que
   no existia el 24-jul cuando localStorage quedo vacio. `restaurarSnapshot` guarda copia del estado
   actual ANTES de cambiar (deshacer el deshacer).

### DOS FALLOS DE DISENO PROPIOS que las pruebas encontraron (importantes)
- **(a) El guard bricheaba la app.** Al bloquear, la memoria se quedaba con el cambio malo -> memoria !=
  disco -> **TODOS los guardados siguientes se bloqueaban tambien.** Arreglado con
  `revertirAlUltimoBueno()`: rechaza Y deshace en el sitio. Probado explicitamente.
- **(b) Borrar una orden firmada era IMPOSIBLE.** El censo contaba firmas solo en `ordenes`, asi que
  mandar a la papelera una orden firmada se leia como "se perdio una firma". **El censo mide sobre la
  UNION `ordenes`+`papelera`** - eso es lo que significa "nada se destruye".

### CANDADO DE FACTURA (comparacion con la competencia)
Tekmetric documenta *Unpost Repair Order* y *How to Find and Restore a Deleted Repair Order* => el
estandar de la industria es **borrado recuperable + orden cerrada con candado**. ShopFlow ya tenia lo
primero; lo segundo faltaba y **era el punto debil legal**: una orden PAGADA se podia editar en
silencio. Ahora al cobrar se **sella** con la huella (`fpFactura` = cliente, vehiculo, servicios,
denegados, total, descuento, cortesia, pago, abonado) y **el guard hace cumplir el sello**.
`reabrirOrden` pide motivo, **congela la version cerrada completa en `o._versiones`** y lo anota. La
factura original nunca se pierde, solo se supera. Las pagadas de ANTES no se sellan solas (seria fingir
una garantia): boton `sellarAhora` para que Roberto las revise y las selle.

### PERDIDA SILENCIOSA CERRADA: la nube atrasada ya no pisa lo fresco
`mergeDB` construia el resultado desde `remote`, asi que para un id en los dos lados **la nube ganaba
SIEMPRE, incluso mas vieja** -> bajar datos podia borrar sin avisar una orden recien editada (caso iPad +
iPhone). Ahora gana la **edicion mas reciente**, y descartar una version queda en la bitacora
(`conflicto-resuelto`). Para eso hacia falta saber cuando cambio cada orden: en vez de sellar la hora en
las ~15 funciones que editan una orden (donde se te olvida una), **`marcarEditadas()` lo hace en
`saveDB`** comparando la huella de cada orden con la del ultimo estado bueno. Un solo sitio, ninguna sin
marcar. `aplicarRemoto()` unifica los 2 sitios que aplicaban data remota (unir -> reconciliar ->
refrescar censo): si el censo no se refresca, el guard compara contra un conteo viejo y **bloquea
trabajo bueno**.

### LO QUE PIDIO: "cobrar y cerrar" (y un bug de DINERO)
Una orden `abierta` solo ofrecia "Continuar orden" (reabrir el wizard de 9 pasos). Y **`abierta` se
excluye de TODAS las finanzas** (`o.estado!=='abierta'` en ventas, IVU, tecnico, asesor, por cobrar) =>
**trabajo cobrado que no aparecia en ningun numero.** `cobrarYCerrar()`: boton verde con el total, pago
completo o **abono parcial** (-> `pendiente` con balance), mueve el carro en el garage
(entregado/listo), sella la factura. Aviso en el home (`renderAbiertas`) con las abiertas, su **edad** y
el total sin cobrar.

### Ajustes -> Seguridad de datos
`verificarTodo()` **le pregunta a Supabase y a GitHub cuantas ordenes tienen y compara con el equipo**
(la pregunta que nadie hacia el 24-jul, cuando la app decia que todo bien y la nube llevaba 2 dias en 0),
+ fotos que viven solo en este equipo (`fotosSinSubir` + `subirFotosYa`), + estado de
`navigator.storage.persisted()` (Safari eviciona a los ~7 dias), + papelera / copias / bitacora.

### Verificacion
`test/fundacion.js` NUEVO (**54 checks**). Suites: smoke 89, diag 24, protect-banner 10, photos-idb 14,
parts-edit 7, import-fotos 21, fundacion 54 = **219 verdes, 0 fallos**. `smoke` actualizado: su fixture
ahora usa `saveDB({force:true})` (quitar una orden a pelo ya se bloquea, y hace bien) + 2 checks nuevos
de papelera/restaurar. **E2E EN VIVO contra los datos REALES de Migdalia (taller de prueba temporal,
borrado despues): sellar su factura y luego intentar cambiarle el total = BLOQUEADO; borrarla la manda
completa a la papelera con sus 35 fotos y se restaura con las fotos viendose.** SW v7->**v9**,
live==repo. Commits `21d245e` (fundacion) . `46b8e32` (conflictos) . `9ace184` (candado).

### LO QUE SIGUE ABIERTO (dicho claro, no maquillado)
- **Permisos/roles**: cualquiera con el equipo puede borrar o reabrir. Irrelevante hoy (trabaja solo),
  necesario cuando emplee o venda. Los grandes tienen "solo el dueno despostea".
- **Respaldo del lado del servidor**: los grandes corren en su nube con respaldos del vendedor.
  ShopFlow depende de que ESTE equipo empuje. Mitigado (verificacion real + snapshots + 2 destinos)
  pero es estructuralmente distinto.
- **IndexedDB no disponible** (navegacion privada): las fotos caen a inline y vuelve el riesgo de cuota.
- **Los clientes del 25-26 siguen sin rescate** (ningun respaldo los capturo).

## Last updated: 2026-07-26 (batch 11: la orden de Migdalia YA ESTÁ EN LA NUBE — recuperada sin Roberto)

## 2026-07-26 (batch 11): Roberto dijo "hazlo tú" — el rescate se subió a la nube por API
No hacía falta que él importara nada. Se restauró **directo a su nube** con la llave de servicio,
en el formato exacto que la app espera:
- **35 fotos → Supabase Storage**, bucket `fotos`, ruta `<uid>/<fotoId>.jpg` (idéntico a lo que hace
  `photoUploadPending`). Verificadas **byte-idénticas** (sha256) contra el rescate: 35/35.
- **Orden RO-2 Migdalia Cotto → `public.shops.data`** con las fotos como **ref `{id,t,sp}`** (cero
  base64 en el jsonb: la fila pesa **17.7 KB**). rev 10 → **rev 11**, `updated_by='rescate-migdalia'`.
- **RO-1 "PRUEBA" se descartó** (era basura, era un pendiente de Roberto). `roCounter=2` ⇒ la próxima
  orden real será RO-3. Secretos (aiKey/backup) fuera del payload, como manda `cloudDataPayload`.
- **Respaldo GitHub reescrito: 345 bytes → 23,465 bytes** (commit `916765d`), con guard propio en el
  script: aborta si el respaldo nuevo trae MENOS órdenes que el viejo.
- ⚠️ Guard respetado: el script **aborta si la nube ya tiene órdenes** (no pisa nada a ciegas).
🧪 **VERIFICACIÓN E2E EN VIVO CON SESIÓN REAL (32/32 verde).** Se creó un taller de prueba temporal
(usuario nuevo + copia server-side de las 35 fotos a su propia carpeta, porque la RLS exige
`foldername[1] = auth.uid()`), se manejó **https://robert30z.github.io/ShopFlow** con Playwright y se
comprobó: la orden **baja sola** al entrar · $88.20/PAGADO/ATH · tag JLJ712 + VIN + 17,166 mi ·
35 fotos · 4 denegados · firma · inspección de 35 puntos · Kia `ready` en el garage · las **fotos
bajan de Storage y se PINTAN** (36/36 imágenes con `naturalWidth>0`) · recibo PDF 550 KB con imágenes
dentro · guardar vuelve a subir sin error · **el aviso rojo del home desaparece** · 0 errores de página.
**Taller de prueba y sus 35 fotos borrados después**; verificado estado final: 1 usuario, 1 taller,
35 fotos (todas de Roberto).
🐛 **Bug de fidelidad de prueba corregido:** el fixture de `import-fotos.js` usaba `vehiculo.tablilla`
y `servicios[].nombre/precio` — **campos que la app no lee** (el schema real es
`year/make/model/tag/vin/odoIn/odoOut/color` y `servicios[] = {id,uid,n,p,qty,ep,parts}`). La prueba se
validaba contra sí misma. Alineado al schema real y sigue verde.
✅ Suites: smoke, diag, protect-banner, photos-idb, parts-edit, import-fotos — **0 fallos**.

## 2026-07-26 (batch 10): importar el rescate ya no revienta el almacenamiento

## 2026-07-26 (batch 10): el paso del rescate estaba MINADO — importar habría fallado igual
Al verificar si Roberto ya había importado (no lo había hecho: nube en 0 órdenes, respaldo GitHub en
345 bytes, bucket `fotos` vacío, último sign-in 07-24 03:07) se midió el archivo del rescate:
**`RESCATE-shopflow-2026-07-24.json` pesa 4.59 MB** porque las 35 fotos van **base64 inline** (4.57 MB
de fotos). Y `importBackup` hacía `DB=imported` → **`saveDB()` con las fotos inline puestas**.
🚨 **Eso mete 4.59 MB en `localStorage`, cuyo techo en Safari es ~5 MB** ⇒ el import revienta con
"ALMACENAMIENTO LLENO" (el bug del 07-24) o entra sin margen y muere en la próxima orden. **El paso que
le estábamos pidiendo dar para recuperar sus datos era el que iba a fallar.** La migración a IndexedDB
solo corría en el boot (línea 4381), nunca después de importar.
✅ **ARREGLADO:** `importBackup` ahora corre `migratePhotosToIDB()` **ANTES del primer `saveDB()`**
(medido: **4.59 MB → 4.1 KB** en localStorage), avisa si alguna foto no se pudo mover (sin borrar nada),
y dispara `schedulePhotoUpload()` para que las 35 fotos suban a Supabase Storage.
✅ **BONUS (misma clase de bug):** `importBackup` asignaba `DB=imported` **saltándose todos los guards
de `loadDB`** — un respaldo con un campo del tipo equivocado (objeto donde va lista) tumbaba la app al
renderizar. Ahora normaliza las 14 listas + `serviceParts` + los 3 counters + `laborRate`. Se descubrió
porque el fixture de la prueba usó `svcsCustom:{}` y la app tiró `.map is not a function`.
🧪 **`test/import-fotos.js` NUEVO (21 checks):** importa un respaldo pesado de verdad (4.37 MB) y
verifica que la orden entra completa (total $88.20, ATH, garage `ready`, 4 denegados, firma, 35 fotos),
que las fotos quedan como **ref** (0 inline) y se vuelven a ver desde IDB **tras recargar**, que el
token de respaldo y la key de IA **sobreviven** al import, y que un respaldo malformado no tumba nada.
Suites verdes: smoke, diag, protect-banner, photos-idb, parts-edit. **SW v6 → v7.** Commit `2140900`.
⚠️ **LECCIÓN:** cuando se entrega un archivo de recuperación, **probar el camino de recuperación
completo con ese archivo**, no solo generarlo. El rescate estaba correcto y el import estaba roto.

## 2026-07-26 (batch 9): la app estaba VACÍA — se rescató una orden real del historial de respaldos

## 2026-07-26 (batch 9): la app estaba VACÍA — se rescató una orden real del historial de respaldos
Roberto: *"shopflow is empty even if i respaldar ahora nothing is going to show up"* (y aclaró que el
respaldo vacío de hoy 14:03 **fue una prueba suya**). O sea: no era solo "falta respaldar", los datos
del equipo ya no estaban.
🛟 **RESCATE (el respaldo es un repo git = recuperación punto-en-el-tiempo).** Se recorrieron los 22
commits de `Robert30z/shopflow-backup` contando órdenes por versión:
| fecha (AST) | órdenes/clientes/garage | commit |
|---|---|---|
| 07-10 21:39 | 1 / 0 / 0 | cf5765c |
| 07-23 23:11 | 1 / 1 / 0 | 07014d6 |
| 07-24 09:50 | 1 / 1 / 0 | f5824a9 |
| **07-24 10:01** | **2 / 2 / 1** ⭐ | **4836d0b** |
| 07-24 12:15 | 0 / 0 / 0 ← se vació | a2a8a35 |
| 07-26 14:03 | 0 / 0 / 0 (prueba de Roberto) | 95414f4 |
⇒ Rescatado de `4836d0b`: **RO-2 Migdalia Cotto, 2020 Kia Forte, tablilla JLJ712, $88.20 pendiente,
35 fotos (base64 inline, se recuperan), firma del cliente, piezas con costo/suplidor (Valvoline 5w-20
$20.81→$35.38 + filtro 26300-35505) y 4 denegados de gomas marcados urgentes.** (RO-1 "PRUEBA" es
basura de prueba, se puede borrar tras importar.) Archivo entregado:
`HQ\Pit Stop\ShopFlow-Rescate\RESCATE-shopflow-2026-07-24.json` → Ajustes → **Importar respaldo**.
⚠️ **Sin rescate posible para clientes del 25-26**: ningún respaldo los capturó nunca.
🔧 **DOS HUECOS TAPADOS (los que permitían el borrón):**
1. **`syncPush` no tenía guard.** El respaldo GitHub sí lo tenía desde `b0ef2a4` (07-23 22:21), pero la
   sincronización a Supabase subía a ciegas → un equipo con 0 órdenes pisaba la nube del taller. Ahora
   consulta la nube antes: si el equipo está vacío y la nube tiene órdenes, **BLOQUEA** y dice que
   recargue para bajarlas.
2. **`importBackup` hacía `DB=imported` de golpe.** Como los secretos son por-equipo y NO viajan en el
   respaldo, importar dejaba el aparato **sin respaldo configurado y sin avisar** (círculo vicioso).
   Ahora conserva `aiKey` + config de respaldo, y el confirm dice cuántas órdenes entran vs se pierden.
📌 **Nota sobre el borrón del 07-24 12:15:** el guard de GitHub YA existía ese día, así que lo más
probable es que el equipo corriera una build vieja cacheada (ese fue el día de la crisis de
"ALMACENAMIENTO LLENO" + migración de fotos, SW v3→v4→v5). No se pudo determinar con certeza.
✅ `test/protect-banner.js` ahora 10 checks. diag + smoke verdes, live==repo.

## Last updated: 2026-07-26 (batch 8: 🚨 HALLAZGO — 2 días sin respaldo + aviso en el home)

## 2026-07-26 (batch 8): la app dejaba trabajar SIN RESPALDO y no lo decía
Roberto pidió diagnóstico completo porque ya tiene clientes reales y le está subiendo el flujo.
**La app en sí está sana** (ver abajo), pero el diagnóstico destapó algo peor que un bug de código:
🔴 **HALLAZGO: desde el 2026-07-24 4:15pm NADA ha llegado a la nube.**
- Supabase `public.shops`: **rev 8, 0 órdenes, 0 clientes**, último update 07-24 16:15 (equipo `disp-p14y`).
- Bucket `fotos`: **0 archivos, 0 bytes.**
- `auth.users`: 1 usuario (rjohn7148@gmail.com), **último sign-in 07-24 03:07 — nunca más**.
- Respaldo GitHub (`Robert30z/shopflow-backup`): último commit 07-24 16:16, archivo de **330 bytes con
  `"ordenes":[]`** = vacío. El token del respaldo SÍ sirve (probado, HTTP 200 lectura y escritura),
  o sea que el fallo es del lado del equipo, no de GitHub.
⇒ Todo el trabajo con clientes de estos días vive SOLO en el localStorage/IndexedDB de su equipo.
**Causa de que no se enterara:** el estado del respaldo solo se veía entrando a Ajustes, y
`cloudBackup()` fallaba **callado** (solo alertaba con `manual=true`). El mensaje de "orden guardada"
podía decir "Subiendo respaldo a la nube..." aunque el push fallara.
✅ **ARREGLO (batch 8):** `renderProtect()` pinta una banda en el HOME — **ROJA** si ni la nube ni
GitHub están protegiendo ("TUS DATOS SOLO ESTÁN EN ESTE EQUIPO" + cuántas órdenes hay en riesgo),
**ÁMBAR** si solo una vía funciona, y nada si las dos están sanas. `protectState()` NO se fía de
"configurado": si el último intento falló, esa vía cuenta como caída y enseña el error.
`updBackupStatus`/`updSyncStatus` la refrescan; se calla en demo. **SW v5→v6.**
- **Test nuevo `test/protect-banner.js` (8 checks verde)**, incluido el caso "configurado pero
  fallando". diag (153 handlers) + smoke (87) verdes local Y live, 0 page errors. **live==repo.**
📌 **PENDIENTE ROBERTO (en este orden, no lo cambies):** (1) abrir ShopFlow en el equipo donde están
las órdenes → Ajustes → **"Exportar respaldo"** y guardar el .json (esa es la copia de seguridad real);
(2) **NO tocar "Restaurar"** — la nube está vacía y borraría el equipo; (3) recargar 2 veces (SW v6) →
entrar con rjohn7148@gmail.com en Ajustes→Sincronización → confirmar "última sync" con hora; (4) tocar
"Respaldar ahora" y verificar que el commit nuevo en shopflow-backup ya NO pese 330 bytes.

## Estado verificado 2026-07-26 (todo lo demás VERDE)
diag.js 153 handlers / 10 pantallas / PDF válido / cámara / RO en vivo / respaldo · smoke.js 87 checks
(local **y** contra el sitio en vivo) · photos-idb 13 · parts-edit 6 · protect-banner 8 · 0 errores de
página en todas. **live == repo** (blob idéntico). Los 4 CDN (jsPDF, ZXing, Tabler, Supabase) responden
200. Supabase vivo, RLS aislando bien (lectura anónima = 0 filas).

## Last updated: 2026-07-24 (batch 7: firma visible en dark mode + EDITAR pieza ingresada)

## 2026-07-24 (batch 7): 2 arreglos que pidió Roberto en el campo
- **🖊 Firma invisible en dark mode → ARREGLADO.** La tinta es `#1a1a1a` (negro) pero el `.sig-pad`
  en dark tenía fondo `#141C26` (oscuro) → firma no se veía. Fix: `:root[data-theme="dark"] .sig-pad`
  ahora `background:#fff` (cajón blanco, como pidió) + border `#3a4759`. Los canvas sig-1/sig-2/sig-den
  llevan class sig-pad → aplica. (Regla CSS verificada; el elemento solo existe al llegar al paso de firma.)
- **🔧 EDITAR una pieza ya ingresada → AGREGADO.** Antes solo se podía borrar y volver a crear (si había
  typo). Ahora cada pieza tiene botón ✏️ (lápiz azul) además del 🗑. `editPartRO(i)`/`editPart(i)` llenan
  el form con la pieza + `_editPartIdx=i` + el botón cambia a "Actualizar pieza"; `savePartRO`/`savePart`
  reemplazan en ese índice (NO duplican) y NO re-descuentan inventario al editar. Reset tras guardar y al
  abrir el modal. Funciona en las 2 vistas de piezas (RO específica + catálogo del menú).
- **Test nuevo `test/parts-edit.js`** (7 checks verde): agregar con typo → editar → actualiza en su sitio
  sin duplicar + resetea modo edición. diag+smoke verdes, 0 page errors. **live==repo, SW no cambió** (v5).

## Last updated: 2026-07-24 (batch 6: ☁️ FOTOS EN LA NUBE (Supabase Storage) + diagnóstico de sync)

## 2026-07-24 (batch 6): cloud-first de verdad — fotos en Supabase Storage (visión de vender)
Roberto aclaró: **buena señal + 3 dispositivos + su visión es VENDER ShopFlow.** Con eso, offline-only
localStorage NO es el camino — es cloud-first como los grandes. Ya teníamos el backend Supabase (datos).
Faltaba: (a) las fotos (batch 5 las metió en IndexedDB LOCAL → dejaron de sincronizar entre equipos),
(b) el bug del iPhone que no baja datos. Clean slate (iPad+iPhone vacíos, 1 cuenta) = momento perfecto.
- **Backend (hecho por Claude vía Management API con el PAT de Roberto):** bucket **`fotos`** privado
  (3MB máx, jpeg/png/webp) + **4 políticas RLS** (select/insert/update/delete) que aíslan cada taller a
  su carpeta `{auth.uid()}/` → multi-tenant listo para vender. Verificado.
- **App (index.html):** nuevas funciones de fotos-nube: `photoDownload` (baja de Storage por sp),
  `photoResolve` (cache → IndexedDB local → Storage), `photoUploadPending`/`schedulePhotoUpload`
  (sube las fotos sin `sp` cuando hay sesión; corre tras capturar, tras syncPull y tras login),
  `photoDelCloud`, `dataURLToBlob`/`blobToDataURL`. El ref ahora es `{id,t,sp}` donde sp = ruta en la
  nube. `photoImg`/`fillPhotoImgs`/`hydratePhotos`/visor/dviPDF ahora resuelven vía `photoResolve`
  (bajan de la nube si no está local). **Offline-first intacto:** sin sesión = solo local, sube solo
  cuando vuelve la conexión.
- **Diagnóstico de sync (para cazar el bug del iPhone):** `syncPull` ahora registra `_lastPullAt` +
  `_lastSyncErr` y muestra en Ajustes→Sincronización "**última sync HH:MM:SS**" o el **error en rojo**
  (antes fallaba callado). Así en el iPhone se ve si está logueado y bajando, o qué falla.
- **SW CACHE_V v4→v5.**
- **PROBADO:** `test/photos-cloud.js` (round-trip real con usuario temporal): captura→sube a Storage→
  ref recibe sp→archivo existe en bucket→**borra copia local→BAJA de la nube→re-cachea** = TODO VERDE.
  Usuario temporal + su foto BORRADOS después (users=1, shops=1, bucket=0, limpio). diag+smoke+
  photos-idb siguen verdes, 0 page errors. **live==repo verificado.**
- 📌 **PENDIENTE ROBERTO:** (1) recargar la app en iPad **y** iPhone (SW v5) → login del taller
  (rjohn7148@gmail.com) en ambos → en Ajustes→Sincronización mirar "última sync" para confirmar que
  el iPhone SÍ baja ahora (el v5 + diagnóstico deben resolver/mostrar el bug viejo). (2) Probar:
  foto en iPad → aparece en iPhone. (3) SEGURIDAD: rotar el PAT de Supabase `sbp_c433...` (ya no se
  necesita, el setup terminó) + cambiar la contraseña de la cuenta Supabase (se pegó en chat).
- ⚠️ **TRADEOFF que cambia:** ahora las fotos SÍ van a la nube (Storage) — resuelve lo que batch 5
  dejó local. El respaldo GitHub sigue siendo datos+refs (no bytes). Storage = donde viven las fotos.

## Last updated: 2026-07-24 (batch 5: 🚨🚨 FOTOS A IndexedDB — fix "ALMACENAMIENTO LLENO")

## 2026-07-24 (batch 5): las FOTOS ya no llenan la memoria — se movieron a IndexedDB
🔴 **SÍNTOMA REAL (Roberto en el campo, 2do carro):** al darle Guardar salía "⚠️ ALMACENAMIENTO
LLENO — LOS DATOS NO SE GUARDARON" y perdió órdenes. Causa: las fotos se guardaban como base64
DENTRO de localStorage (~5MB tope de Safari). Una sola orden de **35 fotos** (vuelta redonda al
carro) llenaba los 5MB. Además el fallback `img.onerror` guardaba el ORIGINAL crudo sin comprimir.
Roberto pidió aguantar **mínimo 100 carros** — imposible en localStorage.
✅ **ARREGLO (root cause):** las fotos ahora viven en **IndexedDB** (la "caja grande", cientos de MB).
En la orden queda solo un ref `{id,t}`; localStorage guarda datos+firmas (chiquito). Verificado:
**35 fotos → 5KB de localStorage** (antes reventaba 5MB), 135 fotos → 17KB.
- **Módulo nuevo** (arriba de saveDB): `photoDBOpen/photoPut/photoGet/photoDel`, `_photoCache` (cache
  en memoria pa render síncrono), `storePhoto` (comprime→IDB→ref), `hydratePhotos`, `fillPhotoImgs`
  (rellena `<img data-fid>` async), `photoImg` (tag), `compressToDataURL` (baja calidad hasta ~110KB;
  probado 117KB→33KB), `fotoSrc/fotoTime/fotoIsRef` (soportan ref nuevo + legacy {d}/string).
- **Captura** (galería + cámara rápida + handlePhoto): comprimen y hacen `storePhoto`. El `onerror`
  YA NO guarda el original crudo (ese era el bug que llenaba todo).
- **Render** (grid, strip cámara, galería de detalle, visor, dviPDF): usan photoImg/hydrate. dviPDF
  hidrata las fotos desde IDB ANTES de armar el PDF (addImage es síncrono).
- **Migración al arrancar** (`migratePhotosToIDB`): mueve fotos viejas inline→IDB y libera localStorage.
  Solo commitea si TODOS los puts funcionan (si IDB falla, deja las fotos inline, no pierde nada).
  Skip en demo. + pide `navigator.storage.persist()` (que iOS no borre las fotos por presión).
- **Limpieza:** deletePhoto/deleteRO borran las fotos de IDB. Ajustes → card "Almacenamiento"
  (medidor localStorage/uso + botón "Liberar espacio" = borra restos de sf_v1_real viejo + fotos
  huérfanas de órdenes borradas).
- **SW CACHE_V v3→v4** (que el iPad purgue y baje la versión nueva al recargar online).
- **Test nuevo `test/photos-idb.js`** (13 checks, TODO VERDE): captura→ref, roundtrip IDB, compresión,
  35 y 135 fotos sin llenar LS, persistencia tras recargar, migración libera LS, dviPDF hidrata.
  diag.js (150 handlers) + smoke.js (36) siguen verdes, 0 page errors.
⚠️ **TRADEOFF:** el respaldo en la nube/JSON ahora lleva los DATOS + refs, NO los blobs de fotos
(280MB no caben en GitHub). Las fotos viven en IDB local + en los PDFs generados. Restaurar en otro
equipo trae órdenes/firmas completas pero las fotos saldrían en gris (aceptable; evidencia = local+PDF).
📌 **PENDIENTE Roberto:** recargar la app en el iPad (2 veces si hace falta, pa que el SW v4 entre) —
la migración corre sola y libera la memoria. Sus 2 órdenes actuales están a salvo.
🔮 **FUTURO opcional:** "exportar fotos" a un archivo/carpeta pa archivo externo si algún día quiere
respaldo de imágenes fuera del iPad.

## Last updated: 2026-07-23 (batch 4: 🚨 FIX BUG 409 RESPALDO — root cause del backup roto)

## 2026-07-24: INSPECCIÓN COMPLETA (Claude, mientras Roberto atendía cliente) — TODO VERDE
diag.js (150 handlers, 10 pantallas, PDF válido, cámara, RO en vivo, respaldo) + smoke.js (36 checks) = 0 errores de página.
Verificado que el fix del 409 (batch 4) está en código Y desplegado: sw.js v3 + bypass api.github.com (línea 29),
cloudBackup putOnce no-store + reintento 409, backupNow() en shareViaNative/sendWhatsAppPDF. **live == repo** (blob
index.html idéntico), todo pusheado (main==origin/main). Cuando el iPad recargue online purgará el caché con el sha malo.
⚠️ SIGUE PENDIENTE (tarea de Roberto): Ajustes→"Exportar respaldo" en el iPad pa recuperar la orden del primer cliente
(la nube estaba vacía). NO tocar "Restaurar" (borraría el iPad con la nube vacía).

## New 2026-07-23 (batch 4): 🚨 FIX del HTTP 409 que rompía TODO el respaldo en la nube
Roberto perdió su orden del primer cliente. Investigado: el respaldo en la nube (Robert30z/shopflow-backup)
tenía SOLO respaldos VACÍOS (07-11 setup + 07-23 14:35, ambos 0 órdenes). "Respaldar ahora" daba **HTTP 409**.
- **ROOT CAUSE:** el service worker cacheaba las llamadas a `api.github.com` (caían en el bucket
  "cache-first" del SW). El GET del `sha` devolvía uno VIEJO cacheado → el PUT con sha viejo = **409 Conflict**.
  Por eso el backup dejó de funcionar tras el primer push exitoso (07-11): quedó el sha cacheado.
  ⇒ La orden del cliente NUNCA llegó a la nube (probablemente SIGUE en el localStorage del iPad).
- **FIX (3 frentes):**
  1. `sw.js`: `if(url.hostname==='api.github.com'){e.respondWith(fetch(req));return;}` (red directa, nunca
     caché) + CACHE_V v2→v3 (para que el iPad purgue el caché viejo con el sha malo al recargar online).
  2. `cloudBackup`: GET/PUT con `cache:'no-store'` + **reintento 1 vez si da 409** (putOnce(retry) — GET
     sha fresco y reintenta). Probado con mock: GET→PUT(409)→GET→PUT(200)→✓.
  3. `restoreFromCloud` GET también `no-store`.
- **NUEVO: respalda al enviar el PDF** (pedido de Roberto): `backupNow()` helper (respalda si configurado
  y no-demo) llamado en `shareViaNative` + `sendWhatsAppPDF`. saveRO ya respaldaba.
- **RECUPERACIÓN orden perdida:** la nube está vacía → NO ayuda. Único chance = localStorage del iPad.
  Roberto debe usar Ajustes→**"Exportar respaldo (backup)"** (exportBackup = 100% local, sin GitHub, no
  puede dar 409) para bajar el .json y ver si la orden está. ⚠️ NO tocar "Restaurar" (bajaría la nube vacía
  y BORRARÍA el iPad). Pendiente: confirmar si el export local tiene la orden.
- Backup token (fine-grained PAT, solo shopflow-backup) sigue en project_shopflow.md — verifiqué el repo
  y el historial de commits con él (funciona).

## Last updated: 2026-07-23 (batch 3: MODO OSCURO + texto grande + reporte semanal + WhatsApp adjunto)

## New 2026-07-23 (batch 3): apariencia + reporte semanal + auto-adjunto WhatsApp ("añade todo")
Roberto: clientes mañana y sábado, necesita dark mode HOY. Todo hecho, verificado con screenshots, diag+smoke verde (147 handlers).
- **MODO OSCURO:** el CSS ya usaba variables → tema por override en `:root[data-theme="dark"]`.
  Truco clave: `--navy` se queda OSCURO (barras/botones se ven bien); los 17 textos `color:var(--navy)`
  se cambiaron por `color:var(--ink)` (nueva var: navy en claro, casi-blanco en oscuro) vía sed. También
  sed `background:#fff`→`var(--white)`. `applyTheme()` pone data-theme en <html> + meta theme-color;
  se llama en boot tras loadDB. Toggle en Ajustes (card "Apariencia", primero). Persiste en DB.settings.theme.
  ⚠️ BUG cazado con screenshot: `:root[data-theme="dark"] input` (esp. 0,2,1) pisaba `.tgl` → el switch salía
  oscuro. Fix: `input:not(.tgl)`. Switch ON verde #34C759 fijo, OFF gris.
- **TEXTO GRANDE:** `html.bigtext{zoom:1.15}` (zoom funciona en WebKit/iPad; inline px por todos lados hace
  que zoom sea la vía confiable). Toggle en Apariencia. DB.settings.bigText.
- **Switches tipo iOS:** clase `.tgl` (el global `appearance:none` mataba el look nativo → hechos a mano).
- **REPORTE SEMANAL:** botón verde arriba del P&L (Finanzas) → `reporteSemana()` (lunes-domingo actual):
  carros, facturado, cobrado, por cobrar semana, ticket prom, top 3 servicios, por cobrar TOTAL. Modal
  `#rep-ov` con Copiar/Compartir (navigator.share→WhatsApp). NOTA: push automático los domingos NO es
  posible offline sin backend — es on-demand. (Si Roberto quiere auto-domingo real = cloud agent aparte.)
- **WhatsApp auto-adjunto:** `sendWhatsAppPDF` ahora usa navigator.share con el PDF+mensaje (eliges
  WhatsApp y el PDF va PEGADO); fallback `waFallbackPDF` = descarga + wa.me con texto.
- Herramienta: screenshots de verificación en scratchpad (dark_home/estimado/inspeccion/ajustes/finanzas).

## Last updated: 2026-07-23 (batch 2: diagnóstico full-app + firma/inspección/bug PDF)

## New 2026-07-23 (batch 2): diagnóstico completo + firma más grande + notas inspección + bug PDF
Roberto pidió diagnóstico de TODA la app + 3 ajustes. Todo hecho, `test/diag.js` (nueva herramienta) + smoke = TODO VERDE, page errors none.
- **`test/diag.js` (NUEVA herramienta de diagnóstico full-app):** auditoría ESTÁTICA de cableado
  (regex saca todos los on* del HTML y confirma que cada función llamada existe — 141 handlers OK) +
  E2E: todas las pantallas, jsPDF/ZXing cargadas, PDF recibo/orden válidos (%PDF magic), _pdfCtx,
  botones del modal, fallback de descarga, cámara sin-cámara, RO en vivo, respaldo, reExportPDF no
  corrompe RO. Correr: `python -m http.server 8931` (raíz) + `cd test && node diag.js`.
- **BUG ENCONTRADO Y ARREGLADO (PDF):** `reExportPDF` restaura `RO` justo después de `exportPDF()`, pero
  los botones del modal (shareViaNative/sendWhatsAppPDF) leían `RO.*` al hacer clic → mensaje de WhatsApp
  con datos del RO equivocado al reenviar un recibo viejo desde historial. Fix: `_pdfCtx` congela
  {id,cliente,tel,total,tipo} al generar el PDF (en exportPDF Y workOrderPDF); share/WhatsApp usan _pdfCtx.
- **Firma más grande:** `.sig-pad` 170px→230px + los 3 canvas buffer 600×230 (sig-den era 90). Además
  arreglé `pos()` en initSP para escalar x/y por separado (scx/scy) — antes usaba solo el ancho para
  ambos ejes = firma distorsionada; ahora buffer 1:1 con display, tinta nítida.
- **Notas de inspección (campo aparte):** textarea `#insp-gen` → `RO.inspGeneral` al final del paso
  Inspección; se restaura en fillROInputs; sale en el PDF de inspección (dviPDF, sección NOTAS DE
  INSPECCIÓN arriba) y en el WhatsApp waDVI (línea 📝 Notas).
- **Blindaje:** roViewHTML ahora usa `vv=RO.vehiculo||{}` (no truena si falta el vehículo).

## New 2026-07-23 (primer cliente real de Pit Stop 🎉)

## New 2026-07-23: 4 arreglos pedidos tras el primer cliente real
Roberto atendió su primer cliente con ShopFlow y pidió 4 cosas. Todas hechas (smoke sigue verde, page errors none):
1. **Cámara rápida (varias fotos seguidas):** el input `multiple` ya existía pero en iPad la cámara nativa
   solo deja 1 foto y regresa. Nuevo overlay `#cam-ov` con getUserMedia (facingMode environment),
   botón obturador que NO cierra, contador + tira de últimas 6 + flash. `openCamera/snapPhoto/camUpdateCount/
   closeCamera` (_camStream). Cada disparo comprime a 1280px JPEG .72 y hace push a RO.fotos en vivo.
   Botón verde "Cámara rápida" en paso Fotos + se mantiene "Subir de la galería" (input multiple) como fallback.
3. **PDF no se enviaba:** el fallback viejo era `window.open(_pdfUrl)` = no-op en PWA instalada.
   `shareViaNative` reescrito: si canShare(files) comparte y en error (≠Abort) descarga + explica;
   si no, descarga garantizada + instrucción. Nuevo `sendWhatsAppPDF()` = descarga PDF + abre wa.me
   del cliente con mensaje (RO + total). Modal PDF: botón verde grande "Enviar por WhatsApp" arriba.
2+4. **Backup + pestaña RO en vivo:** botón "👁 Ver RO" en la barra del wizard (junto al RO-id) → overlay
   `#roview-ov` (showROView/roViewHTML): progreso con checks (cliente/veh/fotos/servicios/firmas/guardada),
   cliente+vehículo, servicios+total calculado, denegados, estado de guardado+respaldo, saltos rápidos a pasos.
   saveRO ahora dispara `cloudBackup(false)` inmediato (no espera 45s) + alert dice el estado del respaldo.
   ⚠️ **RIESGO DETECTADO:** órdenes guardadas en MODO DEMO se BORRAN al salir (sf_v1_real las sobrescribe).
   roViewHTML y saveRO ahora avisan en ROJO si DB._demo. Verificar que Roberto NO estaba en demo con su cliente.
   NOTA: no puedo ver su localStorage/GitHub reales — el path de guardado es correcto (upsertRO→saveDB), pero
   confirmar con él que Ajustes→Respaldo tiene repo+token (si no, los datos solo viven en el iPad).

## Last updated: 2026-07-18 (batch 3)

## New 2026-07-18 batch 3: $ por hora (Finanzas → Equipo)
buildEquipoStats now returns dolHora {horas, ventasHora, gananciaHora} for the selected period:
ventas sin IVU ÷ horas facturadas, ganancia = (sub − costo piezas) ÷ horas (Tekmetric gross $/hr +
GP/hr). Card under the period chips: 3 tiles (horas fact. / ventas-hora / ganancia-hora, green when
≥ laborRate) + meta note. Icon ti-cash (ti-clock-dollar not verified in loaded Tabler). Smoke 89
green (isolated mes-pasado order: sub 200, 2h, piezas $40 → $100/h y $80/h exact).

## New 2026-07-18 batch 2: Guión de video + búsqueda total + notas editables + recomendados por millaje
- **Guión de video** (Roberto: tech records walkaround video for customer): settings.videoIntro
  template (Ajustes card, {tecnico}/{taller}/{vehiculo}/{cliente} placeholders, default = Roberto's
  pitch in ES) + videoScript(roId) (intro + hallazgos from denegados w/ precio/urgencia/nota +
  "atender primero" urgente + cierre) + showVideoScript overlay (#vs-ov: copy btn via execCommand,
  "Abrir chat" wa.me/waNum — video itself attaches in WhatsApp, app only carries the script) +
  purple 🎥 button in RO detail. NOTE: videos can NOT be stored in the app (localStorage) — by design.
- **Búsqueda total**: renderOrdenes filter now matches cliente/RO/tag + VIN + make/model/year +
  empresa + techNotes + queja (joined haystack).
- **Notas editables en detalle**: read-only Notas card → always-present textarea #det-notas +
  saveNotasDetail (alert). Old smoke check updated to read textarea value.
- **Recomendados por millaje/años**: REC_MANT table (intervals 5k/10k/15k/25k/50k/100k, severe-PR;
  prices aligned to catalog) + recsMant(millas,anio) → nearest 5k bucket M, filter M%cada===0 +
  age-based avisos (batería 3 años PR, refrigerante 5 años). "🔧 50k mi" chip in wizard Servicios
  (activeCat '__recs', shown when odoIn≥4000) with tap-to-add via addSvcRO('rec-…'). 50k+2020 Tacoma
  → aceite, rotación, frenos traseros, transmisión, diferencial, inyectores/cámara, coolant, líq.
  frenos + aviso batería (matches Roberto's exact example).
- Smoke: 88 checks green local+live (4 new: búsqueda vin/nota/marca; detalle+notas persist; guión;
  recsMant math).

## New 2026-07-18: Asesores de servicio + Finanzas → Equipo (Roberto's direct request)
Roberto: "window to see how technicians are doing (tech A 130hr this week)" + "tab for how much
each service advisor sold — parts/labor/total, hours per job".
- **Asesores:** `DB.asesores` [{id:'ASE-n',nombre,activo,creado}] + `DB.aseCounter` (mirrors técnicos).
  Ajustes → "Asesores de servicio" card (add/edit/del); select in wizard cierre (RO.asesor, only when
  roster non-empty) + RO detail (asignarAse). aseName/aseOptionsHTML helpers.
- **Finanzas → Equipo tab (f-eq):** renderEquipo() with period chips (Esta semana lunes-domingo /
  Semana pasada / Este mes / Mes pasado, global EQ_PERIOD + eqRange()). `buildEquipoStats()` =
  testable core. Técnicos card: horas facturadas bar per tech (max-relative), órdenes, ventas $,
  horas de reloj (relojLog filtered by period via rl.out), eficiencia % = fact/real (>100% green).
  Asesores card: vendido $, PIEZAS $ (sellPrice×qty), LABOR $ (laborHours×rate), HRS/ORDEN,
  h labor vendidas, cierre % = (vendido/1.115)/(aprobado+denegados precio) — Tekmetric benchmark 50%+.
  "Cierre de hoy" card: carros/vendido/cobrado (pagadoFecha hoy)/por cobrar (ALL pendientes balance).
- **CSV contable:** +Asesor column (after Tecnico; TOTAL row shifted one comma).
- Demo seeds 2 asesores (Marta/Roberto) + o.asesor alternating on all orders.
- finTab ids array now includes 'f-eq' — keep order synced with #fin-tabs DOM.
- Smoke: 84 checks green (2 new: Asesores roster; Equipo stats math incl. close 75% case + CSV).
  Gotcha: earlier time-clock check leaves +65s on TEC-1 → hReal/eficiencia assertions use ranges.

## New 2026-07-15 (batch 2): Técnicos + trabajos guardados + IVU/CSV + recuperar denegados (fd35cc8)
Gap-analysis batch vs Tekmetric/Shopmonkey/AutoLeap/ARI. Roberto: "add everything, especially
technicians — usernames like numbers, roster menu, select técnico per job".
- **Técnicos:** `DB.tecnicos` [{id:'TEC-n',nombre,com,activo,creado}] + `DB.tecCounter` (usernames
  auto-assigned TEC-1, TEC-2…). Ajustes → "Técnicos del taller" card (add/edit ✏️/delete ✖).
  Select in wizard cierre pane (RO.tecnico) + RO detail "Técnico y tiempo" card (asignarTec).
  Reloj: iniciarReloj/detenerReloj → o.reloj (running) / o.relojSecs + o.relojLog [{tec,in,out,secs}];
  detail shows TIEMPO REAL vs FACTURADAS. P&L: per-tech month card (órdenes, ingresos, h reloj,
  comisión = subtotal-sin-IVU × com%).
- **Trabajos guardados:** `DB.jobsCustom` [{id,n,ep,laborHours,parts}]. ⭐ button on a configured
  service card in renderROSO saves template; "⭐ Guardados" chip in renderROSvcMenu (activeCat
  '__jobs') re-adds complete (jobTotal = ep + hrs×rate + parts sell); admin list in Ajustes→Catálogo.
- **Recuperar denegados:** "Cliente aprobó — mover a servicios" btn per denegado in detail
  (real index into o.denegados, skips auto&&!confirmed). apruebaDen: splice→push servicio→
  recalcROTotal (sub×(1-desc)×1.115); if estado was pagado → abonado=old total, estado pendiente.
  **Bug caught by smoke: abonado must be SET to old total, not +=** (double-counted with prior abonos).
- **Contable:** P&L row "IVU cobrado (11.5%)" (Σ total−total/1.115, skips abiertas) +
  buildContableCSV(ym)/exportContableCSV (BOM literal + comment, ORDENES w/ subtotal/IVU/total/técnico
  + GASTOS + TOTALs).
- **Seguimientos:** type 'den' (denegados precio>0 !auto||confirmed, 30-120d, !o.segDen → waDenied)
  + type 'cita' (mañana, !c.remAt, unshifted first → waCitaRem).
- Demo mode now seeds 3 técnicos (Luis 15%/Kevin 10%/Ángel) w/ o.tecnico + relojLog + 1 saved job.
- Smoke: 76 checks green local AND live.
Sales kit same day: **Flyer-ShopFlow.pdf** in Desktop\ShopFlow-Ventas (ES, QR→WhatsApp, prices,
fundadores; Roberto vetoed the word "gringo" — keep it out of all materials).

## New 2026-07-15: MODO DEMO para vender (e745778) + kit de ventas fuera del repo
Sales-support batch. In-app: **Modo demo** — Ajustes card toggles realistic sample data
(29 órdenes over 8 weeks w/ canvas-generated fotos/firmas, citas hoy, garage in all 3 states,
inventario w/ low-stock, gastos, seguimientos incl. winback, 1 orden abierta w/ inspección) so
the app looks alive in a pitch. Real data snapshots to localStorage `sf_v1_real` and restores
exactly on exit; floating red pill "MODO DEMO — toca para salir"; cloud backup HARD-PAUSED while
`DB._demo` (scheduleCloudBackup/cloudBackup/restoreFromCloud all guarded, exportBackup warns) so
demo data can never clobber the real GitHub backup. Smoke +3 checks (seed/pause/restore) = 69
green, verified local AND live. NOTE: `enterDemo()`/`exitDemo()` call location.reload — in tests
trigger via setTimeout outside the evaluate.
Outside the repo (Desktop\ShopFlow-Ventas\): **reporte-kpi\** (node reporte.js <backup.json>
[YYYY-MM] → branded Spanish monthly KPI PDF via ShopFlow/test playwright; gen_sample.js makes a
fake taller to show prospects — this IS the "Reporte KPI $15/mes" product) and **deploy-clientes\**
(nuevo-cliente.ps1 = org repos + push app + printed manual steps; actualizar-clientes.ps1 = fleet
update; CHECKLIST.md = full ES onboarding). Deploy scripts parse-checked; need the GitHub org +
Cloudflare account (one-time manual) before first real run.

## New 2026-07-12: Catálogo de servicios editable (admin) — for selling ShopFlow to other talleres
Roberto is selling ShopFlow to other shops; each shop offers services not in the built-in menu
(alineamiento, torneo de discos, etc.). Added a per-shop catalog editor:
- **Schema:** `DB.svcsCustom` [{id:'cs-<ts>',cat,n,p,c:0}] + `DB.catsCustom` [{id:'cc-<ts>',l}]
  (guarded in loadDB + seeded in the DB literal — backward compatible).
- **Single source of truth:** `allCats()` = MC + custom cats; `getSvcs(cat)` = MS[cat] + custom svcs.
  ALL catalog readers now use these (renderROSvcMenu, renderMenuCats, renderMenuSvcs) — grep
  confirmed no direct MS/MC readers remain. Custom services get the Piezas (serviceParts) button
  for free since menú cards key off s.id.
- **Admin UI:** Ajustes → "Catálogo de servicios" card (name, price, category select incl.
  "➕ Nueva categoría…" via prompt). List shows custom svcs w/ ✏️ edit (prompt) + ✖ delete
  (confirm; deleting the last service of a custom category removes the empty category).
- **Smoke suite +3 checks** (custom svc persists+merges; custom cat renders in admin; custom svc
  selectable in RO wizard step 2). Full suite PASSES locally, page errors: none.
- Also this session: full pre-sales inspection — live==repo (git blob hash match), all 3 CDNs 200,
  smoke suite PASSED against the LIVE GitHub Pages site too.

## Last updated: 2026-07-10

## New 2026-07-10: Customer status link + online approval (self-contained, no backend)
Turns ShopFlow from an internal-only tool into a customer-facing one — honors the single-file rule.
- **`shareStatus(roId)`**: builds a compact RO snapshot (shop name + phone, RO#, first name, vehicle,
  itemized servicios, denegados as "recomendado", total, and a progress step derived from the garage
  state working/ready/entregado or the RO estado). Base64url-encodes it into `#s=<snap>` on the app's
  own URL (`_b64e`/`_b64d`, unicode-safe). Shares via WhatsApp to the customer's `tel` (or native
  share / prompt fallback). NO photos in the snapshot (keeps the URL small — a few KB).
- **`renderCustomerStatus()`**: on boot, if `location.hash` starts with `#s=`, the app renders a
  read-only customer page instead of booting the app (boot is wrapped in `else`). Shows a 4-step
  progress tracker (Recibido→En proceso→Listo→Entregado), itemized services, optional recommendations,
  total, and an **"Aprobar presupuesto"** button → `wa.me/<shopPhone>` with an approval message
  (order # + total). Needs `settings.shopPhone` set in Ajustes for the approve button to appear.
- Button **"Compartir estado con cliente"** added to RO detail (before the PDF button).
- E2E verified via Playwright (seeded RO → share URL → customer view renders, approve links back to
  shop). Full smoke suite still PASSES (page errors: none). No schema change (snapshot is derived).
- **Note:** the boot only reads the hash at load, so a customer must open the link cold (correct for
  the use case). Roberto must set his shop phone in Ajustes for approvals to route back to him.

## New 2026-07-10 (3rd pass): FULL INSPECTION (Roberto promoting it — must be bug-free) + real bug fixed
Deep E2E inspection via Playwright. **REAL BUG FOUND + FIXED:** the Tabler icons CDN URL was wrong
(`.../3.19.0/tabler-icons.min.css` → 404), so EVERY `<i class="ti">` icon rendered blank the whole time.
Correct path = `.../3.19.0/dist/tabler-icons.min.css` (verified font+glyphs now load). Bumped SW
CACHE_V v1→v2 so installed iPads re-fetch. Commit 7a72e6e.
**Verified GREEN:** all 11 screens render (no errors); git clean + live==repo; smoke suite PASSES
(page errors none); **signatures: real canvas ink captured → sig1 freezes auth1(services+total)+terms →
both persist to localStorage → PDF embeds them (valid 807KB PDF, 4 image XObjects).** saveRO persists.
The scary "112 console errors" during testing were a SELF-INFLICTED bad monkey-patch of jsPDF in the
test harness, NOT an app bug (gone after reload). **App is client-ready/clean.**

## New 2026-07-10 (2nd pass): Route order + partial-payment balances — BOTH SHIPPED
- **Route order:** `rutaHoy()` opens Google Maps with today's `agendada` citas that have a `direccion`,
  chained as a driving route (last = destination, rest = waypoints, origin = tu ubicación). "Ruta de hoy
  (N paradas)" button in the citas screen (shown when today's citas have addresses). Each cita's address
  is now a tappable Google Maps search link. Uses the existing `direccion` field — no schema change.
- **Balances / partial payments:** new `o.abonado` (guard-free, `o.abonado||0` everywhere).
  `registrarAbono(roId)` records a partial payment; auto-marks PAGADO when abonado >= total. RO detail
  (pendiente) shows an Abonado/Balance box + "Registrar abono" button; "Marcar PAGADO" now shows the
  remaining balance. `markPaid` sets abonado=total. Receipt PDF prints "Abonado / BALANCE PENDIENTE"
  when partially paid (`abonado` added to the reExportPDF RO mapping).
- Verified E2E via Playwright (route URL built correctly; $80 abono on $200 → balance $120 pendiente →
  +$120 → pagado). Full smoke suite PASSES (page errors: none). **All 5 Pit Stop items now done.**

## Still open on Pit Stop (asked but not yet built — next session):
- (all 5 done) — Also live: public booking page (Desktop/PitStop-Web, artifact e4af4ab5) + fleet
  outreach playbook (Desktop/PitStop-Fleet-Outreach.md).

## Last updated: 2026-07-09

## New 2026-07-09: v1.4 — the "client-ready" feature pack (gap analysis vs Shopmonkey/Tekmetric/AutoLeap)
Six features added in one pass, all end-to-end tested + covered by new smoke checks (suite now 60):
- **Citas/Agenda**: new `citas` screen (create/confirm/complete/no-show/delete), `DB.citas`,
  home shows "Citas de hoy" + tile counter, WhatsApp confirmation (`waCita`), and
  **"Iniciar RO"** prefills the wizard from the cita (parses "2019 Honda Civic" → year/make/model)
  and marks the cita completada. `_citaPrefill` applied in `initRO`.
- **Seguimientos** (home queue, `getSeguimientos()`): 3-day post-service follow-up (`waFollowUp`,
  stamps `o.segFu`) → then Google-review request (`waReview`, needs `settings.reviewLink`,
  stamps `o.segRev`) → 6-month win-back per client (`waWinback`, stamps `c.winbackAt`, 90d cooldown).
- **DVI**: `waDVI(roId)` WhatsApp summary (verde count, amarillo/rojo lists w/ inspection notes +
  presupuesto from denegados) and `dviPDF(roId)` full inspection PDF (colored sections, photos ≤6,
  courtesy disclaimer) via `sharePDFDoc` (native sheet, falls back to download). Buttons in RO detail
  appear when the RO has inspection data.
- **Cobros/ATH Móvil**: Ajustes card "Cobros y reseñas" → `settings.athMovil` + `settings.reviewLink`.
  "Cobrar por WhatsApp" button on pendiente ROs (`waCobro`: total + ATH number). `markPaid` now
  prompts for the actual payment method (prefilled with RO's método).
- **KPIs**: new Finanzas tab (f-kpi): ticket promedio 90d, approval rate (aprobado$ vs denegado$),
  x cobrar, 8-week revenue bar chart (CSS only, single green hue), top 5 servicios by revenue,
  client retention (repeat %).
- **VIN decode**: `decodeVIN` now calls NHTSA vPIC (free, CORS-ok) at 17 chars (auto-fires from the
  VIN input), autofills empty año/marca/modelo + shows trim/engine; falls back to old WMI decode
  offline (`decodeVINLocal`). Verified against the real API (1HGCM82633A004352 → 2003 Honda Accord).
Schema adds (all backward-compatible, guarded in loadDB): `DB.citas`, `o.segFu/segRev`, `c.winbackAt`,
`settings.athMovil/reviewLink`. Also fixed favicon 404 (only console error found in the 07-09 diagnostic).


## New 2026-07-03 (later 4): Real intake flow + work order
- Wizard order now matches the shop: Cliente → Fotos → **Servicios → Estimado → FIRMA de
  autorización** → Inspección → Denegados → Firma final → Cierre. Services + prices exist BEFORE
  the customer signs (diag $80 case; oil+coolant upsell case).
- `RO.auth1` frozen at signature: itemized services (svc price, labor h × rate, parts) + total.
- `workOrderPDF()`: ORDEN DE TRABAJO with prices + embedded authorization signature — printer
  button in wizard nav + abierta detail. Paper copy for the car/técnico.
- `techNotes` prints on receipt (NOTAS), work order, and RO detail. "+ Servicio manual" button.
- Step-index hooks moved: buildEstSum n===3, renderAutoRecs/DenList n===6. saveRO redirect gotoStep(2).
- **Pages deploy note**: deploy-step failures were the ~10-deploys/hour Pages rate limit (build job
  was green). If deploy fails: wait for the hour window, next push retriggers. .nojekyll added anyway.
- Smoke = 49 checks.

## New 2026-07-03 (later 3): Offline PWA + WhatsApp + payment tracking
- **Offline**: sw.js (network-first shell, cache-first CDN/assets — bump CACHE_V on strategy change)
  + manifest.json + icons (180/192/512). App verified loading fully with network cut. Installable
  from Safari "Add to Home Screen". NOTE: single-file rule now has 3 sanctioned satellites
  (sw.js, manifest.json, icons) — no build step, still no npm deps.
- **WhatsApp** (wa.me deep links, no backend): "Enviar por WhatsApp" in RO detail (receipt summary;
  PDF still shared via native sheet), green "Recordar" button on home maintenance notifs
  (pre-written reminder). waNum() normalizes PR 10-digit → 1XXXXXXXXXX.
- **Payment tracking**: new ROs default estado 'pendiente' (select synced at pane build AND step 6,
  Pendiente first option); green "Marcar PAGADO" button in detail sets estado+pagadoFecha.
  "Hoy"/"Por cobrar" tiles now reflect reality.
- Smoke test now 44 checks + separate offline reload verification.

## New 2026-07-03 (later 2): Cloud backup + terms v3
- **Auto-backup to private GitHub repo**: every saveDB schedules a push (45s debounce) of the full
  DB (minus aiKey + backup token) to `shopflow_backup.json` in a user-owned PRIVATE repo via the
  GitHub contents API. Ajustes card: repo + fine-grained token (Contents R/W, single repo),
  status w/ last-backup time, "Respaldar ahora" and "Restaurar" (restore keeps local secrets).
  Git history of the backup repo = point-in-time recovery. NOT yet live-tested against the real
  GitHub API — Roberto must create repo + token and hit "Respaldar ahora" once to confirm.
- **TERMS_VERSION=3**: customer-supplied-parts jobs now carry NO warranty at all (parts or labor);
  30d/1,000mi warranty applies only when Pit Stop supplied the part. Old ROs keep their frozen v2.
- Smoke test now 37 checks.

## New 2026-07-03 (later): Terms version-stamping + 30-day warranty + photo evidence
- `TERMS_VERSION=2` / `TERMS_DATE` constants; DISC clause 2 now covers **mano de obra y piezas
  suplidas por Pit Stop, 30 días / 1,000 millas**, excludes customer parts / wear items / misuse.
- On first signature, the current terms text is FROZEN into `RO.terms` {v, fecha, text}. PDFs print
  the frozen text with "v2 — vigentes y aceptados al firmar (fecha)". Editing DISC later never
  changes what old ROs show. When editing terms in the future: bump TERMS_VERSION + TERMS_DATE.
- Photos are now `{d: dataURL, t: ISO}` (old string format still supported via fotoSrc/fotoTime).
  Capture timestamp shows on wizard grid, RO detail "Fotos de entrada" gallery, and the new
  full-screen viewer (tap thumbnail → prev/next + "Capturada: <fecha completa>").
- Smoke test now 34 checks.

## New 2026-07-03: Open RO (draft save) + real signature persistence — "the legal SAVE button"
- Signature pads now persist the actual ink (canvas → PNG dataURL in `RO.sigData`) plus signing
  timestamp (`RO.sigTimes`) the moment the customer lifts their finger. Survives app close.
- 💾 button in the wizard nav = `saveOpenRO()`: saves at ANY step (only requires client name),
  estado `'abierta'`, upserts by RO id. Blue "Abierta" badge in Órdenes/Historial/detail.
- RO detail for abiertas: shows stored signature images w/ timestamps + "Continuar orden" button
  → `continueRO()` reloads everything into the wizard (fields, inspection, photos, signatures re-drawn).
- Completing a resumed RO upserts (no duplicates), creates the garage entry once, estado from the
  Estimado select. PDFs now embed BOTH stored signatures with real signing timestamps (re-export
  works forever, no more "(Sin firma digital capturada)").
- Photos now compressed on capture (max 1280px, JPEG 72%) — protects localStorage quota.
- `saveDB()` failure is no longer silent: loud alert telling the user to export backup + free space.
- Smoke test extended to 29 checks covering the full draft lifecycle.

## Previous: 2026-07-02

## What's built and verified working
- 10 screens: home dashboard, RO wizard (9 steps), garage, órdenes, clientes, menú/POS,
  finanzas (P&L/suplidores/inventario/gastos), historial (día/todas/clientes), inventario, ajustes.
- Full RO lifecycle verified end-to-end with headless browser (2026-07-02): create → canvas
  signatures → 36-point inspection → services + IVU 11.5% math → save → garage
  working→ready→entregado → PDF generate/download/re-export → delete w/ confirm.
- Backup export/import, quick orders from menú, client auto-save, VIN scanner modal (needs camera).

## Fixed 2026-07-02 (full diagnostic + repair session)
1. AI features (diagnóstico, part suggest/describe, labor estimate): were calling the Anthropic API
   with no key/headers — never worked. Now: shared `aiFetch()` helper, user API key in Ajustes
   (localStorage only), correct headers incl. `anthropic-dangerous-direct-browser-access`,
   model `claude-opus-4-8`, graceful "configura tu key" message when unset.
2. `renderAutoRecs` was called but never defined (JS error on Denegados step; feature dead).
   Implemented: red inspection items now auto-appear in Denegados with price input + Registrar.
3. Inventario "Agregar" was dead (guard on nonexistent `#inv-form`). Removed — modal opens.
4. Órdenes cards had no tap handler. Now reuse `roCardHTML` → tap opens RO detail + PDF re-export.
5. Deleting an RO now removes its garage entry (was orphaned as "working"); garage entries carry
   `roId`. Totals rounded to 2 decimals on save.

## Next 3 things
1. Have Roberto add his Anthropic API key in Ajustes and confirm the 4 AI buttons live on the iPad.
2. Consider a "Pendiente"-first workflow: RO defaults to estado "pagado" — counts revenue before
   the customer pays. Maybe default "pendiente" + one-tap "marcar pagado" in RO detail.
3. SaaS groundwork: multi-shop data model (namespace localStorage key per shop / move to backend).

## Current known quirks (not bugs)
- VIN scanner requires camera permission; in-browser test environments show a harmless "Not supported".
- AI features require the user's own API key; keep it out of the repo (public!).
