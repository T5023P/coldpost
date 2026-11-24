import { useEffect, useState } from 'react';
import { patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateTime } from '../lib/format';
import { Badge, Btn, Field, FileUpload, Input, Loading, Modal, PhotoGrid, Progress, Textarea, useToast } from './ui';

export function WorkOrderModal({ workOrderId, onClose, onChanged }: { workOrderId: number; onClose: () => void; onChanged: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const { data, loading, reload } = useApi<any>(`/work-orders/${workOrderId}`, [workOrderId]);
  const [checklist, setChecklist] = useState<{ label: string; done: boolean }[]>([]);
  const [assigned, setAssigned] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setChecklist(Array.isArray(data.workOrder.checklist) ? data.workOrder.checklist : []);
    setAssigned(data.workOrder.assigned_to ?? '');
    setNotes(data.workOrder.notes ?? '');
  }, [data]);

  const doneCount = checklist.filter((c) => c.done).length;
  const progress = checklist.length ? (doneCount / checklist.length) * 100 : 0;
  const recipientPhotos = (data?.recipientPhotos ?? []).filter((p: any) => ['assembly', 'final', 'qc', 'photo'].includes(p.kind));

  async function save(status?: string) {
    setBusy(true);
    try {
      await patch(`/work-orders/${workOrderId}`, {
        checklist,
        assigned_to: assigned || null,
        notes: notes || null,
        ...(status ? { status } : {}),
      });
      push(status === 'assembling' ? 'Assembly started' : 'Work order saved', 'good');
      reload();
      onChanged();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    setBusy(true);
    try {
      await post(`/work-orders/${workOrderId}/complete`, { checklist, notes });
      push('Assembly complete — package moved to QC', 'good');
      onChanged();
      onClose();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={data ? `Assembly — ${data.workOrder.recipient_name ?? data.workOrder.ref}` : 'Assembly'}
      subtitle={data ? `${data.workOrder.order_ref} · ${data.workOrder.package_type ?? 'Package'}` : undefined}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">{doneCount}/{checklist.length} checks · {recipientPhotos.length} photo(s)</span>
          <Btn onClick={onClose}>Close</Btn>
          <Btn onClick={() => save()} loading={busy}>Save</Btn>
          {data?.workOrder.status === 'queued' ? <Btn onClick={() => save('assembling')} loading={busy}>Start assembly</Btn> : null}
          {data?.workOrder.status !== 'completed' ? <Btn variant="primary" onClick={complete} loading={busy}>Complete assembly → QC</Btn> : null}
        </>
      }
    >
      {loading && !data ? <Loading /> : !data ? null : (
        <div className="stack">
          <div className="row">
            <Badge tone={data.workOrder.status === 'completed' ? 'good' : data.workOrder.status === 'assembling' ? 'warn' : 'neutral'}>
              {data.workOrder.status}
            </Badge>
            <span className="small muted">{data.workOrder.order_ref}</span>
            <span className="spacer" />
            <span className="small muted">Recipient</span>
            <strong style={{ fontSize: 13 }}>{data.workOrder.recipient_name ?? '—'}</strong>
          </div>

          <div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span className="muted">Checklist progress</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} accent />
          </div>

          <div className="grid grid-2">
            <div className="stack">
              <Field label="Assigned to">
                <Input value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Who is assembling this package?" />
              </Field>
              <div className="field">
                <label>Assembly instructions</label>
                <div className="hint-box" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                  {data.workOrder.instructions || 'No instructions recorded for this package.'}
                </div>
              </div>
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the next person should know" />
              </Field>
            </div>
            <div className="stack">
              <div className="field">
                <label>Assembly checklist</label>
                <div className="checklist">
                  {checklist.map((item, index) => (
                    <label key={`${item.label}-${index}`} className={`checklist-item ${item.done ? 'done' : ''}`}>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={(e) => setChecklist((prev) => prev.map((c, i) => (i === index ? { ...c, done: e.target.checked } : c)))}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                  {!checklist.length ? <div className="small muted">No checklist on this work order.</div> : null}
                </div>
              </div>
              <Field label="Required items (BOM)">
                <div className="stack-sm">
                  {(data.bom ?? []).map((line: any) => (
                    <div key={line.id} className="row small" style={{ justifyContent: 'space-between' }}>
                      <span>{line.qty_per_package} × {line.name_snapshot}</span>
                      {line.customisation ? <span className="badge badge-outline">{line.customisation}</span> : null}
                    </div>
                  ))}
                  {!data.bom?.length ? <span className="small muted">Generate the BOM to list required items.</span> : null}
                </div>
              </Field>
            </div>
          </div>

          <div className="divider" />

          <div className="stack">
            <div className="row">
              <h4>Photographs</h4>
              <span className="small muted">Assembly and final package shots are required before QC.</span>
            </div>
            <div className="grid grid-2">
              <div className="stack-sm">
                <FileUpload entityType="work_order" entityId={workOrderId} kind="assembly" label="Upload an assembly photo" onDone={reload} />
                <PhotoGrid attachments={data.photos} />
              </div>
              <div className="stack-sm">
                <FileUpload
                  entityType="recipient"
                  entityId={data.workOrder.recipient_id}
                  kind="final"
                  label="Upload final package photo"
                  onDone={() => { reload(); onChanged(); }}
                />
                <PhotoGrid attachments={recipientPhotos} />
              </div>
            </div>
          </div>

          {data.qc?.length ? (
            <>
              <div className="divider" />
              <div className="stack-sm">
                <h4>QC history</h4>
                {data.qc.map((inspection: any) => (
                  <div key={inspection.id} className="row small" style={{ justifyContent: 'space-between' }}>
                    <span>
                      <Badge tone={inspection.status === 'passed' ? 'good' : 'bad'}>{inspection.status}</Badge>{' '}
                      {inspection.notes ?? ''}
                    </span>
                    <span className="muted">{dateTime(inspection.inspected_at)} · {inspection.inspector_name ?? '—'}</span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          <div className="hint-box">
            Status: <strong>{meta?.enums.packageStatuses.find((s) => s.value === data.workOrder.recipient_status)?.label ?? data.workOrder.recipient_status}</strong>.
            A package cannot be dispatched until QC passes.
          </div>
        </div>
      )}
    </Modal>
  );
}

export function QcModal({ recipientId, onClose, onChanged }: { recipientId: number; onClose: () => void; onChanged: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const { data, loading, reload } = useApi<any>(`/recipients/${recipientId}/qc`, [recipientId]);
  const defaultChecklist: string[] = meta?.settings?.qcChecklist ?? [];
  const [checks, setChecks] = useState<{ label: string; done: boolean; notes?: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<any[]>([]);

  useEffect(() => {
    setChecks(defaultChecklist.map((label) => ({ label, done: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const latest = data?.latest;
  const allChecked = checks.length > 0 && checks.every((c) => c.done);

  async function loadPhotos() {
    const result = await fetch(`/api/attachments?entity_type=recipient&entity_id=${recipientId}`, { credentials: 'same-origin' }).then((r) => r.json());
    setPhotos(result.attachments ?? []);
  }
  useEffect(() => {
    loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientId]);

  async function submit(status: 'passed' | 'failed') {
    setBusy(true);
    try {
      await post(`/recipients/${recipientId}/qc`, { status, checklist: checks, notes: notes || null });
      push(status === 'passed' ? 'QC passed — package can be packed' : 'QC failed — package sent back for rework', status === 'passed' ? 'good' : 'warn');
      reload();
      onChanged();
      if (status === 'passed') onClose();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Quality control"
      subtitle="Every package is inspected against the studio checklist before it can be dispatched."
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">{checks.filter((c) => c.done).length}/{checks.length} checks · {photos.length} photo(s)</span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={() => submit('failed')} loading={busy}>Fail → rework</Btn>
          <Btn variant="primary" onClick={() => submit('passed')} loading={busy} disabled={!allChecked}>Pass QC</Btn>
        </>
      }
    >
      {loading && !data ? <Loading /> : (
        <div className="stack">
          {latest ? (
            <div className={`alert ${latest.status === 'passed' ? 'alert-good' : 'alert-warn'}`}>
              Last inspection: <strong>{latest.status}</strong> on {dateTime(latest.inspected_at)} by {latest.inspector_name ?? '—'}
              {latest.notes ? ` — ${latest.notes}` : ''}
            </div>
          ) : null}

          <div className="stack-sm">
            <div className="row">
              <h4>Final package photographs</h4>
              <span className="small muted">At least one is required to pass QC.</span>
            </div>
            <FileUpload entityType="recipient" entityId={recipientId} kind="qc" label="Upload the final package photograph" onDone={() => { loadPhotos(); reload(); onChanged(); }} />
            <PhotoGrid attachments={photos} />
          </div>

          <div className="divider" />

          <div className="checklist">
            {checks.map((check, index) => (
              <label key={check.label} className={`checklist-item ${check.done ? 'done' : ''}`}>
                <input
                  type="checkbox"
                  checked={check.done}
                  onChange={(e) => setChecks((prev) => prev.map((c, i) => (i === index ? { ...c, done: e.target.checked } : c)))}
                />
                <span>{check.label}</span>
              </label>
            ))}
          </div>

          <Field label="Inspector notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you find? For a failure, note exactly what needs rework." />
          </Field>

          {!allChecked ? <div className="hint-box">Tick every checklist item to enable Pass QC. A failed package returns to assembly and cannot be booked for dispatch.</div> : null}

          {(data?.inspections ?? []).length ? (
            <>
              <div className="divider" />
              <h4>Inspection history</h4>
              <div className="stack-sm">
                {data.inspections.map((inspection: any) => (
                  <div key={inspection.id} className="row small" style={{ justifyContent: 'space-between' }}>
                    <span><Badge tone={inspection.status === 'passed' ? 'good' : 'bad'}>{inspection.status}</Badge> {inspection.notes ?? ''}</span>
                    <span className="muted">{dateTime(inspection.inspected_at)}</span>
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
