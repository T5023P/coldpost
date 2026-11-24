import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel } from '../lib/format';
import { Badge, Btn, EmptyState, Loading, PageHead, Progress, Stat } from '../components/ui';
import { QcModal, WorkOrderModal } from '../components/production';

export function Production() {
  const { meta } = useMeta();
  const { data, loading, error, reload } = useApi<any>('/production/board');
  const [workOrderId, setWorkOrderId] = useState<number | null>(null);
  const [qcRecipient, setQcRecipient] = useState<number | null>(null);

  if (loading && !data) return <Loading label="Loading the production board…" />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;

  const columns = [
    { key: 'queued', label: 'Queued', tone: 'neutral', hint: 'Work orders waiting to start' },
    { key: 'assembling', label: 'Assembling', tone: 'warn', hint: 'Packages on the table now' },
    { key: 'completed', label: 'Assembled', tone: 'good', hint: 'Moved to quality control' },
  ];

  return (
    <>
      <PageHead title="Production" subtitle="Follow every package from an empty box to a sealed, photographed parcel." />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Queued" value={data.totals.queued} foot="Awaiting an assembler" />
        <Stat label="Assembling" value={data.totals.assembling} foot="On the bench" />
        <Stat label="Awaiting QC" value={data.totals.qcPending} foot="Needs inspection" tone={data.totals.qcPending ? 'warn' : undefined} />
        <Stat label="Rework" value={data.totals.rework} foot="Failed QC at least once" tone={data.totals.rework ? 'bad' : undefined} />
      </div>

      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        {columns.map((column) => (
          <div className="card" key={column.key}>
            <div className="card-head">
              <h3>{column.label}</h3>
              <span className={`badge badge-${column.tone}`}>{data.columns[column.key].length}</span>
            </div>
            <div className="card-body stack" style={{ minHeight: 160 }}>
              {data.columns[column.key].map((workOrder: any) => {
                const checklist = Array.isArray(workOrder.checklist) ? workOrder.checklist : [];
                const done = checklist.filter((item: any) => item.done).length;
                return (
                  <div key={workOrder.id} className="card" style={{ boxShadow: 'none', background: '#fdfaf4' }}>
                    <div className="card-body tight stack" style={{ gap: 8 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span className="mono xsmall">{workOrder.ref}</span>
                        {workOrder.photo_count ? <span className="badge badge-outline">{workOrder.photo_count} photos</span> : null}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{workOrder.recipient_name ?? 'Package'}</div>
                        <Link to={`/orders/${workOrder.order_id}`} className="xsmall muted" style={{ textDecoration: 'underline' }}>
                          {workOrder.order_ref} · {workOrder.campaign_name}
                        </Link>
                      </div>
                      <div className="xsmall muted">{workOrder.recipient_city ?? ''} {workOrder.assigned_to ? `· ${workOrder.assigned_to}` : ''}</div>
                      <Progress value={checklist.length ? (done / checklist.length) * 100 : 0} accent />
                      <div className="row">
                        <span className="xsmall muted">{done}/{checklist.length} checks</span>
                        <span className="spacer" />
                        <Btn size="sm" onClick={() => setWorkOrderId(workOrder.id)}>{workOrder.status === 'completed' ? 'View' : 'Assemble'}</Btn>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!data.columns[column.key].length ? <EmptyState title={`No ${column.label.toLowerCase()} work orders`} message={column.hint} /> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><h3>QC queue</h3><span className="badge badge-outline">{data.qcQueue.length}</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Package</th><th>Order</th><th>Stage</th><th>Photos</th><th></th></tr></thead>
              <tbody>
                {data.qcQueue.map((recipient: any) => (
                  <tr key={recipient.id}>
                    <td><div className="strong">{recipient.name}</div><div className="xsmall muted">{recipient.city ?? ''}</div></td>
                    <td><Link to={`/orders/${recipient.order_id}`} className="mono small" style={{ textDecoration: 'underline' }}>{recipient.order_ref}</Link></td>
                    <td><Badge tone={['qc_pending'].includes(recipient.status) ? 'warn' : ['qc_failed', 'rework'].includes(recipient.status) ? 'bad' : 'neutral'}>{meta?.enums.packageStatuses.find((s) => s.value === recipient.status)?.label ?? recipient.status}</Badge></td>
                    <td className="small">{recipient.photo_count}</td>
                    <td className="actions-cell"><Btn size="sm" onClick={() => setQcRecipient(recipient.id)}>Inspect</Btn></td>
                  </tr>
                ))}
                {!data.qcQueue.length ? <tr><td colSpan={5}><EmptyState title="QC queue is clear" message="Completed assemblies will appear here." /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Ready to pack</h3><span className="badge badge-outline">{data.readyToPack.length}</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Package</th><th>Order</th><th>Stage</th></tr></thead>
              <tbody>
                {data.readyToPack.map((recipient: any) => (
                  <tr key={recipient.id}>
                    <td>{recipient.name}<div className="xsmall muted">{recipient.city ?? ''}</div></td>
                    <td><Link to={`/orders/${recipient.order_id}`} className="mono small" style={{ textDecoration: 'underline' }}>{recipient.order_ref}</Link></td>
                    <td className="small">{recipient.status.replace(/_/g, ' ')}<div className="xsmall muted">QC {dateLabel(recipient.updated_at)}</div></td>
                  </tr>
                ))}
                {!data.readyToPack.length ? <tr><td colSpan={3}><EmptyState title="Nothing packed yet" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {workOrderId ? <WorkOrderModal workOrderId={workOrderId} onClose={() => setWorkOrderId(null)} onChanged={reload} /> : null}
      {qcRecipient ? <QcModal recipientId={qcRecipient} onClose={() => setQcRecipient(null)} onChanged={reload} /> : null}
    </>
  );
}
