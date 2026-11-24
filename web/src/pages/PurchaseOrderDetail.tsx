import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, dateTime, inr } from '../lib/format';
import { Badge, Btn, Field, FileUpload, Input, KeyValue, Loading, Modal, MoneyInput, PageHead, PhotoGrid, Select, Stat, Textarea, useToast } from '../components/ui';

export function PurchaseOrderDetail() {
  const { id } = useParams();
  const { meta } = useMeta();
  const { push } = useToast();
  const { data, loading, error, reload } = useApi<any>(`/purchase-orders/${id}`, [id]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [addLine, setAddLine] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;
  const { purchaseOrder: po, items, movements, attachments } = data;
  const received = items.reduce((sum: number, item: any) => sum + item.qty_received, 0);
  const rejected = items.reduce((sum: number, item: any) => sum + item.qty_rejected, 0);
  const ordered = items.reduce((sum: number, item: any) => sum + item.qty_requested, 0);

  async function setStatus(status: string) {
    try {
      await patch(`/purchase-orders/${po.id}`, { status });
      push(`Purchase order ${status}`, 'good');
      reload();
    } catch (err) {
      push((err as Error).message, 'bad');
    }
  }

  return (
    <>
      <div style={{ marginBottom: 10 }}><Link to="/procurement" className="small muted" style={{ textDecoration: 'underline' }}>← Procurement</Link></div>
      <PageHead
        title={<span className="row"><span className="mono" style={{ fontSize: 14, color: 'var(--muted)' }}>{po.ref}</span> {po.supplier_name}</span>}
        subtitle={po.order_ref ? <>For campaign <Link to={`/orders/${po.order_id}`} style={{ textDecoration: 'underline' }}>{po.order_ref}</Link> · {po.campaign_name}</> : 'Stock purchase not linked to a campaign'}
        actions={
          <>
            <Btn onClick={() => setStatus('sent')} disabled={po.status !== 'draft'}>Mark sent</Btn>
            <Btn variant="primary" onClick={() => setReceiveOpen(true)} disabled={po.status === 'cancelled' || po.status === 'received'}>Receive delivery</Btn>
            <Btn onClick={() => setPaymentOpen(true)}>Record payment</Btn>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="PO value" value={inr(po.total_paise)} foot={`${items.length} line(s)`} />
        <Stat label="Received" value={`${received} / ${ordered}`} foot={rejected ? `${rejected} rejected` : 'No rejections'} />
        <Stat label="Paid" value={inr(po.paid_paise)} foot={po.payment_status} />
        <Stat label="Status" value={<span style={{ textTransform: 'capitalize' }}>{po.status}</span>} foot={po.expected_delivery ? `Expected ${dateLabel(po.expected_delivery)}` : 'No expected date'} />
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Order details</h3><div className="actions"><span className={`badge badge-${po.payment_status === 'paid' ? 'good' : po.payment_status === 'partial' ? 'warn' : 'neutral'}`}>{po.payment_status}</span></div></div>
          <div className="card-body">
            <KeyValue
              rows={[
                ['Supplier', po.supplier_name],
                ['Deliver to', po.location_name ? `${po.location_name}${po.city_name ? ` — ${po.city_name}` : ''}` : 'Not set'],
                ['Expected delivery', dateLabel(po.expected_delivery)],
                ['Actual delivery', dateLabel(po.actual_delivery)],
                ['Created', dateTime(po.created_at)],
                ['Notes', po.notes],
                ['Advance override', po.advance_warning_override_reason],
              ]}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Documents</h3></div>
          <div className="card-body stack">
            <FileUpload entityType="purchase_order" entityId={po.id} kind="invoice" label="Upload purchase invoice" accept="image/*,application/pdf" onDone={reload} />
            <FileUpload entityType="purchase_order" entityId={po.id} kind="photo" label="Upload inspection photographs" accept="image/*" onDone={reload} />
            <PhotoGrid attachments={attachments} />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <h3>Items</h3>
          <div className="actions">
            <Btn size="sm" onClick={() => setAddLine(true)} disabled={po.status === 'cancelled'}>+ Add line</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setStatus('cancelled')} disabled={po.status === 'cancelled' || received > 0}>Cancel PO</Btn>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Rejected</th><th className="num">Outstanding</th><th className="num">Unit price</th><th className="num">Value</th></tr></thead>
            <tbody>
              {items.map((item: any) => (
                <tr key={item.id}>
                  <td><div className="strong">{item.product_name ?? item.description ?? 'Item'}</div><div className="xsmall muted">{item.sku ?? ''} {item.notes ?? ''}</div></td>
                  <td className="num">{item.qty_requested}</td>
                  <td className="num">{item.qty_received}</td>
                  <td className="num">{item.qty_rejected}</td>
                  <td className="num">{item.qty_requested - item.qty_received - item.qty_rejected}</td>
                  <td className="num">{inr(item.unit_price_paise)}</td>
                  <td className="num">{inr(item.qty_requested * item.unit_price_paise)}</td>
                </tr>
              ))}
              {!items.length ? <tr><td colSpan={7} className="small muted" style={{ padding: 16 }}>No lines on this purchase order.</td></tr> : null}
            </tbody>
            <tfoot className="tfoot"><tr><td colSpan={6}>Total</td><td className="num">{inr(po.total_paise)}</td></tr></tfoot>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Stock movements from this PO</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Location</th><th>By</th></tr></thead>
            <tbody>
              {movements.map((movement: any) => (
                <tr key={movement.id}>
                  <td className="small muted">{dateTime(movement.created_at)}</td>
                  <td>{movement.product_name}</td>
                  <td><Badge tone={movement.type === 'receive' ? 'good' : 'bad'}>{movement.type}</Badge></td>
                  <td className="num">{movement.qty}</td>
                  <td className="small">{movement.location_name}</td>
                  <td className="small muted">{movement.user_name ?? 'system'}</td>
                </tr>
              ))}
              {!movements.length ? <tr><td colSpan={6} className="small muted" style={{ padding: 16 }}>Nothing received yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {receiveOpen ? <ReceiveModal po={po} items={items} locations={meta?.locations ?? []} onClose={() => setReceiveOpen(false)} onDone={() => { setReceiveOpen(false); reload(); }} /> : null}
      {paymentOpen ? <PaymentModal po={po} onClose={() => setPaymentOpen(false)} onDone={() => { setPaymentOpen(false); reload(); }} /> : null}
      {addLine ? <AddLineModal poId={po.id} onClose={() => setAddLine(false)} onDone={() => { setAddLine(false); reload(); }} /> : null}
    </>
  );
}

function ReceiveModal({ po, items, locations, onClose, onDone }: { po: any; items: any[]; locations: any[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [lines, setLines] = useState<Record<number, { received: string; rejected: string }>>(
    Object.fromEntries(items.map((item) => [item.id, { received: String(Math.max(0, item.qty_requested - item.qty_received - item.qty_rejected)), rejected: '0' }])),
  );
  const [locationId, setLocationId] = useState(po.location_id ? String(po.location_id) : '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        location_id: locationId ? Number(locationId) : null,
        date,
        note: note || null,
        lines: Object.entries(lines)
          .map(([itemId, value]) => ({ item_id: Number(itemId), received: Number(value.received || 0), rejected: Number(value.rejected || 0) }))
          .filter((line) => line.received || line.rejected),
      };
      const result = await post(`/purchase-orders/${po.id}/receive`, payload);
      push(`Delivery recorded — status ${result.status}`, 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Receive delivery"
      subtitle="Enter only what arrived today. Partial quantities keep the PO open for the rest."
      wide
      onClose={onClose}
      footer={<><span className="note">Stock is added only for received quantities.</span><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!locationId}>Record delivery</Btn></>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Receiving location">
            <Select placeholder="Choose store or warehouse" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
          </Field>
          <Field label="Delivery date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="table-wrap card" style={{ border: '1px solid var(--line)' }}>
          <table className="tbl">
            <thead><tr><th>Item</th><th className="num">Outstanding</th><th className="num">Received now</th><th className="num">Rejected / damaged</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const outstanding = item.qty_requested - item.qty_received - item.qty_rejected;
                return (
                  <tr key={item.id}>
                    <td>{item.product_name ?? item.description}<div className="xsmall muted">{item.sku ?? ''}</div></td>
                    <td className="num">{outstanding}</td>
                    <td className="num" style={{ width: 120 }}>
                      <Input type="number" min={0} max={outstanding} value={lines[item.id]?.received ?? '0'} onChange={(e) => setLines({ ...lines, [item.id]: { ...lines[item.id], received: e.target.value } })} />
                    </td>
                    <td className="num" style={{ width: 120 }}>
                      <Input type="number" min={0} max={outstanding} value={lines[item.id]?.rejected ?? '0'} onChange={(e) => setLines({ ...lines, [item.id]: { ...lines[item.id], rejected: e.target.value } })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Field label="Receiving notes"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short delivery, damaged cartons, etc." /></Field>
      </div>
    </Modal>
  );
}

function PaymentModal({ po, onClose, onDone }: { po: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [paid, setPaid] = useState(po.paid_paise);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post(`/purchase-orders/${po.id}/payment`, { paid_paise: paid, note: note || null });
      push('Supplier payment recorded', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record supplier payment"
      subtitle={`${po.ref} · total ${inr(po.total_paise)}`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save payment</Btn></>}
    >
      <div className="stack">
        <Field label="Total paid to date"><MoneyInput value={paid} onChange={setPaid} /></Field>
        <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="UPI reference, part payment agreed…" /></Field>
        <div className="hint-box">Payment status is derived automatically: unpaid, partial or paid.</div>
      </div>
    </Modal>
  );
}

function AddLineModal({ poId, onClose, onDone }: { poId: number; onClose: () => void; onDone: () => void }) {
  const products = useApi<any>('/products?active=true');
  const { push } = useToast();
  const [form, setForm] = useState({ product_id: '', description: '', qty_requested: '1', unit_price_paise: 0, notes: '' });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post(`/purchase-orders/${poId}/items`, {
        product_id: form.product_id ? Number(form.product_id) : null,
        description: form.description || null,
        qty_requested: Number(form.qty_requested),
        unit_price_paise: Number(form.unit_price_paise),
        notes: form.notes || null,
      });
      push('Line added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add PO line"
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.qty_requested}>Add line</Btn></>}
    >
      <div className="form-grid">
        <Field label="Product" span2>
          <Select
            placeholder="Custom item (no product)"
            value={form.product_id}
            onChange={(e) => {
              const product = (products.data?.products ?? []).find((p: any) => String(p.id) === e.target.value);
              setForm({
                ...form,
                product_id: e.target.value,
                description: product?.name ?? form.description,
                unit_price_paise: product?.purchase_price_paise ?? form.unit_price_paise,
              });
            }}
            options={(products.data?.products ?? []).map((p: any) => ({ value: p.id, label: `${p.name} — ${p.sku}` }))}
          />
        </Field>
        <Field label="Description"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Quantity"><Input type="number" min={1} value={form.qty_requested} onChange={(e) => setForm({ ...form, qty_requested: e.target.value })} /></Field>
        <Field label="Unit price"><MoneyInput value={form.unit_price_paise} onChange={(v) => setForm({ ...form, unit_price_paise: v })} /></Field>
        <Field label="Notes" span2><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
