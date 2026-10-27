import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database.ts';
import * as inv from '../src/main/domain/inventory.ts';
import * as ms from '../src/main/domain/master.ts';
import type { Ctx } from '../src/main/domain/inventory.ts';

const MIG = path.resolve(import.meta.dirname, '../src/main/db/migrations');
function setup() {
  const db = openDatabase(':memory:', MIG);
  const c: Ctx = { db, userId: 1 };
  const loc = (n: string) => (db.prepare('SELECT id FROM locations WHERE name=?').get(n) as any).id as number;
  const unit = (n: string) => (db.prepare('SELECT id FROM units WHERE name=?').get(n) as any).id as number;
  const L = { store: loc('Main Store'), bar: loc('Bar Counter'), kitchen: loc('Kitchen'), juice: loc('Cocktail & Juice Station') };
  const beer = ms.createProduct(c, { name: 'Safari Lager 500ml', baseUnitId: unit('Bottle'), hasPrice: true, purchaseCostMinor: 150000, sellingPriceMinor: 250000 });
  ms.addConversion(c, beer, unit('Crate'), 24);
  const soap = ms.createProduct(c, { name: 'Hand soap', baseUnitId: unit('Piece') }); // no price
  return { db, c, L, beer, soap, unit };
}
const bal = (s: ReturnType<typeof setup>, p: number, l: number) => inv.getBalance(s.db, p, l) / 1000;

