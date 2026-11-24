import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, dateTime, inr } from '../lib/format';
import { Badge, Btn, Field, FileUpload, KeyValue, Loading, Modal, Money, MoneyInput, PageHead, PhotoGrid, Select, Tabs, Textarea, useToast } from '../components/ui';
import { RecipientsTab } from './order/RecipientsTab';
import { BomTab } from './order/BomTab';
import { ProcurementTab } from './order/ProcurementTab';
import { CostingTab } from './order/CostingTab';
import { ProductionTab } from './order/ProductionTab';
import { QcTab } from './order/QcTab';
import { ShipmentsTab } from './order/ShipmentsTab';
import { CommsTab } from './order/CommsTab';
import { FeedbackTab } from './order/FeedbackTab';

type TabKey = 'overview' | 'recipients' | 'bom' | 'procurement' | 'production' | 'qc' | 'shipments' | 'costing' | 'communication' | 'feedback' | 'activity';

export function OrderDetail() {
  const { id } = useParams();
  const { meta, reload: reloadMeta } = useMeta();
  const { push } = useToast();
  const { data, loading, error, reload } = useApi<any>(`/orders/${id}`, [id]);
  const [tab, setTab] = useState<TabKey>('overview');
  const [statusOpen, setStatusOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) return <Loading label="Opening order…" />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;

  const { order, recipients, bom, workOrders, purchaseOrders, shipments, qcInspections, messages, issues, costing, history } = data;
  const transitions: string[] = meta?.enums.orderTransitions[order.status] ?? [];
  const metaEntry = meta?.enums.orderStatuses.find((s) => s.value === order.status);
  const completedWork = workOrders.filter((w: any) => w.status === 'completed').length;

  async function confirmOrder() {
    if (!window.confirm('Confirm this order? This freezes the BOM snapshot and moves the order to Confirmed.')) return;
    setBusy('confirm');
    try {
      await post(`/orders/${order.id}/confirm`);
      push('Order confirmed and BOM snapshot saved', 'good');
      reload();
      reloadMeta();
    } catch (err) {
      push((err as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function generateWorkOrders() {
    setBusy('wo');
    try {
      const result = await post(`/orders/${order.id}/work-orders`);
      push(`${result.created} work order(s) created`, 'good');
      reload();
      reloadMeta();
    } catch (err) {
      push((err as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Link to="/orders" className="small muted" style={{ textDecoration: 'underline' }}>← All orders</Link>
      </div>
      <PageHead
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)', letterSpacing: 0 }}>{order.ref}</span>
            <span>{order.campaign_name}</span>
            <span className={`badge badge-${metaEntry?.tone ?? 'neutral'}`} style={{ position: 'relative', top: 2 }}>{metaEntry?.label ?? order.status}</span>
          </span>
        }
        subtitle={
          <span className="row" style={{ gap: 8 }}>
            <Link to={`/customers/${order.customer_id}`} style={{ textDecoration: 'underline' }}>{order.company_name}</Link>
            <span className="muted">·</span>
            <span>{meta?.enums.campaignTypeLabel[order.campaign_type] ?? order.campaign_type}</span>
            <span className="muted">·</span>
            <span>{recipients.length} package{recipients.length === 1 ? '' : 's'}</span>
            <span className="muted">·</span>
            <Money paise={order.total_value_paise} />
            {order.status === 'delayed' && order.delay_reason ? <Badge tone="bad">Delayed — {order.delay_reason}</Badge> : null}
          </span>
        }
        actions={
          <>
            <Btn onClick={() => setQuoteOpen(true)}>Quotation</Btn>
            {['draft', 'quotation', 'awaiting_approval'].includes(order.status) ? (
              <Btn variant="primary" onClick={confirmOrder} loading={busy === 'confirm'}>Confirm order</Btn>
            ) : null}
            {recipients.length && !workOrders.length ? (
              <Btn onClick={generateWorkOrders} loading={busy === 'wo'}>Generate work orders</Btn>
            ) : null}
            <Btn variant={transitions.length ? 'accent' : 'default'} onClick={() => setStatusOpen(true)} disabled={!transitions.length}>
              Change status
            </Btn>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="label">Order value</div>
          <div className="value">{inr(order.total_value_paise)}</div>
          <div className="foot">Advance {inr(order.advance_received_paise)} · balance {inr(order.total_value_paise - order.advance_received_paise)}</div>
        </div>
        <div className="stat">
          <div className="label">Estimated cost</div>
          <div className="value">{inr(order.estimated_cost_paise)}</div>
          <div className="foot">BOM + cost lines + fee</div>
        </div>
        <div className="stat">
          <div className="label">Actual cost</div>
          <div className="value">{inr(order.actual_cost_paise)}</div>
          <div className="foot">Received goods + recorded spend</div>
        </div>
        <div className={`stat ${costing.lossMaking ? 'bad' : ''}`}>
          <div className="label">Profit / margin (actual)</div>
          <div className={`value ${costing.grossProfitActualPaise < 0 ? 'money neg' : ''}`}>{inr(costing.grossProfitActualPaise)}</div>
          <div className="foot">{costing.marginActualPct}% · {costing.lossMaking ? 'loss-making' : costing.lowMargin ? 'thin margin' : 'healthy'}</div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'recipients', label: 'Recipients', count: recipients.length },
          { key: 'bom', label: 'BOM', count: bom.length },
          { key: 'procurement', label: 'Procurement', count: purchaseOrders.length },
          { key: 'production', label: 'Production', count: workOrders.length },
          { key: 'qc', label: 'QC', count: qcInspections.length },
          { key: 'shipments', label: 'Shipments', count: shipments.length },
          { key: 'costing', label: 'Costing' },
          { key: 'communication', label: 'Communication', count: messages.length },
          { key: 'feedback', label: 'Feedback', count: issues.length },
          { key: 'activity', label: 'Activity log' },
        ]}
      />

      {tab === 'overview' ? <Overview bundle={data} reload={reload} /> : null}
      {tab === 'recipients' ? <RecipientsTab bundle={data} reload={reload} /> : null}
      {tab === 'bom' ? <BomTab bundle={data} reload={reload} /> : null}
      {tab === 'procurement' ? <ProcurementTab bundle={data} reload={reload} /> : null}
      {tab === 'production' ? <ProductionTab bundle={data} reload={reload} /> : null}
      {tab === 'qc' ? <QcTab bundle={data} reload={reload} /> : null}
      {tab === 'shipments' ? <ShipmentsTab bundle={data} reload={reload} /> : null}
      {tab === 'costing' ? <CostingTab bundle={data} reload={reload} /> : null}
      {tab === 'communication' ? <CommsTab bundle={data} reload={reload} /> : null}
      {tab === 'feedback' ? <FeedbackTab bundle={data} reload={reload} /> : null}
      {tab === 'activity' ? <ActivityTab bundle={data} /> : null}

      {statusOpen ? (
        <StatusModal
          order={order}
          transitions={transitions}
          onClose={() => setStatusOpen(false)}
          onDone={() => { setStatusOpen(false); reload(); reloadMeta(); }}
        />
      ) : null}
      {quoteOpen ? <QuotationModal order={order} onClose={() => setQuoteOpen(false)} onDone={() => { setQuoteOpen(false); reload(); reloadMeta(); }} /> : null}

      {completedWork === recipients.length && recipients.length > 0 && ['qc_passed'].includes(order.status) ? (
        <div className="alert alert-good" style={{ marginTop: 16 }}>
          All packages passed QC. They can now be packed and handed to a courier.
        </div>
      ) : null}
    </>
  );
}

function StatusModal({ order, transitions, onClose, onDone }: { order: any; transitions: string[]; onClose: () => void; onDone: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [status, setStatus] = useState(transitions[0] ?? '');
  const [note, setNote] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post(`/orders/${order.id}/transition`, { status, note: note || null, delay_reason: status === 'delayed' ? delayReason : null });
      push(`Order moved to ${meta?.enums.orderStatuses.find((s) => s.value === status)?.label ?? status}`, 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Change order status"
      subtitle={`Currently ${order.status.replace(/_/g, ' ')}. Only valid workflow moves are offered.`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!status}>Move order</Btn></>}
    >
      <div className="stack">
        <Field label="New status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={transitions.map((value) => ({ value, label: meta?.enums.orderStatuses.find((s) => s.value === value)?.label ?? value }))} />
        </Field>
        {status === 'delayed' ? (
          <Field label="Delay reason" hint="Recorded on the order and shown on the dashboard.">
            <Textarea value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Supplier delay, print rework, courier pickup missed…" />
          </Field>
        ) : null}
        <Field label="Note">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the status history" />
        </Field>
        <div className="hint-box">Status history records who made the change and when. Automatic updates are labelled separately.</div>
      </div>
    </Modal>
  );
}

function QuotationModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [amount, setAmount] = useState(order.quotation_amount_paise || order.total_value_paise);
  const [date, setDate] = useState(order.quotation_date || new Date().toISOString().slice(0, 10));
  const [advanceStatus, setAdvanceStatus] = useState<'quotation' | 'awaiting_approval'>('quotation');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post(`/orders/${order.id}/quotation`, {
        quotation_amount_paise: amount,
        quotation_date: date,
        advance_status: advanceStatus,
        note: note || null,
      });
      push('Quotation saved and margin recalculated', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Quotation"
      subtitle={`${order.ref} — ${order.company_name}`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save quotation</Btn></>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Quotation amount">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Quotation date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Quotation number">
            <input className="input" value={order.quotation_number ?? 'Generated on save'} readOnly />
          </Field>
          <Field label="Move order to">
            <Select value={advanceStatus} onChange={(e) => setAdvanceStatus(e.target.value as any)} options={[{ value: 'quotation', label: 'Quotation' }, { value: 'awaiting_approval', label: 'Awaiting approval' }]} />
          </Field>
          <Field label="Note" span2>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Revision notes or what changed in the quote" />
          </Field>
        </div>
        <div className="hint-box">The quotation sets the customer selling price used for margin calculations. Estimated cost comes from the BOM and costing tab.</div>
      </div>
    </Modal>
  );
}

function Overview({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { order, recipients, bom, purchaseOrders, workOrders, shipments, costing } = bundle;
  return (
    <div className="split">
      <div className="stack">
        <div className="card">
          <div className="card-head"><h3>Campaign</h3><span className="badge badge-outline">{order.ref}</span></div>
          <div className="card-body">
            <div className="split" style={{ gap: 24 }}>
              <KeyValue
                rows={[
                  ['Customer', <Link to={`/customers/${order.customer_id}`} style={{ textDecoration: 'underline' }}>{order.company_name}</Link>],
                  ['Contact', order.customer_contact],
                  ['Order date', dateLabel(order.order_date)],
                  ['Campaign type', order.campaign_type?.replace(/_/g, ' ')],
                  ['Recipients', `${recipients.length}`],
                  ['Expected dispatch', dateLabel(order.expected_dispatch_date)],
                  ['Target delivery', dateLabel(order.target_delivery_date)],
                ]}
              />
              <KeyValue
                rows={[
                  ['Procurement city', order.procurement_city_name],
                  ['Fulfilment location', order.fulfilment_location_name ?? 'Not assigned'],
                  ['Quotation', order.quotation_number ? `${order.quotation_number} · ${dateLabel(order.quotation_date)}` : '—'],
                  ['Confirmed', order.confirmed_at ? dateTime(order.confirmed_at) : '—'],
                  ['BOM snapshot', order.bom_snapshot_at ? dateTime(order.bom_snapshot_at) : 'Not frozen yet'],
                  ['Packages shipped', `${shipments.filter((s: any) => s.status !== 'test_only').length} / ${recipients.length}`],
                ]}
              />
            </div>
            {order.description ? (
              <>
                <div className="divider" />
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{order.description}</div>
              </>
            ) : null}
            {order.packing_requirements || order.special_instructions || order.internal_notes ? (
              <>
                <div className="divider" />
                <div className="grid grid-3">
                  {order.packing_requirements ? <div><div className="tag">Packaging</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{order.packing_requirements}</div></div> : null}
                  {order.special_instructions ? <div><div className="tag">Instructions</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{order.special_instructions}</div></div> : null}
                  {order.internal_notes ? <div><div className="tag">Internal</div><div className="small" style={{ whiteSpace: 'pre-wrap' }}>{order.internal_notes}</div></div> : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Financial position</h3><div className="actions"><span className="small muted">Actual vs estimated</span></div></div>
          <div className="card-body">
            <div className="grid grid-3">
              <div>
                <div className="tag">Selling price</div>
                <div className="big-money">{inr(order.total_value_paise)}</div>
                <div className="small muted">Advance {inr(order.advance_received_paise)}</div>
              </div>
              <div>
                <div className="tag">Estimated cost</div>
                <div className="big-money">{inr(costing.estimatedTotalPaise)}</div>
                <div className="small muted">BOM {inr(costing.bomEstimatedPaise)} · other {inr(costing.estimatedTotalPaise - costing.bomEstimatedPaise)}</div>
              </div>
              <div>
                <div className="tag">Actual cost</div>
                <div className="big-money">{inr(costing.actualTotalPaise)}</div>
                <div className="small muted">Variance {inr(costing.variancePaise)}</div>
              </div>
            </div>
            <div className="divider" />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="tag">Profit (actual)</div>
                <strong style={{ fontSize: 20 }} className={costing.grossProfitActualPaise < 0 ? 'money neg' : 'money pos'}>{inr(costing.grossProfitActualPaise)}</strong>
                <span className="small muted"> · {costing.marginActualPct}% margin</span>
              </div>
              <div className="small muted">Per package ≈ {inr(costing.perPackageActualPaise)} actual</div>
            </div>
            {costing.lossMaking ? <div className="alert alert-bad" style={{ marginTop: 12 }}>This campaign is currently loss-making. Review the costing tab before dispatch.</div> : costing.lowMargin ? <div className="alert alert-warn" style={{ marginTop: 12 }}>Margin is under 10%. Double-check shipping and labour costs.</div> : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Status history</h3></div>
          <div className="card-body">
            <div className="timeline">
              {bundle.history.map((item: any) => (
                <div className="timeline-item" key={item.id}>
                  <div className="timeline-dot accent" />
                  <div className="timeline-body">
                    <div><strong>{item.to_status?.replace(/_/g, ' ')}</strong>{item.note ? ` — ${item.note}` : ''}</div>
                    <div className="when">{dateTime(item.created_at)} · {item.user_name ?? 'System'}</div>
                  </div>
                </div>
              ))}
              {!bundle.history.length ? <div className="small muted">No status changes yet.</div> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-head"><h3>Pipeline</h3></div>
          <div className="card-body stack">
            <PipelineRow label="Recipient packages" value={recipients.length} />
            <PipelineRow label="BOM lines" value={bom.length} />
            <PipelineRow label="Purchase orders" value={purchaseOrders.length} />
            <PipelineRow label="Work orders" value={workOrders.length} detail={`${workOrders.filter((w: any) => w.status === 'completed').length} completed`} />
            <PipelineRow label="Shipments" value={shipments.length} detail={`${shipments.filter((s: any) => s.status === 'delivered').length} delivered`} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Order files</h3></div>
          <div className="card-body stack">
            <FileUpload entityType="order" entityId={order.id} kind="document" label="Upload a document (PO copy, brief, reference)" onDone={reload} />
            <PhotoGrid attachments={(bundle.attachments ?? []).filter((a: any) => a.entity_type === 'order')} />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Quick actions</h3></div>
          <div className="card-body stack-sm">
            <Link className="btn" to="/procurement">Create a purchase order</Link>
            <Link className="btn" to="/production">Open the production board</Link>
            <Link className="btn" to="/shipments">Shipment desk</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineRow({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span><strong>{value}</strong> {detail ? <span className="xsmall muted">· {detail}</span> : null}</span>
    </div>
  );
}

function ActivityTab({ bundle }: { bundle: any }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="card">
      <div className="card-head"><h3>Full activity log</h3><span className="badge badge-outline">{bundle.activity.length} events</span></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody>
            {bundle.activity.map((entry: any) => (
              <tr key={entry.id} className="clickable" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>
                <td className="small muted nowrap-text">{dateTime(entry.created_at)}</td>
                <td>{entry.user_name ?? 'System'}</td>
                <td>
                  <span className="small">{entry.action.replace(/[._]/g, ' ')}</span>
                  {entry.manual_override ? <Badge tone="warn">override</Badge> : null}
                </td>
                <td className="small">{entry.entity_type} {entry.entity_label ? `· ${entry.entity_label}` : ''}</td>
                <td className="small muted" style={{ maxWidth: 340 }}>
                  {expanded === entry.id ? <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--mono)', fontSize: 10.5 }}>{entry.meta ?? '—'}</pre> : <span style={{ display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{entry.meta ?? '—'}</span>}
                </td>
              </tr>
            ))}
            {!bundle.activity.length ? <tr><td colSpan={5} className="small muted">No activity recorded yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
