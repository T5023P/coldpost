import { useState } from 'react';
import { del, patch, post } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { Btn, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';
import { QcModal } from '../../components/production';
import { WorkOrderModal } from '../../components/production';

const empty = {
  name: '',
  company: '',
  phone: '',
  email: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  pincode: '',
  personalisation: '',
  packaging_notes: '',
  special_instructions: '',
  fulfilment_location_id: '',
};

export function RecipientsTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [qcId, setQcId] = useState<number | null>(null);
  const [woId, setWoId] = useState<number | null>(null);

  async function remove(recipient: any) {
    if (!window.confirm(`Remove ${recipient.name} from this order? This cannot be undone.`)) return;
    try {
      await del(`/orders/recipients/${recipient.id}`);
      push('Recipient removed', 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Recipient packages</h3>
          <div className="small muted">Each recipient has their own address, contents, QC record and shipment.</div>
        </div>
        <span className="spacer" />
        <Btn variant="ghost" onClick={() => setBulk(true)}>Bulk add</Btn>
        <Btn variant="primary" onClick={() => setAddOpen(true)}>+ Add recipient</Btn>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Recipient</th><th>Delivery address</th><th>Fulfilment</th><th>Status</th><th>QC</th><th>Shipment</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {bundle.recipients.map((recipient: any) => {
                const workOrder = bundle.workOrders.find((w: any) => w.recipient_id === recipient.id);
                return (
                  <tr key={recipient.id}>
                    <td>
                      <div className="strong">{recipient.name}</div>
                      <div className="xsmall muted">{recipient.company ?? recipient.phone ?? '—'}</div>
                      {recipient.unboxing_code ? <div className="xsmall muted">Unboxing code {recipient.unboxing_code}</div> : null}
                    </td>
                    <td className="small" style={{ maxWidth: 260 }}>
                      {[recipient.address_line1, recipient.address_line2, recipient.city, recipient.state, recipient.pincode].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="small">{recipient.fulfilment_location_name ?? '—'}<div className="xsmall muted">{recipient.fulfilment_city ?? ''}</div></td>
                    <td><span className="badge badge-outline">{meta?.enums.packageStatuses.find((s) => s.value === recipient.status)?.label ?? recipient.status}</span></td>
                    <td>{recipient.qc_status ? <span className={`badge badge-${recipient.qc_status === 'passed' ? 'good' : 'bad'}`}>{recipient.qc_status}</span> : <span className="small muted">Not inspected</span>}</td>
                    <td className="small">{recipient.awb ? <div><span className="mono">{recipient.awb}</span><div className="xsmall muted">{recipient.shipment_status}</div></div> : <span className="muted">—</span>}</td>
                    <td className="actions-cell">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        {workOrder ? <Btn size="sm" onClick={() => setWoId(workOrder.id)}>Assembly</Btn> : null}
                        <Btn size="sm" onClick={() => setQcId(recipient.id)}>QC</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setEditing(recipient)}>Edit</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => remove(recipient)} title="Remove">✕</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!bundle.recipients.length ? (
                <tr><td colSpan={7}><EmptyState title="No recipients yet" message="Add the people who will receive a package." action={<Btn onClick={() => setAddOpen(true)}>Add recipient</Btn>} /></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {bundle.recipients.some((r: any) => r.personalisation || r.packaging_notes || r.special_instructions) ? (
        <div className="card">
          <div className="card-head"><h3>Personalisation & packing notes</h3></div>
          <div className="card-body stack">
            {bundle.recipients.map((recipient: any) =>
              recipient.personalisation || recipient.packaging_notes || recipient.special_instructions ? (
                <div key={recipient.id} className="small">
                  <strong>{recipient.name}</strong>
                  {recipient.personalisation ? <div className="muted">Personalisation: {recipient.personalisation}</div> : null}
                  {recipient.packaging_notes ? <div className="muted">Packaging: {recipient.packaging_notes}</div> : null}
                  {recipient.special_instructions ? <div className="muted">Instructions: {recipient.special_instructions}</div> : null}
                </div>
              ) : null,
            )}
          </div>
        </div>
      ) : null}

      {addOpen ? <RecipientModal orderId={bundle.order.id} locations={meta?.locations ?? []} onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); reload(); }} /> : null}
      {bulk ? <BulkRecipientModal orderId={bundle.order.id} locations={meta?.locations ?? []} onClose={() => setBulk(false)} onDone={() => { setBulk(false); reload(); }} /> : null}
      {editing ? <RecipientModal orderId={bundle.order.id} locations={meta?.locations ?? []} existing={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} /> : null}
      {qcId ? <QcModal recipientId={qcId} onClose={() => setQcId(null)} onChanged={reload} /> : null}
      {woId ? <WorkOrderModal workOrderId={woId} onClose={() => setWoId(null)} onChanged={reload} /> : null}
    </div>
  );
}

function RecipientModal({
  orderId,
  locations,
  existing,
  onClose,
  onDone,
}: {
  orderId: number;
  locations: any[];
  existing?: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState<any>(existing ? { ...empty, ...existing, fulfilment_location_id: existing.fulfilment_location_id ?? '' } : empty);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        fulfilment_location_id: form.fulfilment_location_id ? Number(form.fulfilment_location_id) : null,
      };
      if (existing) await patch(`/orders/recipients/${existing.id}`, payload);
      else await post(`/orders/${orderId}/recipients`, payload);
      push(existing ? 'Recipient updated' : 'Recipient added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : 'Add recipient package'}
      subtitle="Addresses are used for labels and WhatsApp notifications."
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name.trim()}>{existing ? 'Save recipient' : 'Add recipient'}</Btn></>}
    >
      <div className="form-grid">
        <Field label="Recipient name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Company"><Input value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} /></Field>
        <Field label="Phone (WhatsApp)"><Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91…" /></Field>
        <Field label="Email"><Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address line 1" span2><Input value={form.address_line1 ?? ''} onChange={(e) => set('address_line1', e.target.value)} /></Field>
        <Field label="Address line 2" span2><Input value={form.address_line2 ?? ''} onChange={(e) => set('address_line2', e.target.value)} /></Field>
        <Field label="City"><Input value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="State"><Input value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} /></Field>
        <Field label="Pincode"><Input value={form.pincode ?? ''} onChange={(e) => set('pincode', e.target.value)} /></Field>
        <Field label="Fulfil from">
          <Select placeholder="Use order default" value={form.fulfilment_location_id} onChange={(e) => set('fulfilment_location_id', e.target.value)} options={locations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
        </Field>
        <Field label="Personalisation" span2><Textarea value={form.personalisation ?? ''} onChange={(e) => set('personalisation', e.target.value)} placeholder="Name spelling, letter copy, QR destination…" /></Field>
        <Field label="Packaging notes"><Textarea value={form.packaging_notes ?? ''} onChange={(e) => set('packaging_notes', e.target.value)} /></Field>
        <Field label="Special instructions"><Textarea value={form.special_instructions ?? ''} onChange={(e) => set('special_instructions', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function BulkRecipientModal({ orderId, locations, onClose, onDone }: { orderId: number; locations: any[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [text, setText] = useState('');
  const [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, company, phone, address, city, state, pincode] = line.split(',').map((part) => part.trim());
      return { name, company, phone, address_line1: address, city, state, pincode };
    });

  async function submit() {
    setBusy(true);
    try {
      await post(`/orders/${orderId}/recipients`, {
        recipients: rows.map((row) => ({ ...row, fulfilment_location_id: locationId ? Number(locationId) : null })),
      });
      push(`${rows.length} recipient packages added`, 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Bulk add recipients"
      subtitle="One recipient per line, comma separated."
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!rows.length}>Add {rows.length || ''} recipients</Btn></>}
    >
      <div className="stack">
        <Field label="Recipients" hint="Order: Name, Company, Phone, Address, City, State, Pincode">
          <Textarea
            style={{ minHeight: 180, fontFamily: 'var(--mono)', fontSize: 12 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Aarav Sharma, Lumen Labs, +91 98100 30001, 12 Gomti Nagar, Lucknow, Uttar Pradesh, 226010\nMeera Iyer, Iyer & Co, +91 98100 30002, 44 Indiranagar, Bengaluru, Karnataka, 560038'}
          />
        </Field>
        <Field label="Fulfil all from">
          <Select placeholder="Use order default" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
        </Field>
        {rows.length ? (
          <div className="hint-box">
            {rows.length} row(s) detected. Unboxing codes are generated automatically; they are a surprise element, not a security control.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
