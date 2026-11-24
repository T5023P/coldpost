import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { dateLabel, inr } from '../../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui';

const statusTone: Record<string, string> = {
  draft: 'neutral',
  sent: 'info',
  partial: 'warn',
  received: 'good',
  cancelled: 'bad',
};

export function ProcurementTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const navigate = useNavigate();
  const { meta } = useMeta();
  const [createOpen, setCreateOpen] = useState(false);
  const { order, purchaseOrders, purchaseItems } = bundle;

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Procurement</h3>
          <div className="small muted">Purchase orders raised for this campaign. Partial deliveries update stock through the inventory ledger.</div>
        </div>
        <span className="spacer" />
        <Btn variant="primary" onClick={() => setCreateOpen(true)}>+ Raise purchase order</Btn>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>PO</th><th>Supplier</th><th>Deliver to</th><th>Status</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Value</th><th>Expected</th><th>Payment</th></tr>
            </thead>
            <tbody>
              {purchaseOrders.map((po: any) => {
                const items = purchaseItems.filter((item: any) => item.purchase_order_id === po.id);
                const ordered = items.reduce((sum: number, item: any) => sum + item.qty_requested, 0);
                const received = items.reduce((sum: number, item: any) => sum + item.qty_received, 0);
                return (
                  <tr key={po.id} className="clickable" onClick={() => navigate(`/procurement/${po.id}`)}>
                    <td className="mono strong">{po.ref}</td>
                    <td>{po.supplier_name}</td>
                    <td className="small">{po.location_name ?? '—'}<div className="xsmall muted">{po.city_name ?? ''}</div></td>
                    <td><Badge tone={statusTone[po.status] ?? 'neutral'}>{po.status}</Badge></td>
                    <td className="num">{ordered}</td>
                    <td className="num">{received}</td>
                    <td className="num">{inr(po.total_paise)}</td>
                    <td className="small muted">{dateLabel(po.expected_delivery)}</td>
                    <td><Badge tone={po.payment_status === 'paid' ? 'good' : po.payment_status === 'partial' ? 'warn' : 'outline'}>{po.payment_status}</Badge></td>
                  </tr>
                );
              })}
              {!purchaseOrders.length ? (
                <tr><td colSpan={9}><EmptyState title="No purchase orders yet" message="Raise one for each supplier, or split the BOM across stores in different cities." action={<Btn onClick={() => setCreateOpen(true)}>Raise purchase order</Btn>} /></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card"><div className="card-body"><div className="tag">Committed spend</div><div className="big-money">{inr(purchaseOrders.reduce((sum: number, po: any) => sum + po.total_paise, 0))}</div><div className="small muted">Across {purchaseOrders.length} purchase orders</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">Paid to suppliers</div><div className="big-money">{inr(purchaseOrders.reduce((sum: number, po: any) => sum + po.paid_paise, 0))}</div><div className="small muted">Record payments inside each PO</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">Goods received</div><div className="big-money">{purchaseItems.reduce((sum: number, i: any) => sum + i.qty_received, 0)}</div><div className="small muted">Units across all lines</div></div></div>
      </div>

      {createOpen ? (
        <CreatePoModal
          order={order}
          bom={bundle.bom}
          suppliers={meta?.suppliers ?? []}
          locations={meta?.locations ?? []}
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); reload(); }}
        />
      ) : null}
    </div>
  );
}

