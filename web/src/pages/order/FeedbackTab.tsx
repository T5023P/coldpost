import { useState } from 'react';
import { patch, post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Modal, Select, Textarea, useToast } from '../../components/ui';

export function FeedbackTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { push } = useToast();
  const [recordOpen, setRecordOpen] = useState(false);
  const [issueEditing, setIssueEditing] = useState<any>(null);
  const { feedback, issues, order, recipients } = bundle;

  async function resolve(issue: any, status: string) {
    try {
      await patch(`/feedback/issues/${issue.id}`, { status, resolution: status === 'resolved' ? issue.resolution ?? 'Resolved by the studio' : issue.resolution });
      push('Issue updated', 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h3>Customer feedback</h3>
          <div className="small muted">Record delivery confirmation, ratings and any missing or damaged items.</div>
        </div>
        <span className="spacer" />
        <Btn variant="primary" onClick={() => setRecordOpen(true)}>+ Record feedback</Btn>
      </div>

      <div className="card">
        <div className="card-head"><h3>Feedback</h3><span className="badge badge-outline">{feedback.length}</span></div>
        {!feedback.length ? <EmptyState title="No feedback recorded" message="After delivery, capture how the package landed." action={<Btn onClick={() => setRecordOpen(true)}>Record feedback</Btn>} /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Rating</th><th>Delivery confirmed</th><th>Comments</th><th>Packaging</th><th>Repeat</th><th>Recorded</th></tr></thead>
              <tbody>
                {feedback.map((entry: any) => (
                  <tr key={entry.id}>
                    <td><strong>{entry.rating ? `${entry.rating} ★` : '—'}</strong></td>
                    <td>{entry.delivery_confirmed ? <Badge tone="good">Yes</Badge> : <Badge tone="neutral">Not confirmed</Badge>}</td>
                    <td className="small" style={{ maxWidth: 340 }}>{entry.comments ?? '—'}{entry.missing_items ? <div className="xsmall" style={{ color: 'var(--bad)' }}>Missing: {entry.missing_items}</div> : null}{entry.damaged_items ? <div className="xsmall" style={{ color: 'var(--bad)' }}>Damaged: {entry.damaged_items}</div> : null}</td>
                    <td className="small">{entry.packaging_feedback ?? '—'}</td>
                    <td className="small">{entry.repeat_interest ? 'Yes' : 'No'}</td>
                    <td className="small muted">{dateTime(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>Issues & investigations</h3><span className="badge badge-outline">{issues.length}</span></div>
        {!issues.length ? <EmptyState title="No open issues" message="Missing or damaged item reports appear here automatically." /> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Type</th><th>Description</th><th>Status</th><th>Resolution</th><th>Raised</th><th></th></tr></thead>
              <tbody>
                {issues.map((issue: any) => (
                  <tr key={issue.id}>
                    <td><Badge tone={issue.type === 'damaged' ? 'bad' : 'warn'}>{issue.type}</Badge></td>
                    <td className="small" style={{ maxWidth: 320 }}>{issue.description}</td>
                    <td><Badge tone={issue.status === 'resolved' ? 'good' : issue.status === 'open' ? 'bad' : 'warn'}>{issue.status}</Badge></td>
                    <td className="small">{issue.resolution ?? '—'}</td>
                    <td className="small muted">{dateTime(issue.created_at)}</td>
                    <td className="actions-cell">
                      <Btn size="sm" variant="ghost" onClick={() => setIssueEditing(issue)}>Update</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {recordOpen ? <FeedbackModal order={order} recipients={recipients} onClose={() => setRecordOpen(false)} onDone={() => { setRecordOpen(false); reload(); }} /> : null}
      {issueEditing ? (
        <IssueModal issue={issueEditing} onClose={() => setIssueEditing(null)} onDone={() => { setIssueEditing(null); reload(); }} />
      ) : null}
      <div className="hint-box">
        A delivery confirmation here is a record of what the customer told you. Courier proof belongs on the shipment. Unboxing codes are a delight detail, never proof of delivery.
      </div>
    </div>
  );
}

function FeedbackModal({ order, recipients, onClose, onDone }: { order: any; recipients: any[]; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>({
    recipient_id: '',
    delivery_confirmed: true,
    rating: 5,
    comments: '',
    missing_items: '',
    damaged_items: '',
    packaging_feedback: '',
    overall_experience: 'Excellent',
    repeat_interest: false,
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await post('/feedback', {
        order_id: order.id,
        ...form,
        recipient_id: form.recipient_id ? Number(form.recipient_id) : null,
        rating: form.rating ? Number(form.rating) : null,
      });
      push('Feedback recorded', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Record feedback"
      subtitle={`${order.ref} — ${order.company_name}`}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save feedback</Btn></>}
    >
      <div className="form-grid">
        <Field label="Package (optional)">
          <Select placeholder="Whole order" value={form.recipient_id} onChange={(e) => setForm({ ...form, recipient_id: e.target.value })} options={recipients.map((r: any) => ({ value: r.id, label: r.name }))} />
        </Field>
        <Field label="Rating">
          <Select value={String(form.rating)} onChange={(e) => setForm({ ...form, rating: e.target.value })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} star${n === 1 ? '' : 's'}` }))} />
        </Field>
        <Field label="Delivery confirmed" span2>
          <label className="check"><input type="checkbox" checked={form.delivery_confirmed} onChange={(e) => setForm({ ...form, delivery_confirmed: e.target.checked })} /> Customer confirmed they received the package</label>
        </Field>
        <Field label="Comments" span2><Textarea value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></Field>
        <Field label="Missing items"><Input value={form.missing_items} onChange={(e) => setForm({ ...form, missing_items: e.target.value })} placeholder="Opens an investigation" /></Field>
        <Field label="Damaged items"><Input value={form.damaged_items} onChange={(e) => setForm({ ...form, damaged_items: e.target.value })} /></Field>
        <Field label="Packaging feedback"><Input value={form.packaging_feedback} onChange={(e) => setForm({ ...form, packaging_feedback: e.target.value })} /></Field>
        <Field label="Overall experience"><Input value={form.overall_experience} onChange={(e) => setForm({ ...form, overall_experience: e.target.value })} /></Field>
        <Field label="Repeat order interest" span2>
          <label className="check"><input type="checkbox" checked={form.repeat_interest} onChange={(e) => setForm({ ...form, repeat_interest: e.target.checked })} /> The customer would order again</label>
        </Field>
      </div>
    </Modal>
  );
}

function IssueModal({ issue, onClose, onDone }: { issue: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState({ status: issue.status, resolution: issue.resolution ?? '' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await patch(`/feedback/issues/${issue.id}`, form);
      push('Issue updated', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Investigate issue"
      subtitle={issue.description}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save</Btn></>}
    >
      <div className="stack">
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'open', label: 'Open' }, { value: 'investigating', label: 'Investigating' }, { value: 'resolved', label: 'Resolved' }, { value: 'rejected', label: 'Rejected / not our fault' }]} />
        </Field>
        <Field label="Resolution">
          <Textarea value={form.resolution} onChange={(e) => setForm({ ...form, resolution: e.target.value })} placeholder="What did you agree with the customer?" />
        </Field>
      </div>
    </Modal>
  );
}
