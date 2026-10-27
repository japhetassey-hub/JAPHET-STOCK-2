import type { DB } from '../db/database.ts';
import { tx } from '../db/database.ts';
import { toMilli, toBaseMilli, costPerBase } from './numbers.ts';

export interface Ctx { db: DB; userId: number }

type Rule = { from: boolean | 'opt'; to: boolean | 'opt'; prefix: string };
const RULES: Record<string, Rule> = {
  OPENING_STOCK: { from: false, to: true, prefix: 'OPN' },
  GOODS_RECEIVED: { from: false, to: true, prefix: 'GRN' },
  SUPPLIER_RETURN: { from: true, to: false, prefix: 'SRT' },
  TRANSFER: { from: true, to: true, prefix: 'TRF' },          // Transfer Out / Transfer In are the two sides of one linked line
  KITCHEN_CONSUMPTION: { from: true, to: false, prefix: 'KCN' },
  COCKTAIL_CONSUMPTION: { from: true, to: false, prefix: 'CCN' },
  JUICE_CONSUMPTION: { from: true, to: false, prefix: 'JCN' },
  INTERNAL_USE: { from: true, to: false, prefix: 'IUS' },
  DAMAGED: { from: true, to: false, prefix: 'DMG' },
  EXPIRED: { from: true, to: false, prefix: 'EXP' },
  CUSTOMER_RETURN: { from: false, to: true, prefix: 'CRT' },
  ADJUSTMENT: { from: 'opt', to: 'opt', prefix: 'ADJ' },
  STOCKTAKE_VARIANCE: { from: 'opt', to: 'opt', prefix: 'STV' },
  PRODUCTION_CONSUMPTION: { from: true, to: false, prefix: 'PCN' },
  PRODUCTION_OUTPUT: { from: false, to: true, prefix: 'POT' },
  OTHER_ISSUE: { from: true, to: false, prefix: 'OIS' },
  SALE: { from: true, to: false, prefix: 'SAL' },              // stock leaves the chosen location; price recorded per line
  REVERSAL: { from: 'opt', to: 'opt', prefix: 'REV' },
};
export const MOVEMENT_TYPES = Object.keys(RULES);

export interface LineInput {
  productId: number; quantity: number | string; unitId?: number;
  fromLocationId?: number | null; toLocationId?: number | null;
  unitCostMinor?: number | null; unitPriceMinor?: number | null; batchNo?: string; expiryDate?: string; reason?: string;
}
export interface MovementInput {
  type: string; date?: string; notes?: string; supplierId?: number; invoiceRef?: string; deliveryRef?: string;
  sourceDocType?: string; sourceDocId?: number; reversesId?: number; negativeReason?: string; lines: LineInput[];
}

