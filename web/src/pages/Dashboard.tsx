import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, inr, num, relative } from '../lib/format';
import { Btn, EmptyState, Loading, Money, PageHead, Stat } from '../components/ui';
import { BarChart, Donut, LineChart } from '../components/Charts';

const quickRanges = [
  { label: 'This month', get: () => [new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: 'Last 30 days', get: () => [new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: 'Last 90 days', get: () => [new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), new Date().toISOString().slice(0, 10)] },
  { label: 'All time', get: () => ['', ''] },
];

export function Dashboard() {
  const { meta } = useMeta();
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [from, to]);
  const { data, loading, error } = useApi<any>(`/dashboard${query ? `?${query}` : ''}`, [query]);

  if (loading && !data) return <Loading label="Reading the studio floor…" />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;

  const cards = data.cards;
  const statusOrder = [
    'draft', 'quotation', 'awaiting_approval', 'confirmed', 'procurement', 'assembly_queued', 'assembling',
    'qc_pending', 'qc_passed', 'ready_to_dispatch', 'in_transit', 'delivered', 'on_hold', 'cancelled',
  ];
  const pipeline = statusOrder
    .map((status) => ({ label: meta?.enums.orderStatuses.find((s) => s.value === status)?.label ?? status, value: data.byStatus[status] ?? 0, status }))
    .filter((row) => row.value > 0);
  const campaigns = (data.campaignBreakdown ?? []).map((row: any) => ({
    label: meta?.enums.campaignTypeLabel[row.campaign_type] ?? row.campaign_type,
    value: row.count,
  }));
  const monthly = (data.monthly ?? []).map((row: any) => ({
    label: new Date(`${row.month}-01`).toLocaleDateString('en-IN', { month: 'short' }),
    value: row.value_paise,
    value2: row.actual_paise,
  }));

  return (
    <>
      <PageHead
        title="Studio floor"
        subtitle="Every campaign, purchase and package in one view. Figures exclude cancelled orders."
        actions={
          <>
            <input className="input" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span className="muted small">to</span>
            <input className="input" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            {quickRanges.map((range) => (
              <Btn key={range.label} size="sm" onClick={() => { const [f, t] = range.get(); setFrom(f); setTo(t); }}>{range.label}</Btn>
            ))}
          </>
        }
      />

      <div className="grid grid-6" style={{ marginBottom: 16 }}>
        <Stat label="Total orders" value={num(cards.totalOrders)} foot={`${cards.newOrders} new / unquoted`} onClick={() => navigate('/orders')} dark />
        <Stat label="Awaiting approval" value={num(cards.awaitingApproval)} foot="Quotations with the client" onClick={() => navigate('/orders?status=awaiting_approval')} />
        <Stat label="Awaiting procurement" value={num(cards.awaitingProcurement)} foot={`${cards.itemsAwaitingReceipt} awaiting receipt`} onClick={() => navigate('/orders?status=confirmed,procurement')} />
        <Stat label="In assembly" value={num(cards.inAssembly)} foot={`${cards.awaitingQc} awaiting QC`} onClick={() => navigate('/production')} />
        <Stat label="Ready to dispatch" value={num(cards.readyForDispatch)} foot={`${cards.inTransit} in transit`} onClick={() => navigate('/orders?status=ready_to_dispatch')} />
        <Stat label="Delivered" value={num(cards.delivered)} foot={cards.delayed ? `${cards.delayed} delayed` : 'On schedule'} tone={cards.delayed ? 'warn' : undefined} onClick={() => navigate('/orders?status=delivered,closed')} />
      </div>

      <div className="grid grid-6" style={{ marginBottom: 18 }}>
        <Stat label="Order value" value={inr(cards.totalValuePaise)} foot="Confirmed + draft" />
        <Stat label="Estimated cost" value={inr(cards.estimatedCostPaise)} foot="BOM + cost lines" />
        <Stat label="Actual cost" value={inr(cards.actualCostPaise)} foot="Received + recorded" />
        <Stat label="Estimated profit" value={inr(cards.estimatedProfitPaise)} foot="At estimated cost" tone={cards.estimatedProfitPaise < 0 ? 'bad' : undefined} />
        <Stat label="Actual profit" value={inr(cards.actualProfitPaise)} foot="At actual cost" tone={cards.actualProfitPaise < 0 ? 'bad' : undefined} />
        <Stat label="Low stock" value={num(cards.lowStockCount)} foot="At or below minimum" tone={cards.lowStockCount ? 'warn' : undefined} onClick={() => navigate('/inventory')} />
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Orders by stage</h3>
            <div className="actions"><Link to="/orders" className="btn btn-sm">All orders</Link></div>
          </div>
          <div className="card-body">
            {pipeline.length ? <BarChart data={pipeline} /> : <EmptyState title="No orders yet" message="Create your first campaign to see the pipeline." />}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Campaign mix</h3></div>
          <div className="card-body">
            <Donut data={campaigns} centerLabel="orders" />
          </div>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Revenue against actual cost</h3><span className="badge badge-outline">Last {monthly.length} months</span></div>
          <div className="card-body">
            <LineChart data={monthly} compare="Actual cost" format={(v) => inr(v)} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Needs attention</h3></div>
          <div className="card-body stack">
            {cards.delayed > 0 ? (
              <div className="alert alert-warn">
                <strong>{cards.delayed}</strong>&nbsp;order{cards.delayed === 1 ? '' : 's'} past the target delivery date.
                <Link to="/reports" style={{ marginLeft: 'auto', textDecoration: 'underline' }}>Report</Link>
              </div>
            ) : null}
            {data.lowStock.map((item: any) => (
              <div key={item.id} className="row" style={{ fontSize: 12.5 }}>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                <span className="mono muted">{item.available} / {item.min_stock}</span>
                <span className="badge badge-warn">Low</span>
              </div>
            ))}
            {data.advancePending.map((order: any) => (
              <div key={order.id} className="row" style={{ fontSize: 12.5 }}>
                <Link to={`/orders/${order.id}`} className="mono">{order.ref}</Link>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.company_name}</span>
                <span className="badge badge-warn">Advance 50% not reached</span>
              </div>
            ))}
            {!cards.delayed && !data.lowStock.length && !data.advancePending.length ? (
              <EmptyState title="Nothing needs attention" message="Stock levels and advances look healthy." />
            ) : null}
          </div>
        </div>
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Recent orders</h3><div className="actions"><Link to="/orders" className="btn btn-sm">View all</Link></div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Order</th><th>Customer</th><th>Campaign</th><th>Status</th><th className="num">Value</th><th>Target</th></tr>
              </thead>
              <tbody>
                {data.recentOrders.map((order: any) => (
                  <tr key={order.id} className="clickable" onClick={() => navigate(`/orders/${order.id}`)}>
                    <td className="mono strong">{order.ref}</td>
                    <td>{order.company_name}</td>
                    <td><div style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.campaign_name}</div></td>
                    <td><StatusDot status={order.status} /></td>
                    <td className="num"><Money paise={order.total_value_paise} /></td>
                    <td className="small muted">{dateLabel(order.target_delivery_date)}</td>
                  </tr>
                ))}
                {!data.recentOrders.length ? <tr><td colSpan={6}><EmptyState title="No orders yet" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Activity</h3></div>
          <div className="card-body" style={{ maxHeight: 360, overflowY: 'auto' }}>
            <div className="timeline">
              {data.recentActivity.map((item: any) => (
                <div className="timeline-item" key={item.id}>
                  <div className={`timeline-dot ${item.manual_override ? 'accent' : ''}`} />
                  <div className="timeline-body">
                    <div>{describeAction(item.action)} {item.entity_label ? <span className="muted">· {item.entity_label}</span> : null}</div>
                    <div className="when">{item.user_name ?? 'System'} · {relative(item.created_at)}{item.manual_override ? ' · override' : ''}</div>
                  </div>
                </div>
              ))}
              {!data.recentActivity.length ? <EmptyState title="Nothing logged yet" /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><h3>Shipments in motion</h3><div className="actions"><Link to="/shipments" className="btn btn-sm">Shipments</Link></div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>AWB</th><th>Order</th><th>Recipient</th><th>Courier</th><th>Status</th></tr></thead>
              <tbody>
                {data.shipmentsInMotion.map((shipment: any) => (
                  <tr key={shipment.id}>
                    <td className="mono">{shipment.awb ?? '—'}</td>
                    <td className="mono">{shipment.order_ref}</td>
                    <td>{shipment.recipient_name}</td>
                    <td>{shipment.courier_name ?? '—'}</td>
                    <td><span className="badge badge-info">{shipment.status.replace(/_/g, ' ')}</span></td>
                  </tr>
                ))}
                {!data.shipmentsInMotion.length ? <tr><td colSpan={5}><EmptyState title="No shipments in transit" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Supplier performance</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Supplier</th><th className="num">POs</th><th className="num">On time</th><th className="num">Quality</th></tr></thead>
              <tbody>
                {data.supplierPerformance.map((supplier: any) => (
                  <tr key={supplier.id}>
                    <td>{supplier.name}</td>
                    <td className="num">{supplier.po_count}</td>
                    <td className="num">{supplier.received_count ? `${Math.round((supplier.on_time_count / supplier.received_count) * 100)}%` : '—'}</td>
                    <td className="num">{supplier.quality_rating ? `${Number(supplier.quality_rating).toFixed(1)} ★` : '—'}</td>
                  </tr>
                ))}
                {!data.supplierPerformance.length ? <tr><td colSpan={4}><EmptyState title="No suppliers yet" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function StatusDot({ status }: { status: string }) {
  const { meta } = useMeta();
  const entry = meta?.enums.orderStatuses.find((s) => s.value === status);
  const tone = entry?.tone ?? 'neutral';
  return <span className={`badge badge-${tone}`}>{entry?.label ?? status.replace(/_/g, ' ')}</span>;
}

function describeAction(action: string) {
  const map: Record<string, string> = {
    'order.create': 'Order created',
    'order.update': 'Order updated',
    'order.status': 'Order status changed',
    'order.status.auto': 'Order advanced automatically',
    'order.quotation': 'Quotation issued',
    'order.close.override': 'Order force-closed',
    'recipients.add': 'Recipient packages added',
    'recipient.update': 'Recipient updated',
    'recipient.delete': 'Recipient removed',
    'bom.generate': 'BOM generated',
    'bom.snapshot': 'BOM snapshot saved',
    'bom.unlock': 'BOM unlocked for editing',
    'inventory.reserve': 'Stock reserved',
    'inventory.adjust': 'Stock adjusted',
    'inventory.transfer': 'Stock transferred',
    'inventory.receive': 'Stock received',
    'purchase-order.create': 'Purchase order created',
    'purchase-order.receive': 'Goods received',
    'purchase-order.payment': 'Supplier payment recorded',
    'work-order.update': 'Work order updated',
    'work-order.complete': 'Assembly completed',
    'qc.passed': 'QC passed',
    'qc.failed': 'QC failed — rework',
    'shipment.create.manual': 'Shipment recorded manually',
    'shipment.book.api': 'Shipment booked via API',
    'shipment.status': 'Shipment status updated',
    'message.prepare': 'Message prepared',
    'message.sent.manual': 'Message marked sent manually',
    'message.send.api': 'Message sent via API',
    'feedback.create': 'Feedback recorded',
    'settings.operating-mode': 'Operating mode switched',
    'provider.update': 'Provider configured',
    'provider.secrets': 'Provider credentials saved',
    'provider.test': 'Provider tested',
  };
  return map[action] ?? action.replace(/[._]/g, ' ');
}
