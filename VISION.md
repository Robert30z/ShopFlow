# ShopFlow — Vision & Rules

ShopFlow is the shop-management PWA for **Pit Stop** (mobile mechanic, Bayamón PR).
Pit Stop is customer zero — the long-term play is a **SaaS product other shops pay for**.

## Non-negotiable rules (do not break these in any session)

1. **Single file.** The entire app is `index.html`. No build step, no bundler, no framework.
2. **No npm dependencies.** Only CDN scripts already in use: jsPDF and ZXing. Think hard before adding another.
3. **iOS Safari first.** The app runs on an iPad at the shop. The PDF share sheet
   (`shareViaNative` → `navigator.share`) MUST keep working — it's how receipts reach customers.
4. **localStorage is the database** (`sf_v1`). Backup/restore via Ajustes JSON export must always work.
   Any schema change must be backward-compatible with existing stored data (guard-and-default in `loadDB`).
5. **Never commit secrets.** The repo and GitHub Pages site are public. The Anthropic API key
   lives only in `DB.settings.aiKey` (localStorage), entered by the user in Ajustes.
6. **Spanish UI**, technical terms in English (that's how PR mechanics talk).
7. **Deploys from `main`** via GitHub Pages — anything merged to main is live at
   robert30z.github.io/ShopFlow immediately. Run the smoke test before pushing.

## How to test

```
python -m http.server 8931          # in the repo root
cd test && npm install && node smoke.js
```

`test/smoke.js` drives the full RO lifecycle headlessly (create → sign → inspect →
service → save → garage working→ready→entregado → PDF) and exits non-zero on failure.