const one = <T>(db: DB, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export function audit(c: Ctx, action: string, entity: string, entityId: number | null, prev: unknown, next: unknown, reason?: string, txnId?: number) {
  c.db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,previous_value,new_value,reason,transaction_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(c.userId, action, entity, entityId, prev == null ? null : JSON.stringify(prev), next == null ? null : JSON.stringify(next), reason ?? null, txnId ?? null);
}
export function getSetting(db: DB, key: string): string | undefined { return one<{ value: string }>(db, 'SELECT value FROM settings WHERE key=?', key)?.value; }
function nextRef(db: DB, prefix: string): string {
  db.prepare('INSERT INTO sequences(name,last_value) VALUES (?,1) ON CONFLICT(name) DO UPDATE SET last_value=last_value+1').run(prefix);
  const n = one<{ last_value: number }>(db, 'SELECT last_value FROM sequences WHERE name=?', prefix)!.last_value;
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

/** Stock of one product at one location, in base-unit milli, derived purely from the ledger. */
export function getBalance(db: DB, productId: number, locationId: number): number {
  return one<{ b: number }>(db,
    `SELECT COALESCE(SUM(CASE WHEN to_location_id=? THEN quantity_milli ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN from_location_id=? THEN quantity_milli ELSE 0 END),0) AS b
     FROM inventory_transaction_lines WHERE product_id=? AND (to_location_id=? OR from_location_id=?)`,
    locationId, locationId, productId, locationId, locationId)!.b;
}
/** Whole-business stock = external receipts/outputs minus external issues; transfers cancel out by construction. */
export function getTotalStock(db: DB, productId: number): number {
  return one<{ b: number }>(db,
    `SELECT COALESCE(SUM(CASE WHEN to_location_id IS NOT NULL THEN quantity_milli ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN from_location_id IS NOT NULL THEN quantity_milli ELSE 0 END),0) AS b
     FROM inventory_transaction_lines WHERE product_id=?`, productId)!.b;
}
export function getBalances(db: DB, locationId?: number) {
  const sql = `SELECT p.id product_id, p.name, l.id location_id, l.name location,
     SUM(CASE WHEN t.to_location_id=l.id THEN t.quantity_milli ELSE 0 END) - SUM(CASE WHEN t.from_location_id=l.id THEN t.quantity_milli ELSE 0 END) qty_milli
     FROM inventory_transaction_lines t JOIN products p ON p.id=t.product_id
     JOIN locations l ON l.id IN (t.from_location_id, t.to_location_id)
     ${locationId ? 'WHERE l.id=?' : ''} GROUP BY p.id, l.id ORDER BY l.name, p.name`;
  return (locationId ? db.prepare(sql).all(locationId) : db.prepare(sql).all()) as
    { product_id: number; name: string; location_id: number; location: string; qty_milli: number }[];
}

export function postMovement(c: Ctx, m: MovementInput): { id: number; reference: string } {
  const rule = RULES[m.type];
  if (!rule) throw new Error(`Unknown movement type: ${m.type}`);
  if (!m.lines?.length) throw new Error('A transaction needs at least one line');
  const date = m.date ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(date))) throw new Error('Invalid transaction date');
  return tx(c.db, () => {
    const db = c.db;
    const reference = nextRef(db, rule.prefix);
    const h = db.prepare(`INSERT INTO inventory_transactions(reference,movement_type,txn_date,user_id,notes,supplier_id,invoice_ref,delivery_ref,source_doc_type,source_doc_id,reverses_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(reference, m.type, date, c.userId, m.notes ?? null, m.supplierId ?? null, m.invoiceRef ?? null,
      m.deliveryRef ?? null, m.sourceDocType ?? null, m.sourceDocId ?? null, m.reversesId ?? null);
    const id = Number(h.lastInsertRowid);
    const ins = db.prepare(`INSERT INTO inventory_transaction_lines(transaction_id,product_id,quantity_milli,entered_quantity_milli,entered_unit_id,from_location_id,to_location_id,unit_cost_minor,unit_price_minor,batch_no,expiry_date,reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const touched: [number, number][] = [];
    for (const l of m.lines) {
      const p = one<{ id: number; base_unit_id: number; is_active: number; name: string }>(db, 'SELECT id,base_unit_id,is_active,name FROM products WHERE id=?', l.productId);
      if (!p) throw new Error(`Product ${l.productId} not found`);
      if (!p.is_active && m.type !== 'REVERSAL') throw new Error(`Product "${p.name}" is inactive`);
      const entered = toMilli(l.quantity);
      if (entered <= 0) throw new Error('Quantity must be greater than zero');
      const unitId = l.unitId ?? p.base_unit_id;
      let factor = 1000;
      if (unitId !== p.base_unit_id) {
        const cv = one<{ factor_milli: number }>(db, 'SELECT factor_milli FROM product_unit_conversions WHERE product_id=? AND unit_id=?', p.id, unitId);
        if (!cv) throw new Error(`No unit conversion defined for "${p.name}" and unit ${unitId}`);
        factor = cv.factor_milli;
      }
      const base = toBaseMilli(entered, factor);
      const from = l.fromLocationId ?? null, to = l.toLocationId ?? null;
      if (rule.from === true && from == null) throw new Error(`${m.type} requires a source location`);
      if (rule.from === false && from != null) throw new Error(`${m.type} must not have a source location`);
      if (rule.to === true && to == null) throw new Error(`${m.type} requires a destination location`);
      if (rule.to === false && to != null) throw new Error(`${m.type} must not have a destination location`);
      if (from == null && to == null) throw new Error('Line needs a source or destination location');
      if (from != null && to != null && from === to) throw new Error('Source and destination must differ');
      for (const loc of [from, to]) if (loc != null) {
        const lr = one<{ is_active: number }>(db, 'SELECT is_active FROM locations WHERE id=?', loc);
        if (!lr) throw new Error(`Location ${loc} not found`);
        if (!lr.is_active) throw new Error(`Location ${loc} is inactive`);
      }
      const cost = l.unitCostMinor == null ? null : costPerBase(l.unitCostMinor, factor);
      if (m.type === 'SALE' && l.unitPriceMinor == null) throw new Error('A selling price is required for every sale line (use 0 for complimentary items)');
      if (m.type !== 'SALE' && l.unitPriceMinor != null) throw new Error('Selling price can only be recorded on sales');
      if (l.unitPriceMinor != null && l.unitPriceMinor < 0) throw new Error('Selling price cannot be negative');
      const price = l.unitPriceMinor == null ? null : costPerBase(l.unitPriceMinor, factor);
      ins.run(id, p.id, base, entered, unitId, from, to, cost, price, l.batchNo ?? null, l.expiryDate ?? null, l.reason ?? null);
      if (from != null) touched.push([p.id, from]);
    }
    // Negative-stock guard evaluated on the post-insert ledger, so multi-line transactions are checked correctly.
    const allowNeg = getSetting(db, 'allow_negative_stock') === '1';
    for (const [pid, loc] of touched) {
      const bal = getBalance(db, pid, loc);
      if (bal < 0) {
        if (!allowNeg) throw new Error(`Insufficient stock: this would leave product ${pid} at ${bal / 1000} in location ${loc}`);
        if (!m.negativeReason?.trim()) throw new Error('A reason is required to post stock below zero');
        audit(c, 'NEGATIVE_STOCK_POSTED', 'inventory_transactions', id, null, { productId: pid, locationId: loc, balanceMilli: bal }, m.negativeReason, id);
      }
    }
    audit(c, `POST_${m.type}`, 'inventory_transactions', id, null, { reference, lines: m.lines.length }, m.notes, id);
    return { id, reference };
  });
}

// ---- Convenience operations -------------------------------------------------------------------
export function postOpeningStock(c: Ctx, o: { productId: number; locationId: number; quantity: number | string; unitCostMinor?: number | null; date?: string }) {
  const dup = one(c.db, `SELECT 1 FROM inventory_transaction_lines l JOIN inventory_transactions t ON t.id=l.transaction_id
     WHERE t.movement_type='OPENING_STOCK' AND l.product_id=? AND l.to_location_id=?`, o.productId, o.locationId);
  if (dup) throw new Error('Opening stock already exists for this product and location; post an adjustment instead');
  return postMovement(c, { type: 'OPENING_STOCK', date: o.date, notes: 'Opening stock',
    lines: [{ productId: o.productId, quantity: o.quantity, toLocationId: o.locationId, unitCostMinor: o.unitCostMinor }] });
}
export function receiveGoods(c: Ctx, o: { locationId: number; supplierId?: number; invoiceRef?: string; deliveryRef?: string; notes?: string; date?: string;
  lines: { productId: number; quantity: number | string; unitId?: number; unitCostMinor?: number | null; batchNo?: string; expiryDate?: string }[] }) {
  return postMovement(c, { type: 'GOODS_RECEIVED', date: o.date, notes: o.notes, supplierId: o.supplierId, invoiceRef: o.invoiceRef, deliveryRef: o.deliveryRef,
    lines: o.lines.map(l => ({ ...l, toLocationId: o.locationId })) });
}
export function transferStock(c: Ctx, o: { fromLocationId: number; toLocationId: number; notes?: string; date?: string; lines: { productId: number; quantity: number | string; unitId?: number }[] }) {
  return postMovement(c, { type: 'TRANSFER', date: o.date, notes: o.notes, lines: o.lines.map(l => ({ ...l, fromLocationId: o.fromLocationId, toLocationId: o.toLocationId })) });
}
export function issueStock(c: Ctx, o: { type: string; locationId: number; productId: number; quantity: number | string; unitId?: number; reason?: string; date?: string; negativeReason?: string }) {
  const r = RULES[o.type];
  if (!r || r.from !== true || r.to !== false) throw new Error(`${o.type} is not an issue-type movement`);
  return postMovement(c, { type: o.type, date: o.date, notes: o.reason, negativeReason: o.negativeReason,
    lines: [{ productId: o.productId, quantity: o.quantity, unitId: o.unitId, fromLocationId: o.locationId, reason: o.reason }] });
}
/** Adjustment: pass the signed delta. Reason is mandatory. Never silently overwrites a balance. */
export function adjustStock(c: Ctx, o: { productId: number; locationId: number; delta: number | string; reason: string; type?: 'ADJUSTMENT' | 'STOCKTAKE_VARIANCE'; negativeReason?: string }) {
  if (!o.reason?.trim()) throw new Error('A reason is required for adjustments');
  const d = toMilli(o.delta);
  if (d === 0) throw new Error('Adjustment is zero');
  return postMovement(c, { type: o.type ?? 'ADJUSTMENT', notes: o.reason, negativeReason: o.negativeReason,
    lines: [{ productId: o.productId, quantity: Math.abs(d) / 1000, ...(d > 0 ? { toLocationId: o.locationId } : { fromLocationId: o.locationId }), reason: o.reason }] });
}
/** Corrects a posted transaction by posting its mirror image; the original is preserved and linked. */
export function reverseTransaction(c: Ctx, txnId: number, reason: string) {
  if (!reason?.trim()) throw new Error('A reason is required to reverse a transaction');
  const orig = one<{ id: number; reference: string; movement_type: string }>(c.db, 'SELECT id,reference,movement_type FROM inventory_transactions WHERE id=?', txnId);
  if (!orig) throw new Error('Transaction not found');
  if (orig.movement_type === 'REVERSAL') throw new Error('A reversal cannot itself be reversed; post a new correcting transaction');
  if (one(c.db, 'SELECT 1 FROM inventory_transactions WHERE reverses_id=?', txnId)) throw new Error('Transaction has already been reversed');
  const lines = c.db.prepare('SELECT * FROM inventory_transaction_lines WHERE transaction_id=?').all(txnId) as any[];
  return postMovement(c, { type: 'REVERSAL', reversesId: txnId, notes: `Reversal of ${orig.reference}: ${reason}`, sourceDocType: 'inventory_transactions', sourceDocId: txnId,
    lines: lines.map(l => ({ productId: l.product_id, quantity: l.quantity_milli / 1000, fromLocationId: l.to_location_id, toLocationId: l.from_location_id, unitCostMinor: l.unit_cost_minor, reason })) });
}

// ---- Alerts (read-only; never changes stock) ----------------------------------------------------
export type AlertType = 'OUT_OF_STOCK' | 'CRITICAL' | 'LOW' | 'NEGATIVE';
export interface StockAlert { productId: number; name: string; locationId: number; location: string; qtyMilli: number;
  minMilli: number | null; criticalMilli: number | null; reorderTargetMilli: number | null; suggestedReorderMilli: number; type: AlertType; severity: 'info' | 'warning' | 'critical'; lastMovement: string | null }
/** Thresholds come from product_location_settings only, so each location is independent. Only configured pairs are evaluated. */
export function getStockAlerts(db: DB): StockAlert[] {
  const rows = db.prepare(`SELECT s.product_id, p.name, s.location_id, l.name location, s.min_stock_milli, s.critical_stock_milli, s.reorder_target_milli
     FROM product_location_settings s JOIN products p ON p.id=s.product_id AND p.is_active=1 JOIN locations l ON l.id=s.location_id AND l.is_active=1`).all() as any[];
  const out: StockAlert[] = [];
  for (const r of rows) {
    const q = getBalance(db, r.product_id, r.location_id);
    let type: AlertType | null = null;
    if (q < 0) type = 'NEGATIVE'; else if (q === 0) type = 'OUT_OF_STOCK';
    else if (r.critical_stock_milli != null && q <= r.critical_stock_milli) type = 'CRITICAL';
    else if (r.min_stock_milli != null && q <= r.min_stock_milli) type = 'LOW';
    if (!type) continue;
    const last = one<{ d: string }>(db, `SELECT MAX(t.txn_date) d FROM inventory_transactions t JOIN inventory_transaction_lines x ON x.transaction_id=t.id
       WHERE x.product_id=? AND (x.from_location_id=? OR x.to_location_id=?)`, r.product_id, r.location_id, r.location_id)?.d ?? null;
    out.push({ productId: r.product_id, name: r.name, locationId: r.location_id, location: r.location, qtyMilli: q, minMilli: r.min_stock_milli,
      criticalMilli: r.critical_stock_milli, reorderTargetMilli: r.reorder_target_milli,
      suggestedReorderMilli: r.reorder_target_milli == null ? 0 : Math.max(0, r.reorder_target_milli - Math.max(q, 0)),
      type, severity: type === 'LOW' ? 'warning' : 'critical', lastMovement: last });
  }
  return out;
}

// ---- Sales (stock-deducting; revenue only, never profit) -------------------------------------------
/** One sale document; each line can be sold from a different location. Price is per ENTERED unit and is stored per base unit. */
export function recordSale(c: Ctx, o: { notes?: string; date?: string; negativeReason?: string;
  lines: { productId: number; locationId: number; quantity: number | string; unitId?: number; unitPriceMinor: number }[] }) {
  return postMovement(c, { type: 'SALE', date: o.date, notes: o.notes, negativeReason: o.negativeReason,
    lines: o.lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitId: l.unitId, fromLocationId: l.locationId, unitPriceMinor: l.unitPriceMinor })) });
}
export interface SalesRow { locationId: number; location: string; saleCount: number; revenueMinor: number }
/** Revenue per location for sales in [fromDate, toDate) (ISO strings, optional). Reversed sales are excluded. */
export function salesSummary(db: DB, o: { fromDate?: string; toDate?: string } = {}): { totalMinor: number; byLocation: SalesRow[] } {
  const rows = db.prepare(`SELECT t.id tid, x.from_location_id loc, loc.name location, x.quantity_milli q, x.unit_price_minor price
    FROM inventory_transactions t JOIN inventory_transaction_lines x ON x.transaction_id=t.id
    JOIN locations loc ON loc.id=x.from_location_id
    WHERE t.movement_type='SALE' AND (?1 IS NULL OR t.txn_date >= ?1) AND (?2 IS NULL OR t.txn_date < ?2)
      AND NOT EXISTS (SELECT 1 FROM inventory_transactions r WHERE r.reverses_id=t.id)`).all(o.fromDate ?? null, o.toDate ?? null) as any[];
  const m = new Map<number, { row: SalesRow; txns: Set<number> }>();
  for (const r of rows) {
    const e = m.get(r.loc) ?? { row: { locationId: r.loc, location: r.location, saleCount: 0, revenueMinor: 0 }, txns: new Set<number>() };
    e.row.revenueMinor += Math.round(r.q * r.price / 1000); e.txns.add(r.tid); e.row.saleCount = e.txns.size; m.set(r.loc, e);
  }
  const byLocation = [...m.values()].map(e => e.row).sort((a, b) => a.location.localeCompare(b.location));
  return { totalMinor: byLocation.reduce((s, r) => s + r.revenueMinor, 0), byLocation };
}
