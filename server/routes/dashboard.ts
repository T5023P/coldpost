import { Router } from 'express';
import { all, get } from '../db.js';
import { asyncHandler, dateRange, todayIso } from '../lib/http.js';
import { recentActivity } from '../lib/audit.js';
import { lowStockProducts } from '../lib/inventory.js';

export const dashboardRouter = Router();

function whereDate(from: string | null, to: string | null, column = 'o.order_date') {
  const clauses: string[] = [];
  const params: any[] = [];
  if (from) {
    clauses.push(`${column} >= ?`);
    params.push(from);
  }
  if (to) {
    clauses.push(`${column} <= ?`);
    params.push(to);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

dashboardRouter.get(
  '/',
  asyncHandler((req, res) => {
    const { from, to } = dateRange(req.query as Record<string, unknown>);
    const filter = whereDate(from, to);
    const rows = all<{ status: string; c: number; value: number; est: number; act: number }>(
      `SELECT o.status, COUNT(*) AS c, COALESCE(SUM(o.total_value_paise),0) AS value,
              COALESCE(SUM(o.estimated_cost_paise),0) AS est, COALESCE(SUM(o.actual_cost_paise),0) AS act
       FROM orders o WHERE o.status <> 'cancelled' ${filter.sql} GROUP BY o.status`,
      ...filter.params,
    );
    const byStatus: Record<string, number> = {};
    let totalValue = 0;
    let estimated = 0;
    let actual = 0;
    for (const row of rows) {
      byStatus[row.status] = row.c;
      totalValue += row.value;
      estimated += row.est;
      actual += row.act;
    }
    const countOf = (...statuses: string[]) => statuses.reduce((sum, s) => sum + (byStatus[s] ?? 0), 0);

    const today = todayIso();
    const delayed = get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM orders o WHERE o.status NOT IN ('delivered','closed','cancelled')
       AND o.target_delivery_date IS NOT NULL AND o.target_delivery_date < ? ${filter.sql}`,
      today,
      ...filter.params,
    )!.c;

    const itemsAwaitingReceipt = get<{ c: number }>(
      `SELECT COUNT(DISTINCT p.order_id) AS c FROM purchase_orders p
       WHERE p.status IN ('sent','partial') AND p.order_id IS NOT NULL`,
    )!.c;

    const lowStock = lowStockProducts();
    const supplierPerformance = all<any>(
      `SELECT s.id, s.name, COUNT(p.id) AS po_count,
              COALESCE(SUM(CASE WHEN p.status = 'received' THEN 1 ELSE 0 END),0) AS received_count,
              COALESCE(SUM(CASE WHEN p.actual_delivery IS NOT NULL AND p.expected_delivery IS NOT NULL
                                AND p.actual_delivery <= p.expected_delivery THEN 1 ELSE 0 END),0) AS on_time_count,
              COALESCE(AVG(s.quality_rating),0) AS quality_rating,
              COALESCE(SUM(p.total_paise),0) AS spend_paise
       FROM suppliers s LEFT JOIN purchase_orders p ON p.supplier_id = s.id
       GROUP BY s.id ORDER BY po_count DESC, s.name LIMIT 8`,
    );
    const campaignBreakdown = all<any>(
      `SELECT o.campaign_type, COUNT(*) AS count,
              COALESCE(SUM(o.total_value_paise),0) AS value_paise,
              COALESCE(SUM(o.actual_cost_paise),0) AS cost_paise
       FROM orders o WHERE o.status <> 'cancelled' ${filter.sql}
       GROUP BY o.campaign_type ORDER BY value_paise DESC`,
      ...filter.params,
    );
    const monthly = all<any>(
      `SELECT substr(o.order_date,1,7) AS month, COUNT(*) AS orders,
              COALESCE(SUM(o.total_value_paise),0) AS value_paise,
              COALESCE(SUM(o.estimated_cost_paise),0) AS estimated_paise,
              COALESCE(SUM(o.actual_cost_paise),0) AS actual_paise
       FROM orders o WHERE o.status <> 'cancelled' ${filter.sql}
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      ...filter.params,
    ).reverse();

    const recentOrders = all<any>(
      `SELECT o.id, o.ref, o.campaign_name, o.status, o.total_value_paise, o.order_date, c.company_name, o.target_delivery_date
       FROM orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY o.id DESC LIMIT 6`,
    );
    const shipmentsInMotion = all<any>(
      `SELECT s.id, s.awb, s.courier_name, s.status, s.shipment_date, r.name AS recipient_name, o.ref AS order_ref
       FROM shipments s JOIN recipients r ON r.id = s.recipient_id JOIN orders o ON o.id = s.order_id
       WHERE s.status IN ('booked','dispatched','in_transit','out_for_delivery','exception')
       ORDER BY s.id DESC LIMIT 8`,
    );
    const qcQueue = get<{ c: number }>("SELECT COUNT(*) AS c FROM recipients WHERE status IN ('qc_pending','qc_failed','rework')")!.c;
    const advancePending = all<any>(
      `SELECT o.id, o.ref, o.campaign_name, o.total_value_paise, o.advance_received_paise, c.company_name
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.advance_received_paise < o.total_value_paise * 0.5
         AND o.status NOT IN ('draft','quotation','cancelled','closed','delivered')
       ORDER BY o.id DESC LIMIT 5`,
    );

    res.json({
      range: { from, to },
      cards: {
        totalOrders: Object.values(byStatus).reduce((a, b) => a + b, 0),
        newOrders: countOf('draft', 'quotation'),
        awaitingApproval: countOf('awaiting_approval'),
        awaitingProcurement: countOf('confirmed', 'procurement'),
        itemsAwaitingReceipt,
        inAssembly: countOf('assembly_queued', 'assembling'),
        awaitingQc: countOf('qc_pending'),
        qcQueue,
        readyForDispatch: countOf('qc_passed', 'packed', 'ready_to_dispatch'),
        inTransit: countOf('shipment_booked', 'dispatched', 'in_transit'),
        delivered: countOf('delivered', 'closed'),
        delayed,
        totalValuePaise: totalValue,
        estimatedCostPaise: estimated,
        actualCostPaise: actual,
        estimatedProfitPaise: totalValue - estimated,
        actualProfitPaise: totalValue - actual,
        lowStockCount: lowStock.length,
      },
      byStatus,
      campaignBreakdown,
      monthly,
      lowStock: lowStock.slice(0, 6),
      supplierPerformance,
      recentOrders,
      shipmentsInMotion,
      advancePending,
      recentActivity: recentActivity(14),
    });
  }),
);
