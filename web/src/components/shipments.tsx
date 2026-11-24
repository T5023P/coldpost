import { useEffect, useState } from 'react';
import { post, patch, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, dateTime, inr } from '../lib/format';
import { Badge, Btn, Field, FileUpload, Input, KeyValue, Loading, Modal, MoneyInput, PhotoGrid, Select, Textarea, useToast } from './ui';

export function RecordShipmentModal({
  orderId,
  recipients,
  onClose,
  onDone,
}: {
  orderId?: number;
  recipients: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const orders = useApi<any>('/orders');
  const [orderIdState, setOrderIdState] = useState(orderId ? String(orderId) : '');
  const [recipientId, setRecipientId] = useState('');
  const [form, setForm] = useState({
    courier_name: '',
    service: '',
    awb: '',
    shipment_date: new Date().toISOString().slice(0, 10),
    weight_g: '',
    dimensions: '',
    cost_paise: 0,
    tracking_url: '',
    pickup_details: '',
    status: 'booked',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bundle = useApi<any>(orderIdState && !orderId ? `/orders/${orderIdState}` : null, [orderIdState]);

  const pool = orderId ? recipients : (bundle.data?.recipients ?? []);
  const eligible = pool.filter(
    (r: any) => ['qc_passed', 'packed', 'ready_to_dispatch'].includes(r.status) && !r.shipment_id,
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await post('/shipments', {
        order_id: Number(orderId ?? orderIdState),
        recipient_id: Number(recipientId),
        ...form,
        weight_g: form.weight_g ? Number(form.weight_g) : null,
      });
      push(`Shipment recorded — AWB ${result.shipment.awb}`, 'good');
      onDone();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record a shipment"
      subtitle="Manual mode: enter the courier and AWB yourself. QC must have passed for this package."
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">Stored as a manual shipment with a full status history.</span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={busy} disabled={!recipientId || !form.courier_name || !form.awb}>Save shipment</Btn>
        </>
      }
    >
      <div className="stack">
        {error ? <div className="alert alert-bad">{error}</div> : null}
        {!orderId ? (
          <Field label="Order">
            <Select
              placeholder="Choose an order"
              value={orderIdState}
              onChange={(e) => { setOrderIdState(e.target.value); setRecipientId(''); }}
              options={(orders.data?.orders ?? []).map((o: any) => ({ value: o.id, label: `${o.ref} — ${o.company_name}` }))}
            />
          </Field>
        ) : null}
        <Field label="Package / recipient" hint={eligible.length ? 'Only QC-passed packages without a shipment are listed.' : 'No packages are ready for dispatch yet.'}>
          <Select
            placeholder={eligible.length ? 'Choose a package' : 'No eligible packages'}
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            options={eligible.map((r: any) => ({ value: r.id, label: `${r.name}${r.city ? ` — ${r.city}` : ''}` }))}
          />
        </Field>
        {orderId && !eligible.length ? (
          <div className="alert alert-warn">This order has no QC-passed packages ready to ship. Complete assembly and QC first.</div>
        ) : null}
        <div className="form-grid">
          <Field label="Courier provider">
            <Input value={form.courier_name} onChange={(e) => setForm({ ...form, courier_name: e.target.value })} placeholder="e.g. Delhivery, Blue Dart, local rider" />
          </Field>
          <Field label="Service">
            <Input value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="Express / Surface" />
          </Field>
          <Field label="AWB / tracking number">
            <Input value={form.awb} onChange={(e) => setForm({ ...form, awb: e.target.value })} placeholder="Tracking number from the courier" />
          </Field>
          <Field label="Shipment date">
            <Input type="date" value={form.shipment_date} onChange={(e) => setForm({ ...form, shipment_date: e.target.value })} />
          </Field>
          <Field label="Package weight (g)">
            <Input type="number" value={form.weight_g} onChange={(e) => setForm({ ...form, weight_g: e.target.value })} placeholder="1200" />
          </Field>
          <Field label="Dimensions">
            <Input value={form.dimensions} onChange={(e) => setForm({ ...form, dimensions: e.target.value })} placeholder="30 × 24 × 12 cm" />
          </Field>
          <Field label="Shipping cost">
            <MoneyInput value={form.cost_paise} onChange={(v) => setForm({ ...form, cost_paise: v })} />
          </Field>
          <Field label="Tracking URL">
            <Input value={form.tracking_url} onChange={(e) => setForm({ ...form, tracking_url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Pickup details" span2>
            <Input value={form.pickup_details} onChange={(e) => setForm({ ...form, pickup_details: e.target.value })} placeholder="Pickup slot, rider name, or drop-off point" />
          </Field>
          <Field label="Initial status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'booked', label: 'Booked (not yet handed over)' }, { value: 'dispatched', label: 'Dispatched' }]} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function ShipmentDetailModal({ shipmentId, onClose, onChanged }: { shipmentId: number; onClose: () => void; onChanged: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const { data, loading, reload } = useApi<any>(`/shipments/${shipmentId}`, [shipmentId]);
  const [status, setStatus] = useState('in_transit');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [eventAt, setEventAt] = useState(new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.shipment) setStatus(data.shipment.status === 'pending' ? 'booked' : data.shipment.status);
  }, [data]);

  async function runAction(key: string, fn: () => Promise<any>, success: string) {
    setBusy(key);
    setError(null);
    try {
      const result = await fn();
      if (result?.test) {
        push(result.message ?? 'Test mode — nothing was booked or sent', 'warn');
      } else {
        push(success, 'good');
      }
      reload();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function updateStatus() {
    await runAction('status', () => post(`/shipments/${shipmentId}/status`, { status, description: description || null, location: location || null, event_at: eventAt ? new Date(eventAt).toISOString() : null }), 'Shipment updated');
    setDescription('');
    setLocation('');
  }

  const shipment = data?.shipment;

  return (
    <Modal
      title={shipment ? `Shipment ${shipment.awb ?? '(no AWB)'}` : 'Shipment'}
      subtitle={shipment ? `${shipment.order_ref} · ${shipment.recipient_name} · ${shipment.courier_name ?? 'Courier not set'}` : undefined}
      wide
      onClose={onClose}
      footer={<><span className="note">Status changes are logged with their source.</span><Btn onClick={onClose}>Close</Btn></>}
    >
      {loading && !data ? <Loading /> : !shipment ? null : (
        <div className="stack">
          {error ? <div className="alert alert-bad">{error}</div> : null}
          {shipment.is_test ? <div className="alert alert-warn">This is a <strong>test-mode booking</strong>. No real shipment exists and it cannot be marked delivered.</div> : null}

          <div className="grid grid-2">
            <div>
              <KeyValue
                rows={[
                  ['Courier', shipment.courier_name],
                  ['Service', shipment.service],
                  ['AWB', shipment.awb ? <a className="mono" href={shipment.tracking_url || '#'} target="_blank" rel="noreferrer">{shipment.awb}</a> : '—'],
                  ['Status', <Badge tone={shipment.status === 'delivered' ? 'good' : shipment.status === 'exception' ? 'bad' : 'info'}>{meta?.enums.shipmentStatuses.find((s) => s.value === shipment.status)?.label ?? shipment.status}</Badge>],
                  ['Mode', shipment.mode === 'api' ? 'API' : 'Manual'],
                ]}
              />
            </div>
            <div>
              <KeyValue
                rows={[
                  ['Shipment date', dateLabel(shipment.shipment_date)],
                  ['Delivered at', shipment.delivered_at ? dateTime(shipment.delivered_at) : '—'],
                  ['Weight', shipment.weight_g ? `${shipment.weight_g} g` : '—'],
                  ['Dimensions', shipment.dimensions],
                  ['Shipping cost', inr(shipment.cost_paise)],
                ]}
              />
            </div>
          </div>

          {shipment.exception_details ? <div className="alert alert-bad">{shipment.exception_details}</div> : null}

          <div className="divider" />

          <div className="grid grid-2">
            <div className="stack">
              <h4>Update status</h4>
              <div className="form-grid">
                <Field label="Status">
                  <Select value={status} onChange={(e) => setStatus(e.target.value)} options={(meta?.enums.shipmentStatuses ?? []).filter((s) => s.value !== 'test_only').map((s) => ({ value: s.value, label: s.label }))} />
                </Field>
                <Field label="Event time">
                  <Input type="datetime-local" value={eventAt} onChange={(e) => setEventAt(e.target.value)} />
                </Field>
                <Field label="Location">
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Hub or city" />
                </Field>
                <Field label="Description" span2>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Picked up by courier" />
                </Field>
              </div>
              <div className="row">
                <Btn variant="primary" onClick={updateStatus} loading={busy === 'status'}>Save status</Btn>
                {shipment.status !== 'delivered' && !shipment.is_test ? (
                  <Btn onClick={() => runAction('deliver', () => post('/feedback/delivery-confirmation', { shipment_id: shipment.id, note: 'Delivery confirmed from shipment record' }), 'Delivery confirmed')} loading={busy === 'deliver'}>
                    Confirm delivery
                  </Btn>
                ) : null}
              </div>
              {meta?.operatingMode === 'api' ? (
                <div className="stack-sm" style={{ marginTop: 6 }}>
                  <div className="tag">API mode actions</div>
                  <div className="row">
                    {!shipment.awb || shipment.is_test ? (
                      <Btn onClick={() => runAction('book', () => post(`/shipments/${shipment.id}/book`, { confirm: true }), 'Shipment booked with provider')} loading={busy === 'book'}>
                        Book with provider
                      </Btn>
                    ) : null}
                    <Btn onClick={() => runAction('track', () => post(`/shipments/${shipment.id}/track`), 'Tracking refreshed')} loading={busy === 'track'} disabled={!shipment.awb}>
                      Refresh tracking
                    </Btn>
                    {data.apiLogs?.some((log: any) => log.status === 'failed') ? (
                      <Btn onClick={() => runAction('retry', () => post(`/shipments/${shipment.id}/retry`), 'Retry succeeded')} loading={busy === 'retry'}>
                        Retry failed booking
                      </Btn>
                    ) : null}
                  </div>
                  <div className="hint-box">API actions use the provider configured in Settings → Integrations. In test mode they validate only and never create a real booking.</div>
                </div>
              ) : (
                <div className="hint-box">Manual mode: book nothing here. Enter the AWB and update statuses as the courier reports them. Switch to API mode in Settings to book through a provider.</div>
              )}
            </div>

            <div className="stack">
              <h4>Tracking history</h4>
              <div className="timeline" style={{ maxHeight: 300, overflowY: 'auto' }}>
                {(data.events ?? []).map((event: any) => (
                  <div className="timeline-item" key={event.id}>
                    <div className={`timeline-dot ${event.status === 'delivered' ? 'good' : event.status === 'exception' ? 'accent' : ''}`} />
                    <div className="timeline-body">
                      <div><strong>{event.status.replace(/_/g, ' ')}</strong>{event.description ? ` — ${event.description}` : ''}</div>
                      <div className="when">{dateTime(event.event_at)} · {event.location ? `${event.location} · ` : ''}{event.source}</div>
                    </div>
                  </div>
                ))}
                {!data.events.length ? <div className="small muted">No events recorded.</div> : null}
              </div>
              <FileUpload entityType="shipment" entityId={shipment.id} kind="label" label="Upload label or proof of delivery" accept="image/*,application/pdf" onDone={() => { reload(); onChanged(); }} />
              <PhotoGrid attachments={data.attachments ?? []} />
            </div>
          </div>

          {(data.apiLogs ?? []).length ? (
            <>
              <div className="divider" />
              <h4>API log</h4>
              <div className="stack-sm">
                {data.apiLogs.map((log: any) => (
                  <div key={log.id} className="row small" style={{ justifyContent: 'space-between' }}>
                    <span><Badge tone={log.status === 'failed' ? 'bad' : 'good'}>{log.status}</Badge> {log.action} · {log.environment}</span>
                    <span className="muted">{dateTime(log.created_at)}{log.error ? ` · ${log.error}` : ''}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
