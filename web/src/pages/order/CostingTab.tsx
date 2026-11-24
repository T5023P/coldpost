import { useState } from 'react';
import { del, patch, post } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { inr } from '../../lib/format';
import { Btn, EmptyState, Field, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui';

const categories = [
  { value: 'product', label: 'Product' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'printing', label: 'Printing' },
  { value: 'customisation', label: 'Customisation' },
  { value: 'labour', label: 'Assembly labour' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'payment_fee', label: 'Payment fees' },
  { value: 'tax', label: 'Tax' },
  { value: 'replacement', label: 'Replacement / damage' },
  { value: 'other', label: 'Other' },
];

export function CostingTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [taxOpen, setTaxOpen] = useState(false);
  const { costing, order, costItems, bom, shipments } = bundle;

  async function remove(item: any) {
    if (!window.confirm('Delete this cost line?')) return;
    try {
      await del(`/orders/costs/${item.id}`);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  const rows = [
    { key: 'bom', category: 'Product & packaging (BOM)', estimated: costing.bomEstimatedPaise, actual: costing.productActualPaise, note: 'Estimated from BOM · actual from received POs' },
    ...costing.costItems.filter((c: any) => c.category !== 'shipping').map((c: any) => ({
      key: `cat-${c.category}`,
      category: categories.find((x) => x.value === c.category)?.label ?? c.category,
      estimated: c.estimatedPaise,
      actual: c.actualPaise,
      manual: true,
    })),
    { key: 'shipping', category: 'Shipping', estimated: costing.shippingEstimatedPaise, actual: costing.shippingActualPaise, note: `${shipments.length} shipment(s) recorded` },
    { key: 'fee', category: 'Payment fees', estimated: costing.paymentFeeEstimatedPaise, actual: costing.paymentFeeActualPaise, note: `${meta?.settings?.costing?.paymentFeePct ?? 0}% of selling price` },
  ];

  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="stat"><div className="label">Selling price</div><div className="value">{inr(costing.sellingPricePaise)}</div><div className="foot">Quotation / order value</div></div>
        <div className="stat"><div className="label">Estimated cost</div><div className="value">{inr(costing.estimatedTotalPaise)}</div><div className="foot">BOM + lines + fee</div></div>
        <div className="stat"><div className="label">Actual cost</div><div className="value">{inr(costing.actualTotalPaise)}</div><div className="foot">Received + recorded</div></div>
        <div className={`stat ${costing.lossMaking ? 'bad' : costing.lowMargin ? 'warn' : ''}`}>
          <div className="label">Profit</div>
          <div className="value">{inr(costing.grossProfitActualPaise)}</div>
          <div className="foot">{costing.marginActualPct}% margin · variance {inr(costing.variancePaise)}</div>
        </div>
      </div>

      {costing.lossMaking ? <div className="alert alert-bad">This order is loss-making at actual cost. Do not dispatch without reviewing pricing.</div> : null}
      {costing.lowMargin && !costing.lossMaking ? <div className="alert alert-warn">Margin is under 10%. Shipping, labour and replacements are the usual culprits.</div> : null}

      <div className="card">
        <div className="card-head">
          <h3>Cost build-up</h3>
          <div className="actions">
            <Btn size="sm" onClick={() => setTaxOpen(true)}>Apply tax</Btn>
            <Btn size="sm" variant="primary" onClick={() => setAddOpen(true)}>+ Add cost line</Btn>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Cost</th><th className="num">Estimated</th><th className="num">Actual</th><th className="num">Variance</th><th>Notes</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="strong">{row.category}</td>
                  <td className="num">{inr(row.estimated)}</td>
                  <td className={`num ${row.actual === 0 ? 'muted' : ''}`}>{inr(row.actual)}</td>
                  <td className={`num ${row.actual - row.estimated > 0 ? 'money neg' : ''}`}>{inr(row.actual - row.estimated)}</td>
                  <td className="small muted">{row.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tfoot">
              <tr>
                <td>Total</td>
                <td className="num">{inr(costing.estimatedTotalPaise)}</td>
                <td className="num">{inr(costing.actualTotalPaise)}</td>
                <td className="num">{inr(costing.variancePaise)}</td>
                <td className="small muted">Per package {inr(costing.perPackageActualPaise)} actual</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Editable cost lines</h3><span className="badge badge-outline">{costItems.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Category</th><th>Description</th><th className="num">Estimated</th><th className="num">Actual</th><th>Source</th><th></th></tr></thead>
            <tbody>
              {costItems.map((item: any) => (
                <tr key={item.id}>
                  <td className="strong">{categories.find((c) => c.value === item.category)?.label ?? item.category}</td>
                  <td className="small">{item.description ?? '—'}</td>
                  <td className="num">{inr(item.estimated_paise)}</td>
                  <td className="num">{inr(item.actual_paise)}</td>
                  <td className="small muted">{item.auto_generated ? 'Generated' : 'Manual'}</td>
                  <td className="actions-cell">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(item)}>Edit</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => remove(item)}>✕</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {!costItems.length ? <tr><td colSpan={6}><EmptyState title="No manual cost lines" message="Labour, printing and replacement costs can be added here." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="hint-box">
        Estimated product cost uses the frozen BOM unit costs. Actual product cost uses received quantities on purchase orders for this campaign. Shipping actuals come from shipment records. Tax rates are configurable in Settings → Tax & costing and are never hardcoded.
      </div>

      <div className="grid grid-3">
        <div className="card"><div className="card-body"><div className="tag">Profit at estimated cost</div><div className="big-money">{inr(costing.grossProfitEstimatedPaise)}</div><div className="small muted">{costing.marginEstimatedPct}% margin</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">Profit at actual cost</div><div className="big-money">{inr(costing.grossProfitActualPaise)}</div><div className="small muted">{costing.marginActualPct}% margin</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">BOM lines</div><div className="big-money">{bom.length}</div><div className="small muted">{order.recipient_count} package(s)</div></div></div>
      </div>

      {addOpen || editing ? (
        <CostModal
          orderId={order.id}
          existing={editing}
          defaultRate={meta?.settings?.tax?.defaultRatePct}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onDone={() => { setAddOpen(false); setEditing(null); reload(); }}
        />
      ) : null}
      {taxOpen ? <TaxModal orderId={order.id} defaultRate={meta?.settings?.tax?.defaultRatePct ?? 18} onClose={() => setTaxOpen(false)} onDone={() => { setTaxOpen(false); reload(); }} /> : null}
    </div>
  );
}

function CostModal({ orderId, existing, onClose, onDone }: { orderId: number; existing?: any; onClose: () => void; onDone: () => void; defaultRate?: number }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>(existing ?? { category: 'labour', description: '', estimated_paise: 0, actual_paise: 0 });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (existing) await patch(`/orders/costs/${existing.id}`, form);
      else await post(`/orders/${orderId}/costs`, form);
      push('Cost line saved', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? 'Edit cost line' : 'Add cost line'}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save cost</Btn></>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Category">
            <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={categories} />
          </Field>
          <Field label="Description"><Input value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Estimated"><MoneyInput value={form.estimated_paise} onChange={(v) => setForm({ ...form, estimated_paise: v })} /></Field>
          <Field label="Actual"><MoneyInput value={form.actual_paise} onChange={(v) => setForm({ ...form, actual_paise: v })} /></Field>
        </div>
        <div className="hint-box">Estimated is what you expect to pay; actual is what you did pay. Both appear separately in costing and reports.</div>
      </div>
    </Modal>
  );
}

function TaxModal({ orderId, defaultRate, onClose, onDone }: { orderId: number; defaultRate: number; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [rate, setRate] = useState(String(defaultRate));
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await post(`/orders/${orderId}/costs/apply-tax`, { ratePct: Number(rate) });
      push(`Tax applied at ${rate}%`, 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Apply tax"
      subtitle="Creates a tax cost line based on the current estimated costs. Rates are editable — nothing is hardcoded."
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Apply tax</Btn></>}
    >
      <Field label="Tax rate (%)" hint="Defaults come from Settings → Tax & costing. You can override per order.">
        <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
      </Field>
    </Modal>
  );
}
