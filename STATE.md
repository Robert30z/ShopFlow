# ShopFlow — STATE

> Update this file at the end of every working session so the next session resumes instead of restarting.

## Last updated: 2026-07-02

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
