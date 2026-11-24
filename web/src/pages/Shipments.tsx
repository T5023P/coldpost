import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Loading, PageHead, SearchInput, Select, Stat } from '../components/ui';
import { RecordShipmentModal, ShipmentDetailModal } from '../components/shipments';

export function Shipments() {
  const { meta } = useMeta();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (mode) params.set('mode', mode);
    return params.toString();
  }, [status, search, mode]);

  const { data, loading, error, reload } = useApi<any>(`/shipments?${query}`, [query]);
  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;

  const shipments = data?.shipments ?? [];
  const shippingProvider = (data?.providers ?? []).find((p: any) => p.kind === 'shipping');
  const trackingProvider = (data?.providers ?? []).find((p: any) => p.kind === 'tracking');
  const delivered = shipments.filter((s: any) => s.status === 'delivered').length;
  const exceptions = shipments.filter((s: any) => s.status === 'exception').length;

  return (
    <>
      <PageHead
        title="Shipment desk"
        subtitle="One shipment record per package. Manual entry works out of the box; API mode books through your configured provider."
        actions={<Btn variant="primary" onClick={() => setRecordOpen(true)}>+ Record shipment</Btn>}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="tag">Operating mode</div>
              <div style={{ fontWeight: 600, marginTop: 3 }}>{meta?.operatingMode === 'api' ? 'API mode' : 'Manual mode'}</div>
              <div className="small muted" style={{ marginTop: 3 }}>
                {meta?.operatingMode === 'api' ? 'Bookings and tracking use the providers below.' : 'Enter courier and AWB manually, then update status as the courier reports.'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="tag">Shipping provider</div>
              <div className="row" style={{ marginTop: 4 }}>
                <strong style={{ fontSize: 13 }}>{shippingProvider?.name ?? 'Not configured'}</strong>
                <Badge tone={shippingProvider?.configured ? (shippingProvider.environment === 'live' ? 'good' : 'warn') : 'bad'}>
                  {shippingProvider?.configured ? `${shippingProvider.environment}` : 'NOT CONNECTED'}
                </Badge>
              </div>
              <div className="xsmall muted" style={{ marginTop: 2 }}>{shippingProvider?.configured ? 'Ready for API bookings' : (shippingProvider?.missing?.join(', ') || 'No provider configured')}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="tag">Tracking provider</div>
              <div className="row" style={{ marginTop: 4 }}>
                <strong style={{ fontSize: 13 }}>{trackingProvider?.name ?? 'Not configured'}</strong>
                <Badge tone={trackingProvider?.configured ? 'good' : 'bad'}>{trackingProvider?.configured ? 'Connected' : 'NOT CONNECTED'}</Badge>
              </div>
              <div className="xsmall muted" style={{ marginTop: 2 }}>Manual tracking always works via status updates.</div>
            </div>
            <Link to="/settings" className="btn">Configure providers</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Shipments" value={shipments.length} foot={`${shipments.filter((s: any) => s.is_test).length} test-mode records`} />
        <Stat label="In transit" value={shipments.filter((s: any) => ['booked', 'dispatched', 'in_transit', 'out_for_delivery'].includes(s.status)).length} foot="With a courier" />
        <Stat label="Delivered" value={delivered} foot="Confirmed by you or the carrier" />
        <Stat label="Exceptions" value={exceptions} foot="Need attention" tone={exceptions ? 'bad' : undefined} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={search} onChange={setSearch} placeholder="Search AWB, recipient, order or courier…" /></div>
          <Select placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} options={(meta?.enums.shipmentStatuses ?? []).map((s) => ({ value: s.value, label: s.label }))} style={{ width: 190 }} />
          <Select placeholder="All modes" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'manual', label: 'Manual' }, { value: 'api', label: 'API' }]} style={{ width: 140 }} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>AWB</th><th>Order</th><th>Recipient</th><th>Courier</th><th>Status</th><th>Mode</th><th className="num">Cost</th><th>Shipped</th><th>Delivered</th></tr></thead>
            <tbody>
              {shipments.map((shipment: any) => (
                <tr key={shipment.id} className="clickable" onClick={() => setSelected(shipment.id)}>
                  <td className="mono">{shipment.awb ?? <span className="muted">not booked</span>}</td>
                  <td className="mono small">{shipment.order_ref}</td>
                  <td>{shipment.recipient_name}<div className="xsmall muted">{shipment.recipient_city ?? ''}</div></td>
                  <td className="small">{shipment.courier_name ?? '—'}<div className="xsmall muted">{shipment.service ?? ''}</div></td>
                  <td><Badge tone={shipment.status === 'delivered' ? 'good' : ['exception', 'returned'].includes(shipment.status) ? 'bad' : shipment.is_test ? 'warn' : 'info'}>{shipment.status.replace(/_/g, ' ')}</Badge></td>
                  <td className="small">{shipment.is_test ? 'Test only' : shipment.mode === 'api' ? 'API' : 'Manual'}</td>
                  <td className="num">{inr(shipment.cost_paise)}</td>
                  <td className="small muted">{dateLabel(shipment.shipment_date)}</td>
                  <td className="small muted">{dateLabel(shipment.delivered_at)}</td>
                </tr>
              ))}
              {!shipments.length ? <tr><td colSpan={9}><EmptyState title="No shipments yet" message="Record one manually, or book through a provider in API mode." action={<Btn onClick={() => setRecordOpen(true)}>Record shipment</Btn>} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {recordOpen ? <RecordShipmentModal recipients={[]} onClose={() => setRecordOpen(false)} onDone={reload} /> : null}
      {selected ? <ShipmentDetailModal shipmentId={selected} onClose={() => setSelected(null)} onChanged={reload} /> : null}
    </>
  );
}
