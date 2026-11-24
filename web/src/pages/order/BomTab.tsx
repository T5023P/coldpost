import { useState } from 'react';
import { del, patch, post, useApi } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { inr } from '../../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../../components/ui';

export function BomTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { push } = useToast();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { order, bom, recipients } = bundle;
  const snapshot = bom.some((line: any) => line.is_snapshot);
  const totalCost = bom.reduce((sum: number, line: any) => sum + line.total_qty * line.unit_cost_paise, 0);
  const perPackage = bom.reduce((sum: number, line: any) => sum + line.qty_per_package * line.unit_cost_paise, 0);

  async function reserveStock() {
    setBusy(true);
    try {
      const result = await post(`/orders/${order.id}/reserve-stock`);
      push(result.reserved?.length ? `Reserved ${result.reserved.length} line(s) from ${order.fulfilment_location_name ?? 'stock'}` : 'No stock could be reserved', result.reserved?.length ? 'good' : 'warn');
      if (result.skipped?.length) push(`Not reserved: ${result.skipped.join('; ')}`, 'warn');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(line: any) {
    if (!window.confirm(`Remove ${line.name_snapshot} from the BOM?`)) return;
    try {
      await del(`/orders/bom/${line.id}`);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Bill of materials</h3>
          <div className="small muted">Quantities scale with the {recipients.length} recipient package{recipients.length === 1 ? '' : 's'}. Costs snapshot at confirmation.</div>
        </div>
        <span className="spacer" />
        {bundle.order.fulfilment_location_id ? <Btn onClick={reserveStock} loading={busy}>Reserve stock</Btn> : null}
        <Btn onClick={() => setAdding(true)}>+ Add component</Btn>
        <Btn variant="primary" onClick={() => setGenerateOpen(true)}>Generate from template</Btn>
      </div>

      {snapshot ? (
        <div className="alert alert-info">
          <div>
            <strong>Confirmed BOM snapshot</strong> — captured {bundle.order.bom_snapshot_at ? new Date(bundle.order.bom_snapshot_at).toLocaleString('en-IN') : ''}. Catalogue changes no longer affect this order.
            <div className="xsmall" style={{ marginTop: 4 }}>Editing a confirmed BOM is an audited override.</div>
          </div>
          <Btn size="sm" variant="ghost" style={{ marginLeft: 'auto' }} onClick={() => setUnlockOpen(true)}>Unlock</Btn>
        </div>
      ) : null}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Component</th><th className="num">Per package</th><th className="num">Total qty</th><th className="num">Unit cost</th><th className="num">Total cost</th><th>Supplier</th><th>Customisation</th><th></th></tr>
            </thead>
            <tbody>
              {bom.map((line: any) => (
                <tr key={line.id}>
                  <td>
                    <div className="strong">{line.name_snapshot}</div>
                    <div className="xsmall muted">{line.sku_snapshot ?? 'No SKU'}{line.product_id ? '' : ' · unlinked'} · {line.cost_category}</div>
                    {line.notes ? <div className="xsmall muted">{line.notes}</div> : null}
                  </td>
                  <td className="num">{line.qty_per_package}</td>
                  <td className="num">{line.total_qty}</td>
                  <td className="num">{inr(line.unit_cost_paise)}</td>
                  <td className="num">{inr(line.total_qty * line.unit_cost_paise)}</td>
                  <td className="small">{line.supplier_name ?? '—'}</td>
                  <td className="small">{line.customisation ?? '—'}</td>
                  <td className="actions-cell">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(line)}>Edit</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => removeLine(line)}>✕</Btn>
                    </div>
                  </td>
                </tr>
              ))}
              {!bom.length ? (
                <tr><td colSpan={8}><EmptyState title="No BOM yet" message="Generate it from a campaign template or add components manually." action={<Btn onClick={() => setGenerateOpen(true)}>Generate BOM</Btn>} /></td></tr>
              ) : null}
            </tbody>
            {bom.length ? (
              <tfoot className="tfoot">
                <tr>
                  <td colSpan={3}>Estimated material cost per package</td>
                  <td className="num" colSpan={2}>{inr(perPackage)}</td>
                  <td colSpan={3} className="small muted">Across {recipients.length} packages: {inr(totalCost)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card"><div className="card-body"><div className="tag">Packaging lines</div><div className="big-money">{bom.filter((l: any) => l.cost_category === 'packaging').length}</div><div className="small muted">Boxes, filler, bands, labels</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">Supplier coverage</div><div className="big-money">{new Set(bom.map((l: any) => l.supplier_id).filter(Boolean)).size}</div><div className="small muted">Distinct suppliers involved</div></div></div>
        <div className="card"><div className="card-body"><div className="tag">Unlinked components</div><div className="big-money">{bom.filter((l: any) => !l.product_id).length}</div><div className="small muted">No catalogue cost attached</div></div></div>
      </div>

      {generateOpen ? <GenerateModal order={order} onClose={() => setGenerateOpen(false)} onDone={() => { setGenerateOpen(false); reload(); }} /> : null}
      {(adding || editing) ? (
        <ComponentModal
          order={order}
          existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onDone={() => { setAdding(false); setEditing(null); reload(); }}
        />
      ) : null}
      {unlockOpen ? <UnlockModal order={order} onClose={() => setUnlockOpen(false)} onDone={() => { setUnlockOpen(false); reload(); }} /> : null}
    </div>
  );
}

function GenerateModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const templates = useApi<any>('/templates');
  const [templateId, setTemplateId] = useState(order.template_id ? String(order.template_id) : '');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await post(`/orders/${order.id}/bom/generate`, {
        template_id: templateId ? Number(templateId) : null,
        replace,
      });
      push(`${result.added} BOM line(s) generated`, 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Generate BOM"
      subtitle="Components are matched to catalogue products by SKU, then by name. Costs come from the procurement city where an offer exists."
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Generate</Btn></>}
    >
      <div className="stack">
        <Field label="Campaign template">
          <Select placeholder="Use the order's template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} options={(templates.data?.templates ?? []).map((t: any) => ({ value: t.id, label: t.name }))} />
        </Field>
        <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing (unconfirmed) BOM lines</label>
        <div className="hint-box">
          {order.procurement_city_name ? `Procurement city: ${order.procurement_city_name}.` : 'No procurement city set — catalogue purchase prices will be used.'} Quantities multiply by the current recipient count.
        </div>
      </div>
    </Modal>
  );
}

function ComponentModal({ order, existing, onClose, onDone }: { order: any; existing?: any; onClose: () => void; onDone: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const products = useApi<any>('/products?active=true');
  const [form, setForm] = useState<any>(
    existing
      ? { ...existing }
      : { product_id: '', name_snapshot: '', sku_snapshot: '', qty_per_package: 1, unit_cost_paise: 0, supplier_id: '', location_id: '', customisation: '', cost_category: 'product', notes: '' },
  );
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        product_id: form.product_id ? Number(form.product_id) : null,
        name_snapshot: form.name_snapshot,
        sku_snapshot: form.sku_snapshot || null,
        qty_per_package: Number(form.qty_per_package),
        unit_cost_paise: Number(form.unit_cost_paise),
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        location_id: form.location_id ? Number(form.location_id) : null,
        customisation: form.customisation || null,
        cost_category: form.cost_category,
        notes: form.notes || null,
      };
      if (existing) await patch(`/orders/bom/${existing.id}`, payload);
      else await post(`/orders/${order.id}/bom`, payload);
      push(existing ? 'BOM line updated' : 'BOM line added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? 'Edit BOM line' : 'Add BOM component'}
      onClose={onClose}
      wide
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name_snapshot}>Save line</Btn></>}
    >
      <div className="form-grid">
        <Field label="Catalogue product" span2>
          <Select
            placeholder="Custom component (no product)"
            value={form.product_id ?? ''}
            onChange={(e) => {
              const product = (products.data?.products ?? []).find((p: any) => String(p.id) === e.target.value);
              setForm((prev: any) => ({
                ...prev,
                product_id: e.target.value,
                name_snapshot: product?.name ?? prev.name_snapshot,
                sku_snapshot: product?.sku ?? prev.sku_snapshot,
                unit_cost_paise: product?.purchase_price_paise ?? prev.unit_cost_paise,
                supplier_id: product?.supplier_id ?? prev.supplier_id,
                customisation: product?.customisation_method ?? prev.customisation,
                cost_category: product?.is_packaging ? 'packaging' : prev.cost_category,
              }));
            }}
            options={(products.data?.products ?? []).map((p: any) => ({ value: p.id, label: `${p.name} — ${p.sku} (${inr(p.purchase_price_paise)})` }))}
          />
        </Field>
        <Field label="Component name"><Input value={form.name_snapshot ?? ''} onChange={(e) => set('name_snapshot', e.target.value)} /></Field>
        <Field label="SKU snapshot"><Input value={form.sku_snapshot ?? ''} onChange={(e) => set('sku_snapshot', e.target.value)} /></Field>
        <Field label="Quantity per package"><Input type="number" min={1} value={form.qty_per_package} onChange={(e) => set('qty_per_package', e.target.value)} /></Field>
        <Field label="Unit cost"><MoneyInput value={Number(form.unit_cost_paise ?? 0)} onChange={(v) => set('unit_cost_paise', v)} /></Field>
        <Field label="Cost category">
          <Select
            value={form.cost_category}
            onChange={(e) => set('cost_category', e.target.value)}
            options={[
              { value: 'product', label: 'Product' },
              { value: 'packaging', label: 'Packaging' },
              { value: 'printing', label: 'Printing' },
            ]}
          />
        </Field>
        <Field label="Supplier">
          <Select placeholder="No supplier" value={form.supplier_id ?? ''} onChange={(e) => set('supplier_id', e.target.value)} options={(meta?.suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Customisation">
          <Select placeholder="None" value={form.customisation ?? ''} onChange={(e) => set('customisation', e.target.value)} options={(meta?.enums.customisationMethods ?? []).map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
        </Field>
        <Field label="Notes" span2><Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <div className="hint-box" style={{ marginTop: 12 }}>
        Total quantity is calculated as {form.qty_per_package || 0} × {order.recipient_count || 1} packages. Catalogue edits never change this line once the order is confirmed.
      </div>
    </Modal>
  );
}

function UnlockModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await post(`/orders/${order.id}/bom/unlock`, { reason });
      push('BOM unlocked — the snapshot stays on record', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Unlock confirmed BOM"
      subtitle="Use this only when the campaign genuinely changes. The confirmed snapshot is retained for audit."
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={reason.trim().length < 5}>Unlock BOM</Btn></>}
    >
      <Field label="Reason for the change" hint="Minimum 5 characters. Recorded against your user.">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Client added a second notebook for each recipient" />
      </Field>
    </Modal>
  );
}
