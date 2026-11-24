import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Loading, Modal, MoneyInput, PageHead, SearchInput, Select, Stat, Textarea, useToast } from '../components/ui';

const statusTone: Record<string, string> = { draft: 'neutral', sent: 'info', partial: 'warn', received: 'good', cancelled: 'bad' };

export function Procurement() {
  const { meta } = useMeta();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [supplier, setSupplier] = useState('');
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (supplier) params.set('supplier_id', supplier);
    if (city) params.set('city_id', city);
    if (search) params.set('search', search);
    return params.toString();
  }, [status, supplier, city, search]);

  const { data, loading, error, reload } = useApi<any>(`/purchase-orders?${query}`, [query]);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  const orders = data?.purchaseOrders ?? [];

  return (
    <>
      <PageHead
        title="Procurement"
        subtitle="Purchase orders by supplier and store. Partial deliveries are supported and every receipt updates location stock."
        actions={<Btn variant="primary" onClick={() => setCreateOpen(true)}>+ New purchase order</Btn>}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Open purchase orders" value={orders.filter((po: any) => ['draft', 'sent', 'partial'].includes(po.status)).length} foot="Not fully received" />
        <Stat label="Committed value" value={inr(orders.reduce((sum: number, po: any) => sum + po.total_paise, 0))} foot={`${orders.length} POs`} />
        <Stat label="Awaiting delivery" value={orders.filter((po: any) => po.status === 'partial').length} foot="Partially received" tone={orders.some((po: any) => po.status === 'partial') ? 'warn' : undefined} />
        <Stat label="Paid" value={inr(orders.reduce((sum: number, po: any) => sum + po.paid_paise, 0))} foot="Across all suppliers" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder="Search PO, supplier or order…" /></div>
          <Select placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'partial', label: 'Partially received' }, { value: 'received', label: 'Received' }, { value: 'cancelled', label: 'Cancelled' }]} style={{ width: 170 }} />
          <Select placeholder="All suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} options={(meta?.suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} style={{ width: 200 }} />
          <Select placeholder="All cities" value={city} onChange={(e) => setCity(e.target.value)} options={(meta?.cities ?? []).map((c: any) => ({ value: c.id, label: c.name }))} style={{ width: 150 }} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>PO</th><th>Supplier</th><th>Campaign</th><th>Deliver to</th><th>Status</th><th className="num">Value</th><th>Expected</th><th>Payment</th></tr></thead>
            <tbody>
              {orders.map((po: any) => (
                <tr key={po.id} className="clickable" onClick={() => navigate(`/procurement/${po.id}`)}>
                  <td className="mono strong">{po.ref}</td>
                  <td>{po.supplier_name}</td>
                  <td className="small">{po.order_ref ? <><span className="mono">{po.order_ref}</span><div className="xsmall muted">{po.campaign_name}</div></> : <span className="muted">Stock purchase</span>}</td>
                  <td className="small">{po.location_name ?? '—'}<div className="xsmall muted">{po.city_name ?? ''}</div></td>
                  <td><Badge tone={statusTone[po.status] ?? 'neutral'}>{po.status}</Badge></td>
                  <td className="num">{inr(po.total_paise)}</td>
                  <td className="small muted">{dateLabel(po.expected_delivery)}</td>
                  <td><Badge tone={po.payment_status === 'paid' ? 'good' : po.payment_status === 'partial' ? 'warn' : 'outline'}>{po.payment_status}</Badge></td>
                </tr>
              ))}
              {!orders.length ? <tr><td colSpan={8}><EmptyState title="No purchase orders" message="Raise one from an order's BOM or buy stock directly." action={<Btn onClick={() => setCreateOpen(true)}>New purchase order</Btn>} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {createOpen ? <CreatePoModal onClose={() => setCreateOpen(false)} onDone={(po) => { setCreateOpen(false); reload(); navigate(`/procurement/${po.id}`); }} /> : null}
    </>
  );
}

