import { useState } from 'react';
import { post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Badge, Btn, EmptyState, useToast } from '../../components/ui';
import { QcModal } from '../../components/production';

export function QcTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { push } = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const { recipients, qcInspections } = bundle;

  async function pack(recipient: any, stage: string) {
    setBusy(recipient.id);
    try {
      await post(`/recipients/${recipient.id}/pack`, { stage });
      push(stage === 'ready_to_dispatch' ? 'Package ready to dispatch' : 'Package marked packed', 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Quality control</h3>
          <div className="small muted">QC is mandatory. A failed package returns to rework and cannot be dispatched until a later inspection passes.</div>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Package</th><th>Assembly</th><th>QC result</th><th>Inspected</th><th>Package stage</th><th>Actions</th></tr></thead>
            <tbody>
              {recipients.map((recipient: any) => {
                const workOrder = bundle.workOrders.find((w: any) => w.recipient_id === recipient.id);
                return (
                  <tr key={recipient.id}>
                    <td><div className="strong">{recipient.name}</div><div className="xsmall muted">{recipient.city ?? ''}</div></td>
                    <td className="small">{workOrder ? <Badge tone={workOrder.status === 'completed' ? 'good' : 'neutral'}>{workOrder.status}</Badge> : <span className="muted">No work order</span>}</td>
                    <td>{recipient.qc_status ? <Badge tone={recipient.qc_status === 'passed' ? 'good' : 'bad'}>{recipient.qc_status}</Badge> : <span className="small muted">Not inspected</span>}</td>
                    <td className="small muted">{recipient.qc_at ? dateTime(recipient.qc_at) : '—'}</td>
                    <td className="small">{recipient.status.replace(/_/g, ' ')}</td>
                    <td className="actions-cell">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Btn size="sm" onClick={() => setSelected(recipient.id)}>Inspect</Btn>
                        {recipient.qc_status === 'passed' && recipient.status === 'qc_passed' ? <Btn size="sm" onClick={() => pack(recipient, 'packed')} loading={busy === recipient.id}>Mark packed</Btn> : null}
                        {recipient.qc_status === 'passed' && recipient.status === 'packed' ? <Btn size="sm" onClick={() => pack(recipient, 'ready_to_dispatch')} loading={busy === recipient.id}>Ready to dispatch</Btn> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!recipients.length ? <tr><td colSpan={6}><EmptyState title="No packages to inspect" message="Add recipients and complete assembly first." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Inspection history</h3><span className="badge badge-outline">{qcInspections.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Package</th><th>Result</th><th>Inspector</th><th>When</th><th>Notes</th><th className="num">Checks</th></tr></thead>
            <tbody>
              {qcInspections.map((inspection: any) => {
                const checklist = Array.isArray(inspection.checklist) ? inspection.checklist : [];
                return (
                  <tr key={inspection.id}>
                    <td>{inspection.recipient_name}</td>
                    <td><Badge tone={inspection.status === 'passed' ? 'good' : 'bad'}>{inspection.status}</Badge></td>
                    <td className="small">{inspection.inspector_name ?? '—'}</td>
                    <td className="small muted">{dateTime(inspection.inspected_at)}</td>
                    <td className="small" style={{ maxWidth: 280 }}>{inspection.notes ?? '—'}</td>
                    <td className="num">{checklist.filter((c: any) => c.done).length}/{checklist.length}</td>
                  </tr>
                );
              })}
              {!qcInspections.length ? <tr><td colSpan={6}><EmptyState title="No inspections recorded" /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? <QcModal recipientId={selected} onClose={() => setSelected(null)} onChanged={reload} /> : null}
    </div>
  );
}
