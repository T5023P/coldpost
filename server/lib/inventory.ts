import { all, get, insert, run, tx } from '../db.js';
import { ApiError } from './http.js';

export type MovementType =
  | 'receive'
  | 'reserve'
  | 'release'
  | 'consume'
  | 'damage'
  | 'reject'
  | 'adjust'
  | 'transfer_out'
  | 'transfer_in'
  | 'return';

export interface MovementInput {
  productId: number;
  locationId: number;
  type: MovementType;
  qty: number;
  refType?: string;
  refId?: number | null;
  reason?: string;
  userId?: number | null;
  transferGroup?: string | null;
  allowNegative?: boolean;
}

function ensureRow(productId: number, locationId: number) {
  const existing = get<{ id: number; qty_available: number; qty_reserved: number; qty_damaged: number }>(
    'SELECT * FROM inventory WHERE product_id = ? AND location_id = ?',
    productId,
    locationId,
  );
  if (existing) return existing;
  insert('inventory', { product_id: productId, location_id: locationId, qty_available: 0, qty_reserved: 0, qty_damaged: 0 });
  return get<{ id: number; qty_available: number; qty_reserved: number; qty_damaged: number }>(
    'SELECT * FROM inventory WHERE product_id = ? AND location_id = ?',
    productId,
    locationId,
  )!;
}

/**
 * Applies a stock movement and writes the ledger row. Never update inventory
 * without going through this function — every change must be auditable.
 */
export function applyMovement(input: MovementInput): number {
  const qty = Math.trunc(input.qty);
  if (!Number.isFinite(qty) || qty === 0) throw new ApiError(400, 'Quantity must be a non-zero number');
  if (!['adjust', 'receive', 'return', 'transfer_in'].includes(input.type) && qty < 0) {
    throw new ApiError(400, 'Quantity must be positive for this movement type');
  }
  return tx(() => {
    const row = ensureRow(input.productId, input.locationId);
    let available = row.qty_available;
    let reserved = row.qty_reserved;
    let damaged = row.qty_damaged;
    const magnitude = Math.abs(qty);

    switch (input.type) {
      case 'receive':
      case 'transfer_in':
      case 'return':
        available += magnitude;
        break;
      case 'reserve': {
        if (available < magnitude && !input.allowNegative) {
          throw new ApiError(409, `Not enough available stock at this location (${available} available, ${magnitude} requested)`);
        }
        available -= magnitude;
        reserved += magnitude;
        break;
      }
      case 'release':
        reserved = Math.max(0, reserved - magnitude);
        available += magnitude;
        break;
      case 'consume': {
        const fromReserved = Math.min(reserved, magnitude);
        reserved -= fromReserved;
        const remainder = magnitude - fromReserved;
        if (available < remainder && !input.allowNegative) {
          throw new ApiError(409, `Not enough stock to consume (${available + fromReserved} available, ${magnitude} needed)`);
        }
        available -= remainder;
        break;
      }
      case 'damage':
        available -= magnitude;
        damaged += magnitude;
        break;
      case 'reject':
        available -= magnitude;
        break;
      case 'transfer_out':
        if (available < magnitude && !input.allowNegative) {
          throw new ApiError(409, `Not enough stock to transfer (${available} available)`);
        }
        available -= magnitude;
        break;
      case 'adjust':
        available += qty;
        break;
    }

    if (available < 0 && !input.allowNegative) {
      throw new ApiError(409, 'This movement would make available stock negative');
    }
    if (damaged < 0) damaged = 0;

    run(
      "UPDATE inventory SET qty_available = ?, qty_reserved = ?, qty_damaged = ?, updated_at = datetime('now') WHERE id = ?",
      available,
      reserved,
      damaged,
      row.id,
    );
    return insert('inventory_movements', {
      product_id: input.productId,
      location_id: input.locationId,
      type: input.type,
      qty: input.type === 'adjust' ? qty : magnitude,
      balance_available: available,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
      reason: input.reason ?? null,
      user_id: input.userId ?? null,
      transfer_group: input.transferGroup ?? null,
    });
  });
}

export function stockAt(productId: number, locationId: number) {
  return get<{ qty_available: number; qty_reserved: number; qty_damaged: number }>(
    'SELECT qty_available, qty_reserved, qty_damaged FROM inventory WHERE product_id = ? AND location_id = ?',
    productId,
    locationId,
  ) ?? { qty_available: 0, qty_reserved: 0, qty_damaged: 0 };
}

export function totalStock(productId: number) {
  return get<{ available: number; reserved: number; damaged: number; incoming: number }>(
    `SELECT COALESCE(SUM(qty_available),0) AS available,
            COALESCE(SUM(qty_reserved),0) AS reserved,
            COALESCE(SUM(qty_damaged),0) AS damaged,
            COALESCE((SELECT SUM(i.qty_requested - i.qty_received - i.qty_rejected)
                      FROM purchase_order_items i
                      JOIN purchase_orders p ON p.id = i.purchase_order_id
                      WHERE i.product_id = ? AND p.status IN ('draft','sent','partial')),0) AS incoming
     FROM inventory WHERE product_id = ?`,
    productId,
    productId,
  )!;
}

export function lowStockProducts() {
  return all(
    `SELECT p.id, p.sku, p.name, p.min_stock, COALESCE(SUM(i.qty_available),0) AS available
     FROM products p LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.active = 1
     GROUP BY p.id
     HAVING available <= p.min_stock
     ORDER BY available ASC, p.name ASC`,
  );
}

export function transferStock(input: {
  productId: number;
  fromLocationId: number;
  toLocationId: number;
  qty: number;
  note?: string;
  userId?: number | null;
}) {
  if (input.fromLocationId === input.toLocationId) throw new ApiError(400, 'Source and destination must differ');
  if (input.qty <= 0) throw new ApiError(400, 'Transfer quantity must be positive');
  const group = `TRF-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return tx(() => {
    const out = applyMovement({
      productId: input.productId,
      locationId: input.fromLocationId,
      type: 'transfer_out',
      qty: input.qty,
      reason: input.note ?? 'Stock transfer',
      userId: input.userId,
      transferGroup: group,
      refType: 'transfer',
    });
    const inn = applyMovement({
      productId: input.productId,
      locationId: input.toLocationId,
      type: 'transfer_in',
      qty: input.qty,
      reason: input.note ?? 'Stock transfer',
      userId: input.userId,
      transferGroup: group,
      refType: 'transfer',
    });
    return { group, out, inn };
  });
}
