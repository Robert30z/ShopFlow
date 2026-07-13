# ShopFlow — STATE

> Update this file at the end of every working session so the next session resumes instead of restarting.

## Last updated: 2026-07-12

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
