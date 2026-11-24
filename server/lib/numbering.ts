import { get, run } from '../db.js';
import { getSetting } from './settings.js';

type Kind = 'order' | 'quotation' | 'purchase' | 'work';

function prefixFor(kind: Kind) {
  const n = getSetting('numbering');
  switch (kind) {
    case 'order':
      return n.orderPrefix || 'CP';
    case 'quotation':
      return n.quotationPrefix || 'QT';
    case 'purchase':
      return n.purchasePrefix || 'PO';
    case 'work':
      return 'WO';
  }
}

/** Existing table/column that owns each reference, used to skip collisions. */
function refTarget(kind: Kind) {
  switch (kind) {
    case 'purchase':
      return { table: 'purchase_orders', column: 'ref' };
    case 'work':
      return { table: 'work_orders', column: 'ref' };
    case 'quotation':
      return { table: 'orders', column: 'quotation_number' };
    default:
      return { table: 'orders', column: 'ref' };
  }
}

/**
 * Generates a reference like CP-2026-0001.
 *
 * The candidate is checked against records that may have been created without
 * consuming a sequence (seeded demo data, imported books), so a collision can
 * never abort an order.
 */
export function nextRef(kind: Kind, date = new Date()): string {
  const n = getSetting('numbering');
  const prefix = prefixFor(kind);
  const year = date.getFullYear();
  const sequenceKey = `${kind}:${prefix}:${year}`;
  const row = get<{ next_value: number }>('SELECT next_value FROM number_sequences WHERE key = ?', sequenceKey);
  const padding = Math.max(2, Math.min(8, Number(n.padding) || 4));
  const build = (value: number) => {
    const seq = String(value).padStart(padding, '0');
    return n.includeYear === false ? `${prefix}-${seq}` : `${prefix}-${year}-${seq}`;
  };
  const target = refTarget(kind);

  let value = row?.next_value ?? 1;
  let ref = build(value);
  for (let guard = 0; guard < 10000; guard += 1) {
    const taken = get(`SELECT 1 AS x FROM ${target.table} WHERE ${target.column} = ? LIMIT 1`, ref);
    if (!taken) break;
    value += 1;
    ref = build(value);
  }

  if (row) run('UPDATE number_sequences SET next_value = ? WHERE key = ?', value + 1, sequenceKey);
  else run('INSERT INTO number_sequences (key, next_value) VALUES (?, ?)', sequenceKey, value + 1);
  return ref;
}

export function peekNextRef(kind: Kind, date = new Date()): string {
  const n = getSetting('numbering');
  const prefix = prefixFor(kind);
  const year = date.getFullYear();
  const row = get<{ next_value: number }>('SELECT next_value FROM number_sequences WHERE key = ?', `${kind}:${prefix}:${year}`);
  const padding = Math.max(2, Math.min(8, Number(n.padding) || 4));
  const seq = String(row?.next_value ?? 1).padStart(padding, '0');
  return n.includeYear === false ? `${prefix}-${seq}` : `${prefix}-${year}-${seq}`;
}
