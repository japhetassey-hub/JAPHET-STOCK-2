# Japhet Stock Management System
Designed and Created by Japhet Assey

## Status: Phase 1 + core of Phase 2 (engine only). NOT a finished application.

### Implemented and tested (25 automated tests, `npm test`, Node >= 22.5)
- SQLite schema + versioned migrations (`src/main/db/migrations`), idempotent, with seed data:
  5 default locations, units, 6 roles, category tree, settings (TZS, Africa/Dar_es_Salaam, DD/MM/YYYY).
- Authoritative inventory ledger. Each line moves stock FROM and/or TO a location.
  Transfers are one linked line (net zero for the business, never a receipt).
- Integer arithmetic only: quantities in thousandths, money in minor units. Unknown cost = NULL (never 0).
- Per-product unit conversions (1 crate = 24 bottles), validated.
- Atomic posting (rollback on any failure), negative-stock guard (needs setting + reason, audited).
- Immutable ledger/audit log (DB triggers); corrections via single-use reversal transactions.
- Products with or without price; cost and selling price separate (DB CHECK constraint).
- Opening stock (once per product/location), goods received, transfers, consumption/damage/expiry issues, adjustments.
- No SKU: products are identified by name (unique, case-insensitive) plus an internal ID. Optional barcode kept.
- Five default locations; Cocktail and Juice are one location, "Cocktail & Juice Station".
- Sales: stock-deducting SALE movements from any location (one document can span locations), price per line
  (0 allowed for complimentary; no-price products can be sold at an entered price), per-crate prices converted to
  per-bottle, atomic with the negative-stock guard, reversible, `salesSummary()` revenue by location and date range
  (reversed sales excluded). Revenue only, never profit.
- Per-location alert thresholds (low / critical / out / negative) with reorder suggestion. Read-only.

### Web preview
`web-preview/index.html` is the clickable browser demo (open it in any browser; data stays in that browser).

### NOT implemented yet (do not treat as done)
Electron shell, React UI, preload/IPC, packaging/installer (.exe), users/login/password hashing/permissions
(admin user has no password yet), stock requests workflow, sales reports/export, receipts and payment methods, GRN documents, stocktake workflow, recipes/production,
expiry-warning alerts, dashboard, all reports + PDF/Excel export, import/export, backup/restore, user guide.

### Why
The build sandbox had no network access (no `npm install`), no Electron, and is Linux, so a Windows installer
cannot be produced or tested here. The engine runs on Node's built-in `node:sqlite`; `src/main/db/database.ts`
is the only file touching the driver, so it can be swapped to `better-sqlite3` for Electron.

### Next steps (on a Windows machine with internet)
1. `npm i electron react vite typescript better-sqlite3 exceljs pdfkit electron-builder` and an Electron-rebuild step.
2. Swap driver in `database.ts`; keep the tests green.
3. Add main/preload with contextIsolation, then Phase 2 documents, then UI, in the order of the master prompt.
