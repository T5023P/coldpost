import { all, get, run } from '../db.js';
import { getSetting } from './settings.js';

export interface CostBreakdown {
  bomEstimatedPaise: number;
  productActualPaise: number;
  costItems: { category: string; estimatedPaise: number; actualPaise: number }[];
  shippingEstimatedPaise: number;
  shippingActualPaise: number;
  paymentFeeEstimatedPaise: number;
  paymentFeeActualPaise: number;
  estimatedTotalPaise: number;
  actualTotalPaise: number;
  sellingPricePaise: number;
  grossProfitEstimatedPaise: number;
  grossProfitActualPaise: number;
  marginEstimatedPct: number;
  marginActualPct: number;
  variancePaise: number;
  perPackageEstimatedPaise: number;
  perPackageActualPaise: number;
  lossMaking: boolean;
  lowMargin: boolean;
  recipientCount: number;
}

/**
 * Single source of truth for order costing. Estimated product cost comes from
 * the BOM; actual product cost from received purchase-order quantities.
 */
export function orderCostBreakdown(orderId: number): CostBreakdown {
  const order = get<{ total_value_paise: number; quotation_amount_paise: number; recipient_count: number }>(
    'SELECT total_value_paise, quotation_amount_paise, recipient_count FROM orders WHERE id = ?',
    orderId,
  );
  const recipientCount = order?.recipient_count ?? 0;
  const selling = order?.total_value_paise || order?.quotation_amount_paise || 0;

  const bomEstimated = get<{ total: number }>(
    'SELECT COALESCE(SUM(total_qty * unit_cost_paise),0) AS total FROM bom_items WHERE order_id = ?',
    orderId,
  )!.total;

  const costRows = all<{ category: string; estimated_paise: number; actual_paise: number }>(
    `SELECT category, COALESCE(SUM(estimated_paise),0) AS estimated_paise, COALESCE(SUM(actual_paise),0) AS actual_paise
     FROM order_cost_items WHERE order_id = ? GROUP BY category ORDER BY category`,
    orderId,
  );

  const poActual = get<{ total: number }>(
    `SELECT COALESCE(SUM(i.qty_received * i.unit_price_paise),0) AS total
     FROM purchase_order_items i
     JOIN purchase_orders p ON p.id = i.purchase_order_id
     WHERE p.order_id = ? AND p.status <> 'cancelled'`,
    orderId,
  )!.total;

  const shippingActual = get<{ total: number }>(
    "SELECT COALESCE(SUM(cost_paise),0) AS total FROM shipments WHERE order_id = ? AND status NOT IN ('cancelled','test_only')",
    orderId,
  )!.total;

  const costing = getSetting('costing');
  let shippingEstimated = 0;
  for (const row of costRows) if (row.category === 'shipping') shippingEstimated += row.estimated_paise;
  if (shippingEstimated === 0) shippingEstimated = recipientCount * (costing.defaultShippingPerPackagePaise || 0);

  const manualEstimated = costRows.reduce((sum, r) => (r.category === 'shipping' ? sum : sum + r.estimated_paise), 0);
  const manualActual = costRows.reduce((sum, r) => (r.category === 'shipping' ? sum : sum + r.actual_paise), 0);

  const feePct = Number(costing.paymentFeePct) || 0;
  const feeEstimated = Math.round((selling * feePct) / 100);
  const productActual = poActual;

  const estimatedTotal = bomEstimated + manualEstimated + shippingEstimated + feeEstimated;
  const actualTotal = productActual + manualActual + shippingActual + (feeEstimated || 0);

  const profitEstimated = selling - estimatedTotal;
  const profitActual = selling - actualTotal;
  const marginEstimated = selling > 0 ? (profitEstimated / selling) * 100 : 0;
  const marginActual = selling > 0 ? (profitActual / selling) * 100 : 0;

  return {
    bomEstimatedPaise: bomEstimated,
    productActualPaise: productActual,
    costItems: costRows.map((r) => ({
      category: r.category,
      estimatedPaise: r.estimated_paise,
      actualPaise: r.actual_paise,
    })),
    shippingEstimatedPaise: shippingEstimated,
    shippingActualPaise: shippingActual,
    paymentFeeEstimatedPaise: feeEstimated,
    paymentFeeActualPaise: feeEstimated,
    estimatedTotalPaise: estimatedTotal,
    actualTotalPaise: actualTotal,
    sellingPricePaise: selling,
    grossProfitEstimatedPaise: profitEstimated,
    grossProfitActualPaise: profitActual,
    marginEstimatedPct: Math.round(marginEstimated * 10) / 10,
    marginActualPct: Math.round(marginActual * 10) / 10,
    variancePaise: actualTotal - estimatedTotal,
    perPackageEstimatedPaise: recipientCount > 0 ? Math.round(estimatedTotal / recipientCount) : 0,
    perPackageActualPaise: recipientCount > 0 ? Math.round(actualTotal / recipientCount) : 0,
    lossMaking: selling > 0 && profitActual < 0,
    lowMargin: selling > 0 && profitActual >= 0 && marginActual < 10,
    recipientCount,
  };
}

export function syncOrderCosts(orderId: number) {
  const { estimatedTotalPaise, actualTotalPaise, lossMaking } = orderCostBreakdown(orderId);
  run('UPDATE orders SET estimated_cost_paise = ?, actual_cost_paise = ?, updated_at = datetime(\'now\') WHERE id = ?', estimatedTotalPaise, actualTotalPaise, orderId);
  return { estimatedTotalPaise, actualTotalPaise, lossMaking };
}
