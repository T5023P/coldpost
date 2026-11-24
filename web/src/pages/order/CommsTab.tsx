import { useState } from 'react';
import { post, useApi } from '../../lib/api';
import { useMeta } from '../../lib/meta';
import { dateTime, relative } from '../../lib/format';
import { Badge, Btn, EmptyState, Field, Modal, Select, Textarea, useToast } from '../../components/ui';

const statusTone: Record<string, string> = {
  prepared: 'neutral',
  copied: 'info',
  sent_manual: 'good',
  sent: 'good',
  failed: 'bad',
  test_only: 'warn',
};

export function CommsTab({ bundle, reload }: { bundle: any; reload: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const { messages, recipients, order } = bundle;

  async function copy(message: any) {
    try {
      await navigator.clipboard.writeText(message.body);
      await post(`/messages/${message.id}/copied`);
      push('Message copied — paste it into WhatsApp', 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  async function markSent(message: any) {
    if (!window.confirm('Confirm you actually sent this message to the customer in WhatsApp. This records a manual send.')) return;
    setBusy(message.id);
    try {
      await post(`/messages/${message.id}/mark-sent`, { note: 'Marked sent by operator from Cold Post' });
      push('Manual send recorded', 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function sendViaApi(message: any) {
    setBusy(message.id);
    try {
      const result = await post(`/messages/${message.id}/send`, { confirm: true });
      push(result.test ? result.providerMessage ?? 'Test mode — nothing was sent' : 'Message sent through WhatsApp', result.test ? 'warn' : 'good');
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function retry(message: any) {
    setBusy(message.id);
    try {
      const result = await post(`/messages/${message.id}/retry`);
      push(result.test ? 'Test mode — nothing sent' : 'Message retried and sent', result.test ? 'warn' : 'good');
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
          <h3>Customer communication</h3>
          <div className="small muted">
            {meta?.operatingMode === 'api'
              ? 'API mode: send through the configured WhatsApp provider. Manual copy remains available as a fallback.'
              : 'Manual mode: prepare the message, copy it into WhatsApp and record that you sent it.'}
          </div>
        </div>
        <span className="spacer" />
        <Btn variant="primary" onClick={() => setPrepareOpen(true)}>+ Prepare message</Btn>
      </div>

      {!messages.length ? (
        <div className="card">
          <EmptyState title="No messages yet" message="Prepare an order confirmation, dispatch or feedback message for this campaign." action={<Btn onClick={() => setPrepareOpen(true)}>Prepare message</Btn>} />
        </div>
      ) : (
        <div className="stack">
          {messages.map((message: any) => (
            <div className="card" key={message.id}>
              <div className="card-head">
                <div>
                  <h4 style={{ fontSize: 15 }}>{message.template_key.replace(/_/g, ' ')}</h4>
                  <div className="xsmall muted">
                    {message.recipient_name ? `To ${message.recipient_name}` : `To ${message.company_name ?? 'customer'}`} · {message.to_phone ?? 'no phone'} · {relative(message.created_at)}
                  </div>
                </div>
                <div className="actions">
                  <Badge tone={statusTone[message.status] ?? 'neutral'}>{message.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
              <div className="card-body stack">
                <div className="hint-box" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                {message.error ? <div className="alert alert-bad">{message.error}</div> : null}
                <div className="row">
                  <Btn size="sm" onClick={() => copy(message)}>Copy message</Btn>
                  {message.to_phone ? (
                    <a className="btn btn-sm" href={`https://wa.me/${message.to_phone.replace(/[^\d]/g, '').replace(/^0+/, '')}?text=${encodeURIComponent(message.body)}`} target="_blank" rel="noreferrer">
                      Open WhatsApp
                    </a>
                  ) : null}
                  {!['sent', 'sent_manual'].includes(message.status) ? (
                    <Btn size="sm" variant="primary" onClick={() => markSent(message)} loading={busy === message.id}>I sent this manually</Btn>
                  ) : null}
                  {meta?.operatingMode === 'api' && !['sent', 'sent_manual'].includes(message.status) ? (
                    <Btn size="sm" onClick={() => sendViaApi(message)} loading={busy === message.id}>Send via WhatsApp API</Btn>
                  ) : null}
                  {message.status === 'failed' ? <Btn size="sm" onClick={() => retry(message)} loading={busy === message.id}>Retry</Btn> : null}
                  <span className="spacer" />
                  {message.sent_at ? <span className="xsmall muted">Recorded sent {dateTime(message.sent_at)}{message.provider_ref ? ` · ref ${message.provider_ref}` : ''}</span> : null}
                </div>
                {message.status === 'prepared' && meta?.operatingMode === 'manual' ? (
                  <div className="xsmall muted">Prepared messages are not sent. Use Copy, send it yourself in WhatsApp, then record it.</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {prepareOpen ? <PrepareModal order={order} recipients={recipients} onClose={() => setPrepareOpen(false)} onDone={() => { setPrepareOpen(false); reload(); }} /> : null}
    </div>
  );
}

function PrepareModal({ order, recipients, onClose, onDone }: { order: any; recipients: any[]; onClose: () => void; onDone: () => void }) {
  const templates = useApi<any>('/messages/templates');
  const { push } = useToast();
  const [templateKey, setTemplateKey] = useState('order_confirmation');
  const [recipientId, setRecipientId] = useState('');
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');

  async function prepare() {
    setBusy(true);
    try {
      const result = await post('/messages/prepare', {
        order_id: order.id,
        recipient_id: recipientId ? Number(recipientId) : null,
        template_key: templateKey,
        ...(body ? { body } : {}),
      });
      push(result.existing ? 'Opened the prepared message' : 'Message prepared', 'good');
      setBody(result.message.body);
      setLink(result.whatsappLink);
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const template = (templates.data?.templates ?? []).find((t: any) => t.key === templateKey);

  return (
    <Modal
      title="Prepare message"
      subtitle={`${order.ref} — ${order.company_name}. Placeholders are filled from the order, recipient and shipment.`}
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">Prepared ≠ sent. Recording a send is a separate, logged action.</span>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={prepare} loading={busy}>Prepare message</Btn>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Message template">
            <Select
              value={templateKey}
              onChange={(e) => { setTemplateKey(e.target.value); setBody(null); }}
              options={(templates.data?.templates ?? []).filter((t: any) => t.active).map((t: any) => ({ value: t.key, label: t.name }))}
            />
          </Field>
          <Field label="Send to">
            <Select placeholder="Primary customer contact" value={recipientId} onChange={(e) => setRecipientId(e.target.value)} options={recipients.map((r: any) => ({ value: r.id, label: `${r.name}${r.city ? ` — ${r.city}` : ''}` }))} />
          </Field>
        </div>
        <Field label="Message body" hint="Edit before preparing if needed. Editing here changes only this message, not the template.">
          <Textarea style={{ minHeight: 220 }} value={body ?? template?.body ?? ''} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {link ? <div className="alert alert-good">Message prepared. <a href={link} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>Open in WhatsApp</a></div> : null}
        <div className="hint-box">
          Available placeholders: {'{{customer_name}} {{contact_person}} {{recipient_name}} {{order_ref}} {{campaign_name}} {{courier}} {{awb}} {{tracking_url}} {{dispatch_date}} {{delivery_address}} {{advance_due}} {{order_value}}'}
        </div>
      </div>
    </Modal>
  );
}