test('seed: five default locations, roles, categories, settings', () => {
  const { db } = setup();
  const names = (db.prepare('SELECT name FROM locations ORDER BY id').all() as any[]).map(r => r.name);
  assert.deepEqual(names, ['Main Store', 'Bar Counter', 'Kitchen', 'Cocktail & Juice Station', 'Cleaning Supplies Store']);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM roles').get() as any).n, 6);
  assert.equal(inv.getSetting(db, 'currency'), 'TZS');
});
test('opening stock creates the correct balance, once only', () => {
  const s = setup();
  inv.postOpeningStock(s.c, { productId: s.beer, locationId: s.L.store, quantity: 50 });
  assert.equal(bal(s, s.beer, s.L.store), 50);
  assert.throws(() => inv.postOpeningStock(s.c, { productId: s.beer, locationId: s.L.store, quantity: 10 }), /already exists/);
  assert.equal(bal(s, s.beer, s.L.store), 50);
});
test('receiving 100 bottles increases stock by exactly 100', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, invoiceRef: 'INV-1', lines: [{ productId: s.beer, quantity: 100 }] });
  assert.equal(bal(s, s.beer, s.L.store), 100);
});
test('unit conversion: 3 crates = 72 bottles; cost per crate becomes cost per bottle', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 3, unitId: s.unit('Crate'), unitCostMinor: 2400000 }] });
  assert.equal(bal(s, s.beer, s.L.store), 72);
  const line = s.db.prepare('SELECT unit_cost_minor,entered_quantity_milli FROM inventory_transaction_lines').get() as any;
  assert.equal(line.unit_cost_minor, 100000); assert.equal(line.entered_quantity_milli, 3000);
});
test('conversion validation: missing / zero / base-unit conversions rejected', () => {
  const s = setup();
  assert.throws(() => ms.addConversion(s.c, s.beer, s.unit('Carton'), 0), /greater than zero/);
  assert.throws(() => ms.addConversion(s.c, s.beer, s.unit('Bottle'), 12), /base unit/);
  assert.throws(() => inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 1, unitId: s.unit('Carton') }] }), /No unit conversion/);
});
test('transfer moves 20 between locations and leaves total business stock unchanged', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 100 }] });
  const total = inv.getTotalStock(s.db, s.beer);
  inv.transferStock(s.c, { fromLocationId: s.L.store, toLocationId: s.L.bar, lines: [{ productId: s.beer, quantity: 20 }] });
  assert.equal(bal(s, s.beer, s.L.store), 80); assert.equal(bal(s, s.beer, s.L.bar), 20);
  assert.equal(inv.getTotalStock(s.db, s.beer), total);
  const t = s.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE movement_type='GOODS_RECEIVED'").get() as any;
  assert.equal(t.n, 1); // the transfer was not recorded as a receipt
});
test('consumption, damaged and expired reduce only the chosen location', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.kitchen, lines: [{ productId: s.soap, quantity: 10 }] });
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.soap, quantity: 10 }] });
  inv.issueStock(s.c, { type: 'KITCHEN_CONSUMPTION', locationId: s.L.kitchen, productId: s.soap, quantity: 3 });
  inv.issueStock(s.c, { type: 'DAMAGED', locationId: s.L.kitchen, productId: s.soap, quantity: 1, reason: 'dropped' });
  inv.issueStock(s.c, { type: 'EXPIRED', locationId: s.L.kitchen, productId: s.soap, quantity: 2 });
  assert.equal(bal(s, s.soap, s.L.kitchen), 4); assert.equal(bal(s, s.soap, s.L.store), 10);
  const types = (s.db.prepare("SELECT movement_type m FROM inventory_transactions WHERE movement_type IN ('DAMAGED','EXPIRED','KITCHEN_CONSUMPTION')").all() as any[]).map(r => r.m).sort();
  assert.deepEqual(types, ['DAMAGED', 'EXPIRED', 'KITCHEN_CONSUMPTION']);
  assert.throws(() => inv.issueStock(s.c, { type: 'GOODS_RECEIVED', locationId: s.L.kitchen, productId: s.soap, quantity: 1 }), /not an issue-type/);
});
test('products without price are fully trackable; unknown cost is NULL not zero; cost and selling price are separate', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.soap, quantity: 5 }] });
  assert.equal(bal(s, s.soap, s.L.store), 5);
  assert.equal((s.db.prepare('SELECT unit_cost_minor c FROM inventory_transaction_lines').get() as any).c, null);
  const p = s.db.prepare('SELECT * FROM products WHERE id=?').get(s.beer) as any;
  assert.equal(p.purchase_cost_minor, 150000); assert.equal(p.selling_price_minor, 250000);
  assert.throws(() => ms.createProduct(s.c, { name: 'X', baseUnitId: s.unit('Piece'), purchaseCostMinor: 100 }), /Has Price/);
});
test('decimal quantities are exact (no float drift)', () => {
  const s = setup();
  const rice = ms.createProduct(s.c, { name: 'Rice', baseUnitId: s.unit('Kilogram') });
  for (let i = 0; i < 10; i++) inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: rice, quantity: '0.1' }] });
  assert.equal(inv.getBalance(s.db, rice, s.L.store), 1000);
  assert.throws(() => inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: rice, quantity: '0.0001' }] }), /3 decimal/);
});
test('negative stock blocked by default; allowed only when enabled AND a reason is given (and audited)', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 5 }] });
  assert.throws(() => inv.issueStock(s.c, { type: 'INTERNAL_USE', locationId: s.L.bar, productId: s.beer, quantity: 6 }), /Insufficient stock/);
  assert.equal(bal(s, s.beer, s.L.bar), 5);
  s.db.prepare("UPDATE settings SET value='1' WHERE key='allow_negative_stock'").run();
  assert.throws(() => inv.issueStock(s.c, { type: 'INTERNAL_USE', locationId: s.L.bar, productId: s.beer, quantity: 6 }), /reason is required/);
  inv.issueStock(s.c, { type: 'INTERNAL_USE', locationId: s.L.bar, productId: s.beer, quantity: 6, negativeReason: 'late delivery entry' });
  assert.equal(bal(s, s.beer, s.L.bar), -1);
  assert.equal((s.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='NEGATIVE_STOCK_POSTED'").get() as any).n, 1);
});
test('failed multi-line transaction leaves no partial stock change', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 10 }, { productId: s.soap, quantity: 1 }] });
  const before = (s.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get() as any).n;
  assert.throws(() => inv.transferStock(s.c, { fromLocationId: s.L.store, toLocationId: s.L.bar, lines: [{ productId: s.beer, quantity: 5 }, { productId: s.soap, quantity: 99 }] }));
  assert.equal(bal(s, s.beer, s.L.store), 10); assert.equal(bal(s, s.beer, s.L.bar), 0);
  assert.equal((s.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get() as any).n, before);
  assert.equal((s.db.prepare('SELECT COUNT(*) n FROM inventory_transaction_lines').get() as any).n, 2);
});
test('posted ledger rows and audit log cannot be edited or deleted', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 10 }] });
  assert.throws(() => s.db.exec('UPDATE inventory_transaction_lines SET quantity_milli=1'), /immutable/);
  assert.throws(() => s.db.exec('DELETE FROM inventory_transaction_lines'), /cannot be deleted/);
  assert.throws(() => s.db.exec('DELETE FROM inventory_transactions'), /cannot be deleted/);
  assert.throws(() => s.db.exec('DELETE FROM audit_logs'), /append-only/);
});
test('reversal restores stock once, preserves the original, and cannot be repeated', () => {
  const s = setup();
  const r = inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 10 }] });
  inv.reverseTransaction(s.c, r.id, 'wrong delivery');
  assert.equal(bal(s, s.beer, s.L.store), 0);
  assert.throws(() => inv.reverseTransaction(s.c, r.id, 'again'), /already been reversed/);
  assert.equal((s.db.prepare('SELECT COUNT(*) n FROM inventory_transactions').get() as any).n, 2);
  assert.throws(() => inv.reverseTransaction(s.c, r.id, ''), /reason is required/);
});
test('adjustment posts exactly once, requires a reason, and signs correctly', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 10 }] });
  inv.adjustStock(s.c, { productId: s.beer, locationId: s.L.store, delta: -3, reason: 'count' });
  inv.adjustStock(s.c, { productId: s.beer, locationId: s.L.store, delta: 1, reason: 'found' });
  assert.equal(bal(s, s.beer, s.L.store), 8);
  assert.throws(() => inv.adjustStock(s.c, { productId: s.beer, locationId: s.L.store, delta: 1, reason: ' ' }), /reason is required/);
});
test('alerts honour per-location thresholds; out-of-stock and critical classified; reorder suggestion computed', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 8 }] });
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 8 }] });
  ms.setLocationThresholds(s.c, s.beer, s.L.store, { min: 10, critical: 5, reorderTarget: 50 }); // 8 <= 10 -> LOW
  ms.setLocationThresholds(s.c, s.beer, s.L.bar, { min: 5, critical: 2 });                        // 8 > 5 -> no alert
  let a = inv.getStockAlerts(s.db);
  assert.equal(a.length, 1); assert.equal(a[0].location, 'Main Store'); assert.equal(a[0].type, 'LOW'); assert.equal(a[0].suggestedReorderMilli, 42000);
  inv.issueStock(s.c, { type: 'INTERNAL_USE', locationId: s.L.store, productId: s.beer, quantity: 4 });
  assert.equal(inv.getStockAlerts(s.db)[0].type, 'CRITICAL');
  inv.issueStock(s.c, { type: 'INTERNAL_USE', locationId: s.L.store, productId: s.beer, quantity: 4 });
  assert.equal(inv.getStockAlerts(s.db)[0].type, 'OUT_OF_STOCK');
  assert.throws(() => ms.setLocationThresholds(s.c, s.beer, s.L.bar, { min: 2, critical: 5 }), /Critical/);
  const before = bal(s, s.beer, s.L.store); inv.getStockAlerts(s.db); assert.equal(bal(s, s.beer, s.L.store), before); // alerts never change stock
});
test('audit log records who/what for postings', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 1 }] });
  const r = s.db.prepare("SELECT * FROM audit_logs WHERE action='POST_GOODS_RECEIVED'").get() as any;
  assert.equal(r.user_id, 1); assert.ok(r.transaction_id);
});
test('migrations are idempotent', async () => {
  const { migrate } = await import('../src/main/db/database.ts');
  const { db } = setup();
  assert.deepEqual(migrate(db, MIG), []);
});

