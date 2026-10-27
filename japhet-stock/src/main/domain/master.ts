import type { Ctx } from './inventory.ts';
import { audit } from './inventory.ts';
import { toMilli } from './numbers.ts';

export function createCategory(c: Ctx, name: string, parentId?: number) {
  if (!name?.trim()) throw new Error('Category name is required');
  const r = c.db.prepare('INSERT INTO categories(name,parent_id) VALUES (?,?)').run(name.trim(), parentId ?? null);
  audit(c, 'CREATE_CATEGORY', 'categories', Number(r.lastInsertRowid), null, { name, parentId });
  return Number(r.lastInsertRowid);
}
export function createLocation(c: Ctx, name: string, kind = 'GENERAL') {
  if (!name?.trim()) throw new Error('Location name is required');
  const r = c.db.prepare('INSERT INTO locations(name,kind) VALUES (?,?)').run(name.trim(), kind);
  audit(c, 'CREATE_LOCATION', 'locations', Number(r.lastInsertRowid), null, { name, kind });
  return Number(r.lastInsertRowid);
}
export interface ProductInput {
  name: string; baseUnitId: number; categoryId?: number; subcategoryId?: number; barcode?: string; brand?: string; description?: string;
  hasPrice?: boolean; purchaseCostMinor?: number | null; sellingPriceMinor?: number | null; supplierId?: number; preferredLocationId?: number;
  purchaseUnitId?: number; trackExpiry?: boolean; trackBatch?: boolean; expiryWarningDays?: number;
}
export function createProduct(c: Ctx, p: ProductInput) {
  if (!p.name?.trim()) throw new Error('Product name is required');
  if (c.db.prepare('SELECT 1 FROM products WHERE name = ? COLLATE NOCASE').get(p.name.trim())) throw new Error('A product with this name already exists');
  const hasPrice = !!p.hasPrice;
  if (!hasPrice && (p.purchaseCostMinor != null || p.sellingPriceMinor != null)) throw new Error('Set "Has Price" before entering a cost or selling price');
  const r = c.db.prepare(`INSERT INTO products(barcode,name,category_id,subcategory_id,brand,description,base_unit_id,purchase_unit_id,has_price,purchase_cost_minor,selling_price_minor,supplier_id,preferred_location_id,tracks_expiry,tracks_batch,expiry_warning_days)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.barcode ?? null, p.name.trim(), p.categoryId ?? null, p.subcategoryId ?? null, p.brand ?? null,
    p.description ?? null, p.baseUnitId, p.purchaseUnitId ?? null, hasPrice ? 1 : 0, p.purchaseCostMinor ?? null, p.sellingPriceMinor ?? null, p.supplierId ?? null,
    p.preferredLocationId ?? null, p.trackExpiry ? 1 : 0, p.trackBatch ? 1 : 0, p.expiryWarningDays ?? null);
  const id = Number(r.lastInsertRowid);
  audit(c, 'CREATE_PRODUCT', 'products', id, null, p);
  return id;
}
/** 1 `unitId` = `factor` base units (e.g. 1 crate = 24 bottles for this product). */
export function addConversion(c: Ctx, productId: number, unitId: number, factor: number | string) {
  const f = toMilli(factor, 'conversion factor');
  if (f <= 0) throw new Error('Conversion factor must be greater than zero');
  const p = c.db.prepare('SELECT base_unit_id FROM products WHERE id=?').get(productId) as { base_unit_id: number } | undefined;
  if (!p) throw new Error('Product not found');
  if (p.base_unit_id === unitId) throw new Error('The base unit cannot be given a conversion');
  c.db.prepare('INSERT INTO product_unit_conversions(product_id,unit_id,factor_milli) VALUES (?,?,?) ON CONFLICT(product_id,unit_id) DO UPDATE SET factor_milli=excluded.factor_milli').run(productId, unitId, f);
  audit(c, 'SET_CONVERSION', 'products', productId, null, { unitId, factor });
}
export function setLocationThresholds(c: Ctx, productId: number, locationId: number, t: { min?: number | string | null; critical?: number | string | null; reorderTarget?: number | string | null; max?: number | string | null }) {
  const m = (v?: number | string | null) => (v == null ? null : toMilli(v, 'threshold'));
  const min = m(t.min), crit = m(t.critical), tgt = m(t.reorderTarget), max = m(t.max);
  if ([min, crit, tgt, max].some(v => v != null && v < 0)) throw new Error('Thresholds cannot be negative');
  if (min != null && crit != null && crit > min) throw new Error('Critical threshold cannot exceed the minimum threshold');
  c.db.prepare(`INSERT INTO product_location_settings(product_id,location_id,min_stock_milli,critical_stock_milli,reorder_target_milli,max_stock_milli) VALUES (?,?,?,?,?,?)
    ON CONFLICT(product_id,location_id) DO UPDATE SET min_stock_milli=excluded.min_stock_milli, critical_stock_milli=excluded.critical_stock_milli, reorder_target_milli=excluded.reorder_target_milli, max_stock_milli=excluded.max_stock_milli`)
    .run(productId, locationId, min, crit, tgt, max);
  audit(c, 'SET_THRESHOLDS', 'products', productId, null, { locationId, ...t });
}
