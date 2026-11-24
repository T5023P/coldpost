import { useState } from 'react';
import { post } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { dateLabel } from '../../lib/format';
import { Badge, Btn, EmptyState, Progress, useToast } from '../../components/ui';
import { WorkOrderModal } from '../../components/production';

export function ProductionTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { order, workOrders, recipients } = bundle;

  async function generate() {
    setBusy(true);
    try {
      const result = await post(`/orders/${order.id}/work-orders`);
      push(`${result.created} work order(s) created — packages are ready for assembly`, 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Production</h3>
          <div className="small muted">One work order per recipient package, with the assembly checklist, instructions and photographs.</div>
        </div>
        <span className="spacer" />
        {!workOrders.length && recipients.length ? <Btn variant="primary" onClick={generate} loading={busy}>Generate work orders</Btn> : null}
      </div>

      {!workOrders.length ? (
        <div className="card">
          <EmptyState
            title="No work orders yet"
            message={recipients.length ? 'Generate one work order per recipient package from the confirmed order.' : 'Add recipient packages first.'}
            action={recipients.length ? <Btn onClick={generate} loading={busy}>Generate work orders</Btn> : null}
          />
        </div>
      ) : (
        <div className="grid grid-3">
          {workOrders.map((workOrder: any) => {
            const checklist = Array.isArray(workOrder.checklist) ? workOrder.checklist : [];
            const done = checklist.filter((item: any) => item.done).length;
            const progress = checklist.length ? (done / checklist.length) * 100 : 0;
            const recipient = recipients.find((r: any) => r.id === workOrder.recipient_id);
            return (
              <div key={workOrder.id} className="card">
                <div className="card-body stack">
                  <div className="row">
                    <div>
                      <div className="tag">{workOrder.ref}</div>
                      <h4 style={{ marginTop: 2 }}>{workOrder.recipient_name ?? 'Unassigned package'}</h4>
                      <div className="xsmall muted">{recipient?.city ?? ''} {recipient?.company ? `· ${recipient.company}` : ''}</div>
                    </div>
                    <span className="spacer" />
                    <Badge tone={workOrder.status === 'completed' ? 'good' : workOrder.status === 'assembling' ? 'warn' : 'neutral'}>{workOrder.status}</Badge>
                  </div>
                  <div>
                    <div className="row small muted" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                      <span>{done}/{checklist.length} checklist</span>
                      <span>{recipient?.status ? meta?.enums.packageStatuses.find((s) => s.value === recipient.status)?.label : ''}</span>
                    </div>
                    <Progress value={progress} accent />
                  </div>
                  <div className="small muted">Assigned: {workOrder.assigned_to ?? 'unassigned'}</div>
                  <div className="small muted">Started {dateLabel(workOrder.start_date)} · completed {dateLabel(workOrder.completion_date)}</div>
                  <Btn onClick={() => setSelected(workOrder.id)}>Open assembly</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="hint-box">
        Assembly videos and photographs can be uploaded inside each work order (MP4, WebM or images). A package cannot be completed without at least one photograph and a full checklist, and cannot pass QC without a final photograph.
      </div>

      {selected ? <WorkOrderModal workOrderId={selected} onClose={() => setSelected(null)} onChanged={reload} /> : null}
    </div>
  );
}