function CreatePoModal({ order, bom, suppliers, locations, onClose, onDone }: { order: any; bom: any[]; suppliers: any[]; locations: any[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [supplierId, setSupplierId] = useState('');
  const [locationId, setLocationId] = useState(order.fulfilment_location_id ? String(order.fulfilment_location_id) : '');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<'draft' | 'sent'>('sent');
  const [override, setOverride] = useState('');
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cityLocations = useMemo(() => (order.procurement_city_id ? locations.filter((l: any) => l.city_id === order.procurement_city_id) : locations), [locations, order.procurement_city_id]);
  const supplierOptions = suppliers.filter(
    (s) => cityLocations.some((l: any) => l.supplier_id === s.id) || bom.some((line: any) => line.supplier_id === s.id) || !order.procurement_city_id,
  );

  function prefill(id: string) {
    const lines = bom.filter((line: any) => String(line.supplier_id) === id || !line.supplier_id);
    setItems(
      lines.map((line: any) => ({
        product_id: line.product_id,
        description: line.name_snapshot,
        qty_requested: line.total_qty,
        unit_price_paise: line.unit_cost_paise,
        unit: line.sku_snapshot,
      })),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await post('/purchase-orders', {
        supplier_id: Number(supplierId),
        order_id: order.id,
        location_id: locationId ? Number(locationId) : null,
        expected_delivery: expected || null,
        notes: notes || null,
        status,
        advance_override_reason: override || null,
        items: items.map((item) => ({
          product_id: item.product_id ? Number(item.product_id) : null,
          description: item.description,
          qty_requested: Number(item.qty_requested),
          unit_price_paise: Number(item.unit_price_paise),
        })),
      });
      push(`Purchase order ${result.purchaseOrder.ref} created${result.warning ? ` — ${result.warning}` : ''}`, result.warning ? 'warn' : 'good');
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Raise purchase order"
      subtitle={`${order.ref} · ${order.company_name}. A campaign can be sourced from several stores and cities.`}
      wide
      onClose={onClose}
      footer={<><span className="note">Advance warnings are enforced server-side.</span><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!supplierId || !items.length || items.some((i) => !i.qty_requested)}>Create PO</Btn></>}
    >
      <div className="stack">
        {error ? <div className="alert alert-bad">{error}</div> : null}
        <div className="form-grid">
          <Field label="Supplier">
            <Select
              placeholder="Choose supplier"
              value={supplierId}
              onChange={(e) => { setSupplierId(e.target.value); prefill(e.target.value); }}
              options={supplierOptions.map((s) => ({ value: s.id, label: `${s.name}${s.city_id === order.procurement_city_id ? ' — same city' : ''}` }))}
            />
          </Field>
          <Field label="Deliver to (store / warehouse)">
            <Select placeholder="Choose location" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={cityLocations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
          </Field>
          <Field label="Expected delivery"><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
          <Field label="Create as">
            <Select value={status} onChange={(e) => setStatus(e.target.value as any)} options={[{ value: 'sent', label: 'Sent to supplier' }, { value: 'draft', label: 'Draft' }]} />
          </Field>
        </div>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h4>Items</h4>
          <div className="row">
            <Btn size="sm" onClick={() => prefill(supplierId)} disabled={!supplierId}>Prefill from BOM</Btn>
            <Btn size="sm" onClick={() => setItems([...items, { description: '', qty_requested: 1, unit_price_paise: 0 }])}>+ Add line</Btn>
          </div>
        </div>

        <div className="table-wrap card" style={{ border: '1px solid var(--line)' }}>
          <table className="tbl">
            <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th><th></th></tr></thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index}>
                  <td>
                    <Input value={item.description} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, description: e.target.value } : it)))} placeholder="Item description" />
                    {item.unit ? <div className="xsmall muted">{item.unit}</div> : null}
                  </td>
                  <td className="num" style={{ width: 90 }}>
                    <Input type="number" min={1} value={item.qty_requested} onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, qty_requested: e.target.value } : it)))} />
                  </td>
                  <td className="num" style={{ width: 130 }}>
                    <MoneyInput value={item.unit_price_paise} onChange={(v) => setItems(items.map((it, i) => (i === index ? { ...it, unit_price_paise: v } : it)))} />
                  </td>
                  <td className="num">{inr(Number(item.qty_requested) * Number(item.unit_price_paise))}</td>
                  <td className="actions-cell"><Btn size="sm" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>✕</Btn></td>
                </tr>
              ))}
              {!items.length ? <tr><td colSpan={5} className="small muted" style={{ padding: 16 }}>Choose a supplier and prefill from the BOM, or add a line.</td></tr> : null}
            </tbody>
            {items.length ? (
              <tfoot className="tfoot"><tr><td colSpan={3}>PO total</td><td className="num">{inr(items.reduce((sum, i) => sum + Number(i.qty_requested) * Number(i.unit_price_paise), 0))}</td><td /></tr></tfoot>
            ) : null}
          </table>
        </div>

        <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Advance override reason" hint="Only needed if the client advance has not reached the configured threshold. It is recorded as a manual override.">
          <Textarea value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Leave blank if the advance is in" />
        </Field>
      </div>
    </Modal>
  );
}