test('sale deducts stock only from the chosen location and records revenue', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 30 }] });
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 100 }] });
  inv.recordSale(s.c, { lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 10, unitPriceMinor: 250000 }] });
  assert.equal(bal(s, s.beer, s.L.bar), 20); assert.equal(bal(s, s.beer, s.L.store), 100);
  assert.equal(inv.salesSummary(s.db).totalMinor, 2500000);
});
test('one sale can span several locations; cocktail and juice share one station', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 10 }] });
  inv.receiveGoods(s.c, { locationId: s.L.juice, lines: [{ productId: s.soap, quantity: 5 }] });
  const r = inv.recordSale(s.c, { lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 2, unitPriceMinor: 250000 }, { productId: s.soap, locationId: s.L.juice, quantity: 1, unitPriceMinor: 100000 }] });
  assert.match(r.reference, /^SAL-/);
  assert.equal(bal(s, s.beer, s.L.bar), 8); assert.equal(bal(s, s.soap, s.L.juice), 4);
  const sum = inv.salesSummary(s.db);
  assert.equal(sum.byLocation.length, 2); assert.equal(sum.totalMinor, 600000);
});
test('sale is atomic: insufficient stock on any line posts nothing and records no revenue', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 5 }] });
  assert.throws(() => inv.recordSale(s.c, { lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 3, unitPriceMinor: 250000 }, { productId: s.beer, locationId: s.L.bar, quantity: 3, unitPriceMinor: 250000 }] }), /Insufficient stock/);
  assert.equal(bal(s, s.beer, s.L.bar), 5); assert.equal(inv.salesSummary(s.db).totalMinor, 0);
  assert.equal((s.db.prepare("SELECT COUNT(*) n FROM inventory_transactions WHERE movement_type='SALE'").get() as any).n, 0);
});
test('sale needs a price (0 allowed for complimentary); price only allowed on sales; no-price products can be sold at an entered price', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.soap, quantity: 5 }] });
  assert.throws(() => inv.recordSale(s.c, { lines: [{ productId: s.soap, locationId: s.L.bar, quantity: 1, unitPriceMinor: undefined as any }] }), /selling price is required/);
  inv.recordSale(s.c, { lines: [{ productId: s.soap, locationId: s.L.bar, quantity: 1, unitPriceMinor: 0 }] });
  inv.recordSale(s.c, { lines: [{ productId: s.soap, locationId: s.L.bar, quantity: 1, unitPriceMinor: 50000 }] });
  assert.equal(inv.salesSummary(s.db).totalMinor, 50000);
  assert.throws(() => inv.postMovement(s.c, { type: 'GOODS_RECEIVED', lines: [{ productId: s.soap, quantity: 1, toLocationId: s.L.bar, unitPriceMinor: 1 }] }), /only be recorded on sales/);
});
test('sale price per crate converts to per-bottle revenue correctly', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.store, lines: [{ productId: s.beer, quantity: 48 }] });
  inv.recordSale(s.c, { lines: [{ productId: s.beer, locationId: s.L.store, quantity: 1, unitId: s.unit('Crate'), unitPriceMinor: 4800000 }] });
  assert.equal(bal(s, s.beer, s.L.store), 24);
  assert.equal(inv.salesSummary(s.db).totalMinor, 4800000);
});
test('reversing a sale restores stock and removes its revenue, once', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 10 }] });
  const sale = inv.recordSale(s.c, { lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 4, unitPriceMinor: 250000 }] });
  inv.reverseTransaction(s.c, sale.id, 'wrong item');
  assert.equal(bal(s, s.beer, s.L.bar), 10); assert.equal(inv.salesSummary(s.db).totalMinor, 0);
  assert.throws(() => inv.reverseTransaction(s.c, sale.id, 'again'), /already been reversed/);
});
test('sales summary respects date ranges', () => {
  const s = setup();
  inv.receiveGoods(s.c, { locationId: s.L.bar, lines: [{ productId: s.beer, quantity: 10 }] });
  inv.recordSale(s.c, { date: '2026-10-01T09:00:00.000Z', lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 1, unitPriceMinor: 100000 }] });
  inv.recordSale(s.c, { date: '2026-10-02T09:00:00.000Z', lines: [{ productId: s.beer, locationId: s.L.bar, quantity: 2, unitPriceMinor: 100000 }] });
  assert.equal(inv.salesSummary(s.db, { fromDate: '2026-10-02T00:00:00.000Z', toDate: '2026-10-03T00:00:00.000Z' }).totalMinor, 200000);
  assert.equal(inv.salesSummary(s.db).totalMinor, 300000);
});
test('products have no SKU and duplicate names are rejected (case-insensitive)', () => {
  const s = setup();
  const cols = (s.db.prepare('PRAGMA table_info(products)').all() as any[]).map(c => c.name);
  assert.ok(!cols.includes('sku'));
  assert.throws(() => ms.createProduct(s.c, { name: 'safari lager 500ML', baseUnitId: s.unit('Bottle') }), /already exists/);
});
