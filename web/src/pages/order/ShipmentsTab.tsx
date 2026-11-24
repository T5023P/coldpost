import { useState } from 'react';
import { useMeta } from '../../lib/meta';
import { dateLabel, inr } from '../../lib/format';
import { Badge, Btn, EmptyState } from '../../components/ui';
import { RecordShipmentModal, ShipmentDetailModal } from '../../components/shipments';

export function ShipmentsTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { meta } = useMeta();
  const [recordOpen, setRecordOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const { shipments, recipients } = bundle;
  const eligible = recipients.filter((r: any) => ['qc_passed', 'packed', 'ready_to_dispatch'].includes(r.status) && !r.shipment_id);

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Dispatch & shipping</h3>
          <div className="small muted">
            {meta?.operatingMode === 'api'
              ? 'API mode: book through the configured shipping provider, with manual entry still available.'
              : 'Manual mode: record the courier and AWB yourself and keep tracking updated by hand.'}
          </div>
        </div>
        <span className="spacer" />
        <Btn variant="primary" onClick={() => setRecordOpen(true)} disabled={!eligible.length} title={eligible.length ? '' : 'No QC-passed package is waiting for a shipment'}>
          + Record shipment
        </Btn>
      </div>

      {!eligible.length ? (
        <div className="alert alert-info">
          Shipments can only be created for packages whose QC has passed. {recipients.length === 0 ? 'Add recipients first.' : 'Complete QC on a package to unlock dispatch.'}
        </div>
      ) : null}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>AWB</th><th>Recipient</th><th>Courier</th><th>Status</th><th>Mode</th><th className="num">Cost</th><th>Ship date</th><th>Delivered</th><th></th></tr></thead>
            <tbody>
              {shipments.map((shipment: any) => (
                <tr key={shipment.id} className="clickable" onClick={() => setSelected(shipment.id)}>
                  <td className="mono">{shipment.awb ?? <span className="muted">not booked</span>}</td>
                  <td>{shipment.recipient_name}<div className="xsmall muted">{shipment.recipient_city ?? ''}</div></td>
                  <td>{shipment.courier_name ?? '—'}<div className="xsmall muted">{shipment.service ?? ''}</div></td>
                  <td>
                    <Badge tone={shipment.status === 'delivered' ? 'good' : shipment.status === 'exception' ? 'bad' : shipment.is_test ? 'warn' : 'info'}>{shipment.status.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="small">{shipment.is_test ? 'Test only' : shipment.mode === 'api' ? 'API' : 'Manual'}</td>
                  <td className="num">{inr(shipment.cost_paise)}</td>
                  <td className="small muted">{dateLabel(shipment.shipment_date)}</td>
                  <td className="small muted">{dateLabel(shipment.delivered_at)}</td>
                  <td className="actions-cell"><Btn size="sm" variant="ghost">Open</Btn></td>
                </tr>
              ))}
              {!shipments.length ? <tr><td colSpan={9}><EmptyState title="No shipments yet" message="Once a package passes QC you can record its courier and AWB here." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {recordOpen ? <RecordShipmentModal orderId={bundle.order.id} recipients={recipients} onClose={() => setRecordOpen(false)} onDone={reload} /> : null}
      {selected ? <ShipmentDetailModal shipmentId={selected} onClose={() => setSelected(null)} onChanged={reload} /> : null}
    </div>
  );
}