function CreatePoModal({ onClose, onDone }: { onClose: () => void; onDone: (po: any) => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [orderId, setOrderId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [override, setOverride] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefilling, setPrefilling] = useState(false);
  const orders = useApi<any>('/orders');
  const products = useApi<any>('/products?active=true');

  async function prefill() {
    if (!orderId) return;
    setPrefilling(true);
    try {
      const bundle = await api<any>(`/orders/${orderId}`);
      const bom = bundle.bom as any[];
      if (!bom.length) {
        push('This order has no BOM yet — add items manually', 'warn');
        return;
      }
      const supplierIds = [...new Set(bom.map((line) => line.supplier_id).filter(Boolean))];
      if (!supplierId && supplierIds.length === 1) setSupplierId(String(supplierIds[0]));
      const chosen = supplierId ? bom.filter((line) => String(line.supplier_id) === supplierId) : bom;
      setItems(
        chosen.map((line) => ({
          product_id: line.product_id,
          description: line.name_snapshot,
          qty_requested: line.total_qty,
          unit_price_paise: line.unit_cost_paise,
        })),
      );
      if (!locationId && bundle.order.fulfilment_location_id) setLocationId(String(bundle.order.fulfilment_location_id));
      if (supplierIds.length > 1) push('BOM spans multiple suppliers — only the selected supplier’s lines were copied', 'warn');
    } catch (err) {
      push((err as Error).message, 'bad');
    } finally {
      setPrefilling(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await post('/purchase-orders', {
        supplier_id: Number(supplierId),
        order_id: orderId ? Number(orderId) : null,
        location_id: locationId ? Number(locationId) : null,
        expected_delivery: expected || null,
        notes: notes || null,
        status: 'sent',
        advance_override_reason: override || null,
        items: items.map((item) => ({
          product_id: item.product_id ? Number(item.product_id) : null,
          description: item.description,
          qty_requested: Number(item.qty_requested),
          unit_price_paise: Number(item.unit_price_paise),
        })),
      });
      push(`Purchase order ${result.purchaseOrder.ref} created${result.warning ? ` — ${result.warning}` : ''}`, result.warning ? 'warn' : 'good');
      onDone(result.purchaseOrder);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const total = items.reduce((sum, item) => sum + Number(item.qty_requested || 0) * Number(item.unit_price_paise || 0), 0);

  return (
    <Modal
      title="New purchase order"
      subtitle="Link it to a campaign to keep costing accurate, or leave unlinked for stock purchases."
      wide
      onClose={onClose}
      footer={<><span className="note">PO total {inr(total)}</span><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!supplierId || !items.length}>Create PO</Btn></>}
    >
      <div className="stack">
        {error ? <div className="alert alert-bad">{error}</div> : null}
        <div className="form-grid">
          <Field label="Campaign order (optional)">
            <Select
              placeholder="Stock purchase — no order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              options={(orders.data?.orders ?? []).filter((o: any) => !['cancelled', 'closed'].includes(o.status)).map((o: any) => ({ value: o.id, label: `${o.ref} — ${o.customer_name ?? o.company_name}` }))}
            />
          </Field>
          <Field label="Supplier">
            <Select placeholder="Choose supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={(meta?.suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="Deliver to">
            <Select placeholder="Choose location" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={(meta?.locations ?? []).map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
          </Field>
          <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        </div>

        <div className="row">
          <h4>Items</h4>
          <span className="spacer" />
          <Btn size="sm" onClick={prefill} loading={prefilling} disabled={!orderId}>Prefill from order BOM</Btn>
          <Btn size="sm" onClick={() => setItems([...items, { description: '', qty_requested: 1, unit_price_paise: 0 }])}>+ Add line</Btn>
        </div>
        <div className="table-wrap card" style={{ border: '1px solid var(--line)' }}>
          <table className="tbl">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index}>
                  <td>
                    {item.product_id ? (
                      <div>{item.description}<div className="xsmall muted">Linked to catalogue product</div></div>
                    ) : (
                      <Input value={item.description} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, description: e.target.value } : it)))} placeholder="Item description" />
                    )}
                  </td>
                  <td className="num" style={{ width: 90 }}><Input type="number" min={1} value={item.qty_requested} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, qty_requested: e.target.value } : it)))} /></td>
                  <td className="num" style={{ width: 130 }}><MoneyInput value={item.unit_price_paise} onChange={(v) => setItems(items.map((it, i) => (i === index ? { ...it, unit_price_paise: v } : it)))} /></td>
                  <td className="num">{inr(Number(item.qty_requested) * Number(item.unit_price_paise))}</td>
                  <td className="actions-cell"><Btn size="sm" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>✕</Btn></td>
                </tr>
              ))}
              {!items.length ? (
                <tr>
                  <td colSpan={5} style={{ padding: 12 }}>
                    <div className="row">
                      <Select
                        placeholder="Add a catalogue product…"
                        value=""
                        onChange={(e) => {
                          const product = (products.data?.products ?? []).find((p: any) => String(p.id) === e.target.value);
                          if (!product) return;
                          setItems([...items, { product_id: product.id, description: product.name, qty_requested: product.min_stock || 1, unit_price_paise: product.purchase_price_paise }]);
                          if (!supplierId && product.supplier_id) setSupplierId(String(product.supplier_id));
                        }}
                        options={(products.data?.products ?? []).map((p: any) => ({ value: p.id, label: `${p.name} — ${p.sku}` }))}
                      />
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Advance override reason" hint="Only required if this campaign's advance has not been received. Logged as a manual override.">
          <Textarea value={override} onChange={(e) => setOverride(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
