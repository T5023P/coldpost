import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { dateLabel, dateTime, inr } from '../lib/format';
import { Badge, Btn, EmptyState, KeyValue, Loading, PageHead, Stat } from '../components/ui';
import { CustomerModal } from './Customers';

export function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<any>(`/customers/${id}`, [id]);
  const activity = useApi<any>(`/customers/${id}/activity`, [id]);
  const [editing, setEditing] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;
  const { customer, orders, stats, feedback } = data;

  return (
    <>
      <div style={{ marginBottom: 10 }}><Link to="/customers" className="small muted" style={{ textDecoration: 'underline' }}>← Customers</Link></div>
      <PageHead
        title={customer.company_name}
        subtitle={<span className="row"><span>{customer.contact_person ?? 'No contact'}</span><span className="muted">·</span><span style={{ textTransform: 'capitalize' }}>{customer.customer_type}</span><Badge tone={customer.status === 'active' ? 'good' : 'neutral'}>{customer.status}</Badge></span>}
        actions={<Btn variant="primary" onClick={() => setEditing(true)}>Edit customer</Btn>}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Orders" value={stats.order_count} foot="All time" />
        <Stat label="Total spend" value={inr(stats.total_spend_paise)} foot="Excluding cancelled" />
        <Stat label="Campaign cost" value={inr(stats.total_cost_paise)} foot="Actual cost recorded" />
        <Stat label="Feedback" value={feedback.length} foot={feedback.length ? `Avg ${(feedback.reduce((s: number, f: any) => s + (f.rating ?? 0), 0) / feedback.length).toFixed(1)} ★` : 'No responses yet'} />
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Orders</h3><div className="actions"><Link to="/orders" className="btn btn-sm">All orders</Link></div></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Campaign</th><th>Status</th><th className="num">Value</th><th>Date</th></tr></thead>
              <tbody>
                {orders.map((order: any) => (
                  <tr key={order.id} className="clickable" onClick={() => navigate(`/orders/${order.id}`)}>
                    <td className="mono">{order.ref}</td>
                    <td className="small">{order.campaign_name}</td>
                    <td><Badge tone={order.status === 'delivered' || order.status === 'closed' ? 'good' : 'info'}>{order.status.replace(/_/g, ' ')}</Badge></td>
                    <td className="num">{inr(order.total_value_paise)}</td>
                    <td className="small muted">{dateLabel(order.order_date)}</td>
                  </tr>
                ))}
                {!orders.length ? <tr><td colSpan={5}><EmptyState title="No orders for this customer" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Customer record</h3></div>
          <div className="card-body">
            <KeyValue
              rows={[
                ['Contact', customer.contact_person],
                ['Email', customer.email],
                ['Phone', customer.phone],
                ['Billing address', customer.billing_address],
                ['GSTIN', customer.gstin],
                ['Notes', customer.notes],
                ['Created', dateTime(customer.created_at)],
              ]}
            />
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><h3>Feedback</h3></div>
          <div className="card-body stack">
            {feedback.map((entry: any) => (
              <div key={entry.id} className="small">
                <div className="row"><strong>{entry.rating ? `${entry.rating} ★` : 'No rating'}</strong><span className="muted">{dateTime(entry.created_at)}</span></div>
                <div>{entry.comments ?? '—'}</div>
                {entry.packaging_feedback ? <div className="xsmall muted">Packaging: {entry.packaging_feedback}</div> : null}
              </div>
            ))}
            {!feedback.length ? <EmptyState title="No feedback yet" /> : null}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Activity</h3></div>
          <div className="card-body timeline" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {(activity.data?.activity ?? []).map((entry: any) => (
              <div className="timeline-item" key={entry.id}>
                <div className="timeline-dot" />
                <div className="timeline-body">
                  <div>{entry.action.replace(/[._]/g, ' ')} {entry.entity_label ? `· ${entry.entity_label}` : ''}</div>
                  <div className="when">{entry.user_name ?? 'System'} · {dateTime(entry.created_at)}</div>
                </div>
              </div>
            ))}
            {!activity.data?.activity?.length ? <div className="small muted">No activity.</div> : null}
          </div>
        </div>
      </div>

      {editing ? <CustomerModal customer={customer} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} /> : null}
    </>
  );
}
