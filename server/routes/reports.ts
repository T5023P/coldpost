import { Router } from 'express';
import { all } from '../db.js';
import { asyncHandler, dateRange, sendCsv } from '../lib/http.js';
import { csv } from '../lib/http.js';
import { CAMPAIGN_TYPE_LABEL, ORDER_STATUS_LABEL } from '../lib/statuses.js';

export const reportsRouter = Router();

type Column = { key: string; label: string; kind?: 'currency' | 'number' | 'percent' | 'date' | 'text' };

interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  columns: Column[];
  summary?: Column[];
  run: (from: string | null, to: string | null) => { rows: any[]; summary?: Record<string, any> };
}

const rupees = (paise: number | null | undefined) => Math.round(((paise ?? 0) / 100) * 100) / 100;

const defs: ReportDefinition[] = [
  {
    key: 'orders-by-campaign',
    title: 'Orders by campaign type',
    description: 'Volume, revenue and profitability for each campaign type.',
    columns: [
      { key: 'campaign_type', label: 'Campaign type' },
      { key: 'orders', label: 'Orders', kind: 'number' },
      { key: 'packages', label: 'Packages', kind: 'number' },
      { key: 'revenue', label: 'Revenue (INR)', kind: 'currency' },
      { key: 'actual_cost', label: 'Actual cost (INR)', kind: 'currency' },
      { key: 'profit', label: 'Actual profit (INR)', kind: 'currency' },
      { key: 'margin_pct', label: 'Margin %', kind: 'percent' },
    ],
    run: (from, to) => {
      const params: any[] = [];
      let filter = "WHERE o.status <> 'cancelled'";
      if (from) {
        filter += ' AND o.order_date >= ?';
        params.push(from);
      }
      if (to) {
        filter += ' AND o.order_date <= ?';
        params.push(to);
      }
      const rows = all<any>(
        `SELECT o.campaign_type, COUNT(*) AS orders,
                COALESCE(SUM(o.recipient_count),0) AS packages,
                COALESCE(SUM(o.total_value_paise),0) AS revenue_paise,
                COALESCE(SUM(o.actual_cost_paise),0) AS cost_paise
         FROM orders o ${filter} GROUP BY o.campaign_type ORDER BY revenue_paise DESC`,
        ...params,
      ).map((r) => ({
        campaign_type: CAMPAIGN_TYPE_LABEL[r.campaign_type] ?? r.campaign_type,
        orders: r.orders,
        packages: r.packages,
        revenue: rupees(r.revenue_paise),
        actual_cost: rupees(r.cost_paise),
        profit: rupees(r.revenue_paise - r.cost_paise),
        margin_pct: r.revenue_paise ? Math.round(((r.revenue_paise - r.cost_paise) / r.revenue_paise) * 1000) / 10 : 0,
      }));
      return { rows };
    },
  },
  {
    key: 'revenue',
    title: 'Revenue by month',
    description: 'Order value, advances collected and outstanding balance.',
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'orders', label: 'Orders', kind: 'number' },
      { key: 'revenue', label: 'Order value (INR)', kind: 'currency' },
      { key: 'advance', label: 'Advance received (INR)', kind: 'currency' },
      { key: 'balance', label: 'Balance due (INR)', kind: 'currency' },
    ],
    run: (from, to) => {
      const params: any[] = [];
      let filter = "WHERE o.status <> 'cancelled'";
      if (from) {
        filter += ' AND o.order_date >= ?';
        params.push(from);
      }
      if (to) {
        filter += ' AND o.order_date <= ?';
        params.push(to);
      }
      const rows = all<any>(
        `SELECT substr(o.order_date,1,7) AS month, COUNT(*) AS orders,
                COALESCE(SUM(o.total_value_paise),0) AS revenue_paise,
                COALESCE(SUM(o.advance_received_paise),0) AS advance_paise
         FROM orders o ${filter} GROUP BY month ORDER BY month DESC`,
        ...params,
      ).map((r) => ({
        month: r.month,
        orders: r.orders,
        revenue: rupees(r.revenue_paise),
        advance: rupees(r.advance_paise),
        balance: rupees(r.revenue_paise - r.advance_paise),
      }));
      return { rows };
    },
  },
  {
    key: 'costs',
    title: 'Order costs & variance',
    description: 'Estimated versus actual cost per order.',
    columns: [
      { key: 'ref', label: 'Order' },
      { key: 'company_name', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'estimated', label: 'Estimated cost (INR)', kind: 'currency' },
      { key: 'actual', label: 'Actual cost (INR)', kind: 'currency' },
      { key: 'variance', label: 'Variance (INR)', kind: 'currency' },
    ],
    run: (from, to) => {
      const params: any[] = [];
      let filter = "WHERE o.status <> 'cancelled'";
      if (from) {
        filter += ' AND o.order_date >= ?';
        params.push(from);
      }
      if (to) {
        filter += ' AND o.order_date <= ?';
        params.push(to);
      }
      const rows = all<any>(
        `SELECT o.ref, c.company_name, o.status, o.estimated_cost_paise, o.actual_cost_paise
         FROM orders o JOIN customers c ON c.id = o.customer_id ${filter} ORDER BY o.order_date DESC`,
        ...params,
      ).map((r) => ({
        ref: r.ref,
        company_name: r.company_name,
        status: ORDER_STATUS_LABEL[r.status] ?? r.status,
        estimated: rupees(r.estimated_cost_paise),
        actual: rupees(r.actual_cost_paise),
        variance: rupees(r.actual_cost_paise - r.estimated_cost_paise),
      }));
      return { rows };
    },
  },
  {
    key: 'profit',
    title: 'Actual profit by order',
    description: 'Revenue, actual cost and margin per campaign.',
    columns: [
      { key: 'ref', label: 'Order' },
      { key: 'company_name', label: 'Customer' },
      { key: 'revenue', label: 'Revenue (INR)', kind: 'currency' },
      { key: 'actual_cost', label: 'Actual cost (INR)', kind: 'currency' },
      { key: 'profit', label: 'Profit (INR)', kind: 'currency' },
      { key: 'margin_pct', label: 'Margin %', kind: 'percent' },
    ],
    run: (from, to) => {
      const params: any[] = [];
      let filter = "WHERE o.status <> 'cancelled'";
      if (from) {
        filter += ' AND o.order_date >= ?';
        params.push(from);
      }
      if (to) {
        filter += ' AND o.order_date <= ?';
        params.push(to);
      }
      const rows = all<any>(
        `SELECT o.ref, c.company_name, o.total_value_paise, o.actual_cost_paise
         FROM orders o JOIN customers c ON c.id = o.customer_id ${filter} ORDER BY (o.total_value_paise - o.actual_cost_paise) ASC`,
        ...params,
      ).map((r) => ({
        ref: r.ref,
        company_name: r.company_name,
        revenue: rupees(r.total_value_paise),
        actual_cost: rupees(r.actual_cost_paise),
        profit: rupees(r.total_value_paise - r.actual_cost_paise),
        margin_pct: r.total_value_paise ? Math.round(((r.total_value_paise - r.actual_cost_paise) / r.total_value_paise) * 1000) / 10 : 0,
      }));
      const totalProfit = rows.reduce((s, r) => s + r.profit, 0);
      return { rows, summary: { orders: rows.length, profit: totalProfit } };
    },
  },
  {
    key: 'turnaround',
    title: 'Order turnaround time',
    description: 'Days from confirmation to delivery.',
    columns: [
      { key: 'ref', label: 'Order' },
      { key: 'company_name', label: 'Customer' },
      { key: 'confirmed_at', label: 'Confirmed', kind: 'date' },
      { key: 'delivered_at', label: 'Delivered', kind: 'date' },
      { key: 'days', label: 'Days', kind: 'number' },
    ],
    run: (from, to) => {
      const params: any[] = [];
      let filter = "WHERE o.status IN ('delivered','closed')";
      if (from) {
        filter += ' AND o.order_date >= ?';
        params.push(from);
      }
      if (to) {
        filter += ' AND o.order_date <= ?';
        params.push(to);
      }
      const rows = all<any>(
        `SELECT o.ref, c.company_name, o.confirmed_at, o.closed_at,
                (SELECT MAX(r.delivered_at) FROM recipients r WHERE r.order_id = o.id) AS delivered_at
         FROM orders o JOIN customers c ON c.id = o.customer_id ${filter} ORDER BY o.id DESC`,
        ...params,
      ).map((r) => {
        const delivered = r.delivered_at ?? r.closed_at;
        const days = r.confirmed_at && delivered
          ? Math.max(1, Math.round((new Date(delivered).getTime() - new Date(r.confirmed_at).getTime()) / 86400000))
          : null;
        return { ref: r.ref, company_name: r.company_name, confirmed_at: r.confirmed_at, delivered_at: delivered, days };
      });
      const withDays = rows.filter((r) => r.days !== null);
      const avg = withDays.length ? Math.round(withDays.reduce((s, r) => s + (r.days ?? 0), 0) / withDays.length) : 0;
      return { rows, summary: { average_days: avg, orders: rows.length } };
    },
  },
  {
    key: 'delayed',
    title: 'Delayed orders',
    description: 'Orders past their target delivery date that are not yet delivered.',
    columns: [
      { key: 'ref', label: 'Order' },
      { key: 'company_name', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'target_delivery_date', label: 'Target date', kind: 'date' },
      { key: 'days_late', label: 'Days late', kind: 'number' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT o.ref, c.company_name, o.status, o.target_delivery_date,
                CAST(julianday('now') - julianday(o.target_delivery_date) AS INTEGER) AS days_late
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.status NOT IN ('delivered','closed','cancelled')
           AND o.target_delivery_date IS NOT NULL AND o.target_delivery_date < date('now')
         ORDER BY days_late DESC`,
      ).map((r) => ({ ...r, status: ORDER_STATUS_LABEL[r.status] ?? r.status }));
      return { rows, summary: { delayed_orders: rows.length } };
    },
  },
  {
    key: 'supplier-performance',
    title: 'Supplier performance',
    description: 'Spend, on-time delivery and quality rating per supplier.',
    columns: [
      { key: 'name', label: 'Supplier' },
      { key: 'city_name', label: 'City' },
      { key: 'po_count', label: 'Purchase orders', kind: 'number' },
      { key: 'spend', label: 'Spend (INR)', kind: 'currency' },
      { key: 'on_time_pct', label: 'On-time %', kind: 'percent' },
      { key: 'quality_rating', label: 'Quality rating', kind: 'number' },
      { key: 'lead_time_days', label: 'Lead time (days)', kind: 'number' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT s.name, c.name AS city_name, s.quality_rating, s.lead_time_days,
                COUNT(p.id) AS po_count,
                COALESCE(SUM(p.total_paise),0) AS spend_paise,
                SUM(CASE WHEN p.actual_delivery IS NOT NULL AND p.expected_delivery IS NOT NULL AND p.actual_delivery <= p.expected_delivery THEN 1 ELSE 0 END) AS on_time,
                SUM(CASE WHEN p.actual_delivery IS NOT NULL THEN 1 ELSE 0 END) AS delivered
         FROM suppliers s LEFT JOIN cities c ON c.id = s.city_id LEFT JOIN purchase_orders p ON p.supplier_id = s.id
         GROUP BY s.id ORDER BY spend_paise DESC`,
      ).map((r) => ({
        name: r.name,
        city_name: r.city_name ?? '—',
        po_count: r.po_count,
        spend: rupees(r.spend_paise),
        on_time_pct: r.delivered ? Math.round((r.on_time / r.delivered) * 100) : 0,
        quality_rating: r.quality_rating ?? 0,
        lead_time_days: r.lead_time_days ?? 0,
      }));
      return { rows };
    },
  },
  {
    key: 'inventory-usage',
    title: 'Inventory usage',
    description: 'Received, reserved, consumed, damaged and on-hand quantities by product.',
    columns: [
      { key: 'name', label: 'Product' },
      { key: 'sku', label: 'SKU' },
      { key: 'received', label: 'Received', kind: 'number' },
      { key: 'consumed', label: 'Consumed', kind: 'number' },
      { key: 'damaged', label: 'Damaged', kind: 'number' },
      { key: 'adjusted', label: 'Adjustments', kind: 'number' },
      { key: 'on_hand', label: 'On hand', kind: 'number' },
    ],
    run: (from, to) => {
      const clauses: string[] = [];
      const params: any[] = [];
      if (from) {
        clauses.push('m.created_at >= ?');
        params.push(from);
      }
      if (to) {
        clauses.push("m.created_at <= date(? || ' 23:59:59')");
        params.push(to);
      }
      const filter = clauses.length ? `AND ${clauses.join(' AND ')}` : '';
      const rows = all<any>(
        `SELECT p.name, p.sku,
                COALESCE(SUM(CASE WHEN m.type IN ('receive','transfer_in','return') THEN ABS(m.qty) ELSE 0 END),0) AS received,
                COALESCE(SUM(CASE WHEN m.type = 'consume' THEN ABS(m.qty) ELSE 0 END),0) AS consumed,
                COALESCE(SUM(CASE WHEN m.type IN ('damage','reject') THEN ABS(m.qty) ELSE 0 END),0) AS damaged,
                COALESCE(SUM(CASE WHEN m.type = 'adjust' THEN m.qty ELSE 0 END),0) AS adjusted,
                COALESCE((SELECT SUM(i.qty_available) FROM inventory i WHERE i.product_id = p.id),0) AS on_hand
         FROM products p LEFT JOIN inventory_movements m ON m.product_id = p.id ${filter}
         GROUP BY p.id ORDER BY p.name`,
        ...params,
      );
      return { rows };
    },
  },
  {
    key: 'rejected-products',
    title: 'Rejected products',
    description: 'Quantities rejected at goods receipt, by supplier and purchase order.',
    columns: [
      { key: 'ref', label: 'PO' },
      { key: 'supplier_name', label: 'Supplier' },
      { key: 'product_name', label: 'Product' },
      { key: 'qty_requested', label: 'Ordered', kind: 'number' },
      { key: 'qty_rejected', label: 'Rejected', kind: 'number' },
      { key: 'value', label: 'Value (INR)', kind: 'currency' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT p.ref, s.name AS supplier_name, COALESCE(pr.name, i.description, 'Item') AS product_name,
                i.qty_requested, i.qty_rejected, i.unit_price_paise
         FROM purchase_order_items i
         JOIN purchase_orders p ON p.id = i.purchase_order_id
         JOIN suppliers s ON s.id = p.supplier_id
         LEFT JOIN products pr ON pr.id = i.product_id
         WHERE i.qty_rejected > 0 ORDER BY i.qty_rejected DESC`,
      ).map((r) => ({ ...r, value: rupees(r.qty_rejected * r.unit_price_paise) }));
      return { rows };
    },
  },
  {
    key: 'qc-failure',
    title: 'QC failure rate',
    description: 'Inspections and failures per package.',
    columns: [
      { key: 'order_ref', label: 'Order' },
      { key: 'recipient_name', label: 'Package' },
      { key: 'inspections', label: 'Inspections', kind: 'number' },
      { key: 'failures', label: 'Failures', kind: 'number' },
      { key: 'pass_rate_pct', label: 'Pass rate %', kind: 'percent' },
      { key: 'last_status', label: 'Last result' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT o.ref AS order_ref, r.name AS recipient_name,
                COUNT(q.id) AS inspections,
                SUM(CASE WHEN q.status <> 'passed' THEN 1 ELSE 0 END) AS failures,
                (SELECT status FROM qc_inspections q2 WHERE q2.recipient_id = r.id ORDER BY q2.id DESC LIMIT 1) AS last_status
         FROM qc_inspections q JOIN recipients r ON r.id = q.recipient_id JOIN orders o ON o.id = q.order_id
         GROUP BY r.id ORDER BY failures DESC, inspections DESC`,
      ).map((r) => ({
        ...r,
        pass_rate_pct: r.inspections ? Math.round(((r.inspections - r.failures) / r.inspections) * 100) : 0,
      }));
      const total = rows.reduce((s, r) => s + r.inspections, 0);
      const failures = rows.reduce((s, r) => s + r.failures, 0);
      return { rows, summary: { inspections: total, failures, failure_rate_pct: total ? Math.round((failures / total) * 1000) / 10 : 0 } };
    },
  },
  {
    key: 'courier-performance',
    title: 'Courier performance',
    description: 'Shipments, deliveries and exceptions by courier.',
    columns: [
      { key: 'courier_name', label: 'Courier' },
      { key: 'shipments', label: 'Shipments', kind: 'number' },
      { key: 'delivered', label: 'Delivered', kind: 'number' },
      { key: 'exceptions', label: 'Exceptions', kind: 'number' },
      { key: 'delivery_rate_pct', label: 'Delivery rate %', kind: 'percent' },
      { key: 'avg_days', label: 'Avg days', kind: 'number' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT COALESCE(NULLIF(courier_name,''), 'Unspecified') AS courier_name, COUNT(*) AS shipments,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
                SUM(CASE WHEN status IN ('exception','returned') THEN 1 ELSE 0 END) AS exceptions,
                AVG(CASE WHEN delivered_at IS NOT NULL AND shipment_date IS NOT NULL
                         THEN julianday(delivered_at) - julianday(shipment_date) END) AS avg_days
         FROM shipments WHERE is_test = 0 AND status <> 'cancelled' AND status <> 'test_only'
         GROUP BY courier_name ORDER BY shipments DESC`,
      ).map((r) => ({
        courier_name: r.courier_name,
        shipments: r.shipments,
        delivered: r.delivered,
        exceptions: r.exceptions,
        delivery_rate_pct: r.shipments ? Math.round((r.delivered / r.shipments) * 100) : 0,
        avg_days: r.avg_days ? Math.round(r.avg_days * 10) / 10 : 0,
      }));
      return { rows };
    },
  },
  {
    key: 'feedback',
    title: 'Customer feedback',
    description: 'Ratings and comments recorded after delivery.',
    columns: [
      { key: 'order_ref', label: 'Order' },
      { key: 'company_name', label: 'Customer' },
      { key: 'rating', label: 'Rating', kind: 'number' },
      { key: 'delivery_confirmed', label: 'Delivery confirmed' },
      { key: 'comments', label: 'Comments' },
      { key: 'repeat_interest', label: 'Repeat interest' },
      { key: 'created_at', label: 'Recorded', kind: 'date' },
    ],
    run: () => {
      const rows = all<any>(
        `SELECT o.ref AS order_ref, c.company_name, f.rating,
                CASE WHEN f.delivery_confirmed = 1 THEN 'Yes' ELSE 'No' END AS delivery_confirmed,
                f.comments, CASE WHEN f.repeat_interest = 1 THEN 'Yes' ELSE 'No' END AS repeat_interest, f.created_at
         FROM feedback f JOIN orders o ON o.id = f.order_id JOIN customers c ON c.id = f.customer_id
         ORDER BY f.id DESC`,
      );
      const avg = rows.length ? rows.reduce((s, r) => s + (r.rating ?? 0), 0) / rows.length : 0;
      return { rows, summary: { responses: rows.length, average_rating: Math.round(avg * 10) / 10 } };
    },
  },
];

reportsRouter.get(
  '/',
  asyncHandler((req, res) => {
    res.json({
      reports: defs.map((d) => ({ key: d.key, title: d.title, description: d.description, columns: d.columns })),
    });
  }),
);

reportsRouter.get(
  '/:key',
  asyncHandler((req, res) => {
    const def = defs.find((d) => d.key === req.params.key);
    if (!def) {
      res.status(404).json({ error: 'Unknown report' });
      return;
    }
    const { from, to } = dateRange(req.query as Record<string, unknown>);
    const { rows, summary } = def.run(from, to);
    if (req.query.format === 'csv') {
      const contents = csv(rows, def.columns.map((c) => ({ key: c.key, label: c.label })));
      sendCsv(res, `coldpost-${def.key}-${new Date().toISOString().slice(0, 10)}.csv`, contents);
      return;
    }
    res.json({ key: def.key, title: def.title, description: def.description, columns: def.columns, rows, summary: summary ?? {}, range: { from, to } });
  }),
);
