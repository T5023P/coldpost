import { useMemo, useState } from 'react';
import { patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateTime, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Loading, Modal, MoneyInput, PageHead, SearchInput, Select, Tabs, Textarea, useToast } from '../components/ui';
import { useAuth } from '../lib/auth';

type Tab = 'business' | 'commercial' | 'quality' | 'templates' | 'messaging' | 'integrations' | 'users' | 'activity';

export function Settings() {
  const { reload: reloadMeta } = useMeta();
  const { push } = useToast();
  const { data, loading, error, reload } = useApi<any>('/settings');
  const [tab, setTab] = useState<Tab>('business');
  const [modeBusy, setModeBusy] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [resetting, setResetting] = useState<any>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [templateEditing, setTemplateEditing] = useState<any>(null);

  if (loading && !data) return <Loading label="Loading settings…" />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;

  const mode = data.operatingMode;

  async function switchMode(next: 'manual' | 'api') {
    if (next === mode) return;
    const message =
      next === 'api'
        ? 'Switch to API mode? Existing orders, shipments and messages are untouched. Nothing is booked or resent automatically.'
        : 'Switch to Manual mode? Existing API bookings and message logs stay exactly as they are.';
    if (!window.confirm(message)) return;
    setModeBusy(true);
    try {
      const result = await post('/settings/mode', { mode: next, note: 'Changed from Settings' });
      push(`Operating mode is now ${next.toUpperCase()}${result.unchanged ? ' — no orders or messages were modified' : ''}`, 'good');
      reload();
      reloadMeta();
    } catch (err) {
      push((err as Error).message, 'bad');
    } finally {
      setModeBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Settings" subtitle="Business details, commercial defaults, quality standards, integrations and access." />

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head">
            <h3>Operating mode</h3>
            <div className="actions"><span className={`badge badge-${mode === 'api' ? 'info' : 'good'}`}>{mode === 'api' ? 'API mode' : 'Manual mode'}</span></div>
          </div>
          <div className="card-body stack">
            <p className="small muted">
              Manual mode works entirely without API keys. API mode uses the configured providers for shipments, tracking and WhatsApp — everything else keeps working the same way.
            </p>
            <div className="row">
              <Btn variant={mode === 'manual' ? 'primary' : 'default'} onClick={() => switchMode('manual')} loading={modeBusy}>Manual mode</Btn>
              <Btn variant={mode === 'api' ? 'primary' : 'default'} onClick={() => switchMode('api')} loading={modeBusy}>API mode</Btn>
            </div>
            <div className="hint-box">
              Switching modes never deletes data, books old shipments or resends old messages. In API mode, any provider that is not configured is labelled <strong>NOT CONNECTED</strong> and refuses to pretend an action succeeded.
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Workspace</h3></div>
          <div className="card-body grid grid-2" style={{ gap: 12 }}>
            <div><div className="tag">Orders</div><div className="big-money">{data.meta.orderCount}</div></div>
            <div><div className="tag">Messages</div><div className="big-money">{data.meta.messageCount}</div></div>
            <div><div className="tag">Shipments</div><div className="big-money">{data.meta.shipmentCount}</div></div>
            <div><div className="tag">API logs</div><div className="big-money">{data.apiLogs.length}</div></div>
          </div>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'business', label: 'Business' },
          { key: 'commercial', label: 'Currency, tax & costing' },
          { key: 'quality', label: 'QC & workflow' },
          { key: 'templates', label: 'Campaign templates', count: 5 },
          { key: 'messaging', label: 'Message templates' },
          { key: 'integrations', label: 'Integrations & API' },
          { key: 'users', label: 'Users', count: data.users.length },
          { key: 'activity', label: 'Activity & logs' },
        ]}
      />

      {tab === 'business' ? <BusinessTab settings={data.settings} onSaved={reload} /> : null}
      {tab === 'commercial' ? <CommercialTab settings={data.settings} onSaved={reload} /> : null}
      {tab === 'quality' ? <QualityTab settings={data.settings} onSaved={reload} /> : null}
      {tab === 'templates' ? <TemplatesTab onEdit={setTemplateEditing} /> : null}
      {tab === 'messaging' ? <MessagingTab /> : null}
      {tab === 'integrations' ? <IntegrationsTab data={data} onChanged={reload} onMode={switchMode} /> : null}
      {tab === 'users' ? (
        <UsersTab
          users={data.users}
          onAdd={() => setAddingUser(true)}
          onReset={(user) => setResetting(user)}
          onChanged={reload}
          onChangePassword={() => setPasswordOpen(true)}
        />
      ) : null}
      {tab === 'activity' ? <ActivityTab audit={data.audit} apiLogs={data.apiLogs} /> : null}

      {addingUser ? <AddUserModal onClose={() => setAddingUser(false)} onDone={() => { setAddingUser(false); reload(); }} /> : null}
      {resetting ? <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onDone={() => setResetting(null)} /> : null}
      {passwordOpen ? <ChangeOwnPasswordModal onClose={() => setPasswordOpen(false)} /> : null}
      {templateEditing ? <TemplateModal template={templateEditing} onClose={() => setTemplateEditing(null)} onDone={() => { setTemplateEditing(null); }} /> : null}
    </>
  );
}

/* ------------------------------- Business ------------------------------- */

function BusinessTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const { push } = useToast();
  const { reload: reloadMeta } = useMeta();
  const [form, setForm] = useState<any>({ ...settings.business });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await patch('/settings', { key: 'business', value: form });
      push('Business profile saved', 'good');
      onSaved();
      reloadMeta();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><h3>Business profile</h3><div className="actions"><Btn variant="primary" size="sm" onClick={save} loading={busy}>Save profile</Btn></div></div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Business name"><Input value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Tagline"><Input value={form.tagline ?? ''} onChange={(e) => setForm({ ...form, tagline: e.target.value })} /></Field>
            <Field label="Email"><Input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Website"><Input value={form.website ?? ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></Field>
            <Field label="GSTIN"><Input value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></Field>
            <Field label="Address" span2><Textarea value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          <div className="hint-box" style={{ marginTop: 12 }}>
            The brand mark is intentionally text-based. Replace it with a logo asset whenever one exists — no final brand asset was invented.
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Notifications</h3></div>
        <div className="card-body">
          <NotificationsForm settings={settings} onSaved={onSaved} />
        </div>
      </div>
    </div>
  );
}

function NotificationsForm({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>({ ...settings.notifications });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await patch('/settings', { key: 'notifications', value: form });
      push('Notification settings saved', 'good');
      onSaved();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <Field label="Feedback reminder delay (days)" hint="How long after delivery the feedback request should be prepared.">
        <Input type="number" min={0} value={form.feedbackDelayDays} onChange={(e) => setForm({ ...form, feedbackDelayDays: Number(e.target.value) })} />
      </Field>
      <label className="check"><input type="checkbox" checked={!!form.lowStockAlerts} onChange={(e) => setForm({ ...form, lowStockAlerts: e.target.checked })} /> Show low-stock alerts on the dashboard</label>
      <div><Btn variant="primary" onClick={save} loading={busy}>Save notifications</Btn></div>
      <div className="hint-box">WhatsApp content lives in Settings → Message templates. Sending behaviour depends on the operating mode.</div>
    </div>
  );
}

/* ------------------------------ Commercial ------------------------------ */

function CommercialTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const { push } = useToast();
  const [currency, setCurrency] = useState<any>({ ...settings.currency });
  const [numbering, setNumbering] = useState<any>({ ...settings.numbering });
  const [tax, setTax] = useState<any>({ ...settings.tax, rates: [...(settings.tax.rates ?? [])] });
  const [costing, setCosting] = useState<any>({ ...settings.costing });
  const [procurement, setProcurement] = useState<any>({ ...settings.procurement });
  const [busy, setBusy] = useState<string | null>(null);

  async function save(key: string, value: any) {
    setBusy(key);
    try {
      await patch('/settings', { key, value });
      push(`${key} settings saved`, 'good');
      onSaved();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <div className="split">
        <div className="card">
          <div className="card-head"><h3>Currency & numbering</h3><div className="actions"><Btn size="sm" variant="primary" onClick={() => save('numbering', numbering)} loading={busy === 'numbering'}>Save numbering</Btn></div></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Currency code"><Input value={currency.code ?? ''} onChange={(e) => setCurrency({ ...currency, code: e.target.value })} /></Field>
              <Field label="Symbol"><Input value={currency.symbol ?? ''} onChange={(e) => setCurrency({ ...currency, symbol: e.target.value })} /></Field>
              <Field label="Order prefix"><Input value={numbering.orderPrefix ?? ''} onChange={(e) => setNumbering({ ...numbering, orderPrefix: e.target.value })} /></Field>
              <Field label="Quotation prefix"><Input value={numbering.quotationPrefix ?? ''} onChange={(e) => setNumbering({ ...numbering, quotationPrefix: e.target.value })} /></Field>
              <Field label="Purchase prefix"><Input value={numbering.purchasePrefix ?? ''} onChange={(e) => setNumbering({ ...numbering, purchasePrefix: e.target.value })} /></Field>
              <Field label="Sequence padding"><Input type="number" min={2} max={8} value={numbering.padding} onChange={(e) => setNumbering({ ...numbering, padding: Number(e.target.value) })} /></Field>
            </div>
            <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={numbering.includeYear !== false} onChange={(e) => setNumbering({ ...numbering, includeYear: e.target.checked })} /> Include year in references (CP-2026-0001)</label>
            <div className="hint-box" style={{ marginTop: 10 }}>Next order reference preview: <span className="code">{numbering.orderPrefix || 'CP'}-{numbering.includeYear === false ? '' : `${new Date().getFullYear()}-`}{String(1).padStart(Number(numbering.padding) || 4, '0')}</span></div>
            <div className="row" style={{ marginTop: 10 }}>
              <Btn size="sm" onClick={() => save('currency', currency)} loading={busy === 'currency'}>Save currency</Btn>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Tax configuration</h3><div className="actions"><Btn size="sm" variant="primary" onClick={() => save('tax', tax)} loading={busy === 'tax'}>Save tax</Btn></div></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Tax label"><Input value={tax.label ?? ''} onChange={(e) => setTax({ ...tax, label: e.target.value })} /></Field>
              <Field label="Default rate (%)"><Input type="number" step="0.01" value={tax.defaultRatePct} onChange={(e) => setTax({ ...tax, defaultRatePct: Number(e.target.value) })} /></Field>
            </div>
            <label className="check" style={{ marginTop: 10 }}><input type="checkbox" checked={!!tax.inclusive} onChange={(e) => setTax({ ...tax, inclusive: e.target.checked })} /> Prices are tax-inclusive</label>
            <div className="divider" />
            <div className="tag">Rate presets</div>
            <div className="stack-sm" style={{ marginTop: 8 }}>
              {(tax.rates ?? []).map((rate: any, index: number) => (
                <div key={index} className="row">
                  <Input value={rate.name} onChange={(e) => setTax({ ...tax, rates: tax.rates.map((r: any, i: number) => (i === index ? { ...r, name: e.target.value } : r)) })} />
                  <Input type="number" step="0.01" style={{ width: 90 }} value={rate.ratePct} onChange={(e) => setTax({ ...tax, rates: tax.rates.map((r: any, i: number) => (i === index ? { ...r, ratePct: Number(e.target.value) } : r)) })} />
                  <Btn size="sm" variant="ghost" onClick={() => setTax({ ...tax, rates: tax.rates.filter((_: any, i: number) => i !== index) })}>✕</Btn>
                </div>
              ))}
            </div>
            <Btn size="sm" style={{ marginTop: 8 }} onClick={() => setTax({ ...tax, rates: [...(tax.rates ?? []), { name: 'New rate', ratePct: 0 }] })}>+ Add rate</Btn>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="card">
          <div className="card-head"><h3>Costing defaults</h3><div className="actions"><Btn size="sm" variant="primary" onClick={() => save('costing', costing)} loading={busy === 'costing'}>Save costing</Btn></div></div>
          <div className="card-body">
            <div className="form-grid">
              <Field label="Assembly labour per package"><MoneyInput value={costing.assemblyLabourPerPackagePaise} onChange={(v) => setCosting({ ...costing, assemblyLabourPerPackagePaise: v })} /></Field>
              <Field label="QC labour per package"><MoneyInput value={costing.qcLabourPerPackagePaise} onChange={(v) => setCosting({ ...costing, qcLabourPerPackagePaise: v })} /></Field>
              <Field label="Payment fee (%)"><Input type="number" step="0.01" value={costing.paymentFeePct} onChange={(e) => setCosting({ ...costing, paymentFeePct: Number(e.target.value) })} /></Field>
              <Field label="Default shipping per package"><MoneyInput value={costing.defaultShippingPerPackagePaise} onChange={(v) => setCosting({ ...costing, defaultShippingPerPackagePaise: v })} /></Field>
              <Field label="Packaging buffer (%)"><Input type="number" step="0.01" value={costing.packagingBufferPct} onChange={(e) => setCosting({ ...costing, packagingBufferPct: Number(e.target.value) })} /></Field>
            </div>
            <div className="hint-box" style={{ marginTop: 12 }}>Estimated shipping is used when no shipping cost line exists. Actual shipping always comes from shipment records.</div>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Procurement rule</h3><div className="actions"><Btn size="sm" variant="primary" onClick={() => save('procurement', procurement)} loading={busy === 'procurement'}>Save rule</Btn></div></div>
          <div className="card-body stack">
            <Field label="Advance required before campaign purchases (%)" hint="Raising a campaign PO below this threshold requires a written override reason.">
              <Input type="number" min={0} max={100} value={procurement.advanceRequirementPct} onChange={(e) => setProcurement({ ...procurement, advanceRequirementPct: Number(e.target.value) })} />
            </Field>
            <div className="hint-box">Every override is recorded on the purchase order and in the audit log with your user and reason.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Quality ------------------------------- */

function QualityTab({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [items, setItems] = useState<string[]>([...(settings.qcChecklist ?? [])]);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await patch('/settings', { key: 'qcChecklist', value: items.filter((i) => i.trim()) });
      push('QC checklist saved', 'good');
      onSaved();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><h3>Default QC checklist</h3><div className="actions"><Btn size="sm" variant="primary" onClick={save} loading={busy}>Save checklist</Btn></div></div>
        <div className="card-body stack">
          <p className="small muted">Applied to every new package inspection unless a campaign template defines its own checklist. All items must be ticked before QC can pass.</p>
          {items.map((item, index) => (
            <div key={index} className="row">
              <span className="mono xsmall muted" style={{ width: 20 }}>{index + 1}</span>
              <Input value={item} onChange={(e) => setItems(items.map((value, i) => (i === index ? e.target.value : value)))} />
              <Btn size="sm" variant="ghost" onClick={() => setItems(items.filter((_, i) => i !== index))}>✕</Btn>
            </div>
          ))}
          <div><Btn size="sm" onClick={() => setItems([...items, 'New check'])}>+ Add check</Btn></div>
          <div className="hint-box">QC is enforced server-side: a package with no passed inspection cannot be booked or dispatched, and a failed inspection sends it back to rework.</div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Order workflow</h3></div>
        <div className="card-body stack">
          <p className="small muted">Transitions are enforced so a package cannot skip assembly or QC. This reference shows the permitted paths.</p>
          {(meta?.enums.orderStatuses ?? []).map((status) => {
            const next = meta?.enums.orderTransitions[status.value] ?? [];
            return (
              <div key={status.value} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className={`badge badge-${status.tone}`}>{status.label}</span>
                  <span className="xsmall muted">→</span>
                </div>
                <div className="xsmall muted" style={{ marginTop: 3 }}>
                  {next.length ? next.map((value) => meta?.enums.orderStatuses.find((s) => s.value === value)?.label ?? value).join(' · ') : 'Final state'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Templates ------------------------------ */

function TemplatesTab({ onEdit }: { onEdit: (template: any) => void }) {
  const { data, loading, reload } = useApi<any>('/templates');
  if (loading && !data) return <Loading />;
  const templates = data?.templates ?? [];
  return (
    <div className="card">
      <div className="card-head"><h3>Campaign templates</h3><span className="badge badge-outline">{templates.length}</span></div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Template</th><th>Type</th><th>Purpose</th><th className="num">Components</th><th className="num">Est. cost / package</th><th></th></tr></thead>
          <tbody>
            {templates.map((template: any) => {
              const components = Array.isArray(template.suggested_components) ? template.suggested_components : [];
              const packaging = Array.isArray(template.suggested_packaging) ? template.suggested_packaging : [];
              return (
                <tr key={template.id}>
                  <td className="strong">{template.name}</td>
                  <td className="small">{template.campaign_type.replace(/_/g, ' ')}</td>
                  <td className="small" style={{ maxWidth: 360 }}>{template.purpose}</td>
                  <td className="num">{components.length + packaging.length}</td>
                  <td className="num">{inr(template.estimated_cost_paise)}</td>
                  <td className="actions-cell"><Btn size="sm" onClick={() => onEdit(template)}>Edit</Btn></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="hint-box">
          Templates are illustrative BOMs, not supplier prices. Prices come from your catalogue and city offers when a BOM is generated. Editing a template never changes an existing order.
        </div>
      </div>
    </div>
  );
}

export function TemplateModal({ template, onClose, onDone }: { template: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>({
    name: template.name,
    purpose: template.purpose ?? '',
    description: template.description ?? '',
    assembly_instructions: template.assembly_instructions ?? '',
    estimated_cost_paise: template.estimated_cost_paise ?? 0,
    componentsText: (template.suggested_components ?? []).map((c: any) => `${c.qty} | ${c.name} | ${c.sku ?? ''} | ${c.category ?? 'product'} | ${c.customisation ?? ''}`).join('\n'),
    packagingText: (template.suggested_packaging ?? []).map((c: any) => `${c.qty} | ${c.name} | ${c.sku ?? ''} | ${c.category ?? 'packaging'} | ${c.customisation ?? ''}`).join('\n'),
    checklistText: (template.qc_checklist ?? []).join('\n'),
    fieldsText: (template.personalisation_fields ?? []).join('\n'),
  });
  const [busy, setBusy] = useState(false);

  function parseLines(text: string) {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [qty, name, sku, category, customisation] = line.split('|').map((part) => part?.trim());
        return { qty: Number(qty) || 1, name, sku: sku || undefined, category: category || 'product', customisation: customisation || undefined };
      })
      .filter((item) => item.name);
  }

  async function save() {
    setBusy(true);
    try {
      await patch(`/templates/${template.id}`, {
        name: form.name,
        purpose: form.purpose,
        description: form.description,
        assembly_instructions: form.assembly_instructions,
        estimated_cost_paise: Number(form.estimated_cost_paise),
        suggested_components: parseLines(form.componentsText),
        suggested_packaging: parseLines(form.packagingText),
        qc_checklist: form.checklistText.split('\n').map((s: string) => s.trim()).filter(Boolean),
        personalisation_fields: form.fieldsText.split('\n').map((s: string) => s.trim()).filter(Boolean),
      });
      push('Template saved', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${template.name}`}
      subtitle="Component lines: qty | name | SKU | category | customisation"
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} loading={busy}>Save template</Btn></>}
    >
      <div className="stack">
        <div className="form-grid">
          <Field label="Template name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Estimated cost per package"><MoneyInput value={form.estimated_cost_paise} onChange={(v) => setForm({ ...form, estimated_cost_paise: v })} /></Field>
          <Field label="Purpose" span2><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
          <Field label="Description" span2><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Suggested components" span2 hint="One per line: qty | name | SKU | category | customisation">
            <Textarea style={{ minHeight: 120, fontFamily: 'var(--mono)', fontSize: 11.5 }} value={form.componentsText} onChange={(e) => setForm({ ...form, componentsText: e.target.value })} />
          </Field>
          <Field label="Suggested packaging" span2 hint="Same format. Category usually 'packaging'.">
            <Textarea style={{ minHeight: 100, fontFamily: 'var(--mono)', fontSize: 11.5 }} value={form.packagingText} onChange={(e) => setForm({ ...form, packagingText: e.target.value })} />
          </Field>
          <Field label="Assembly instructions" span2><Textarea style={{ minHeight: 180 }} value={form.assembly_instructions} onChange={(e) => setForm({ ...form, assembly_instructions: e.target.value })} /></Field>
          <Field label="QC checklist" hint="One item per line">
            <Textarea style={{ minHeight: 140 }} value={form.checklistText} onChange={(e) => setForm({ ...form, checklistText: e.target.value })} />
          </Field>
          <Field label="Personalisation fields" hint="One per line">
            <Textarea style={{ minHeight: 140 }} value={form.fieldsText} onChange={(e) => setForm({ ...form, fieldsText: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------- Messaging ------------------------------ */

function MessagingTab() {
  const { data, loading, reload } = useApi<any>('/messages/templates');
  const { push } = useToast();
  const [editing, setEditing] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  const templates = data?.templates ?? [];

  async function save() {
    setBusy(true);
    try {
      await patch(`/messages/templates/${editing.id}`, { name: editing.name, body: editing.body });
      push('Message template saved', 'good');
      setEditing(null);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <div className="card">
        <div className="card-head"><h3>WhatsApp templates</h3><span className="badge badge-outline">{templates.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Template</th><th>Key</th><th></th></tr></thead>
            <tbody>
              {templates.map((template: any) => (
                <tr key={template.id}>
                  <td><div className="strong">{template.name}</div><div className="xsmall muted">{template.category}</div></td>
                  <td className="mono small">{template.key}</td>
                  <td className="actions-cell"><Btn size="sm" onClick={() => setEditing({ ...template })}>Edit</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Message body</h3></div>
        <div className="card-body">
          {editing ? (
            <div className="stack">
              <Field label="Template name"><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Body"><Textarea style={{ minHeight: 280 }} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></Field>
              <div className="row"><Btn variant="primary" onClick={save} loading={busy}>Save template</Btn><Btn onClick={() => setEditing(null)}>Cancel</Btn></div>
            </div>
          ) : (
            <div className="stack">
              <p className="small muted">Select a template to edit its copy. Placeholders are filled when a message is prepared.</p>
              <div className="hint-box">{'{{customer_name}} {{contact_person}} {{recipient_name}} {{order_ref}} {{campaign_name}} {{courier}} {{awb}} {{tracking_url}} {{dispatch_date}} {{delivery_address}} {{order_value}} {{advance_due}}'}</div>
              <div className="small muted">Prepared messages are never treated as sent. Manual sends are recorded with your name; API sends store the provider reference.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Integrations ----------------------------- */

function IntegrationsTab({ data, onChanged, onMode }: { data: any; onChanged: () => void; onMode: (mode: 'manual' | 'api') => void }) {
  const { push } = useToast();
  return (
    <div className="stack">
      <div className="card">
        <div className="card-body row">
          <div style={{ flex: 1 }}>
            <strong>Providers are configured here, never hardcoded.</strong>
            <div className="small muted" style={{ marginTop: 3 }}>
              Every adapter shows its connection state honestly. A provider without credentials stays NOT CONNECTED and no action is claimed as successful.
            </div>
          </div>
          <Badge tone={data.operatingMode === 'api' ? 'info' : 'good'}>{data.operatingMode === 'api' ? 'API mode active' : 'Manual mode active'}</Badge>
          <Btn size="sm" onClick={() => onMode(data.operatingMode === 'api' ? 'manual' : 'api')}>{data.operatingMode === 'api' ? 'Switch to manual' : 'Switch to API mode'}</Btn>
        </div>
      </div>

      <div className="grid grid-2">
        {data.providers.map((provider: any) => (
          <ProviderCard key={provider.id} provider={provider} onChanged={onChanged} />
        ))}
      </div>

      <div className="card">
        <div className="card-head"><h3>API request log</h3><span className="badge badge-outline">{data.apiLogs.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Provider</th><th>Action</th><th>Env</th><th>Status</th><th>HTTP</th><th>Error / note</th></tr></thead>
            <tbody>
              {data.apiLogs.map((log: any) => (
                <tr key={log.id}>
                  <td className="small muted nowrap-text">{dateTime(log.created_at)}</td>
                  <td className="small">{log.provider_name ?? '—'}</td>
                  <td className="small mono">{log.action}</td>
                  <td className="small">{log.environment ?? '—'}</td>
                  <td><Badge tone={log.status === 'failed' ? 'bad' : log.status === 'test_success' ? 'warn' : 'good'}>{log.status}</Badge></td>
                  <td className="small">{log.http_status ?? '—'}</td>
                  <td className="small" style={{ maxWidth: 320 }}>{log.error ?? '—'}</td>
                </tr>
              ))}
              {!data.apiLogs.length ? <tr><td colSpan={7}><EmptyState title="No API calls yet" message="Test a provider or run an API action to see request metadata here." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ provider, onChanged }: { provider: any; onChanged: () => void }) {
  const { push } = useToast();
  const [config, setConfig] = useState<any>({ ...provider.config });
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [environment, setEnvironment] = useState(provider.environment);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(provider.lastCheckMessage ? { ok: provider.status === 'connected', message: provider.lastCheckMessage } : null);

  async function saveConfig() {
    setBusy('config');
    try {
      await patch(`/settings/providers/${provider.id}`, { config, environment });
      push('Provider configuration saved', 'good');
      onChanged();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function saveSecrets() {
    const payload = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value));
    if (!Object.keys(payload).length) {
      push('Enter at least one credential', 'warn');
      return;
    }
    setBusy('secrets');
    try {
      await post(`/settings/providers/${provider.id}/secrets`, { secrets: payload });
      push('Credentials stored encrypted — they never return to the browser', 'good');
      setSecrets({});
      onChanged();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    try {
      const result = await post(`/settings/providers/${provider.id}/test`);
      setCheck({ ok: result.ok, message: result.ok ? `Connected — ${result.message}` : result.message });
      push(result.ok ? 'Provider responded' : result.message, result.ok ? 'good' : 'warn');
      onChanged();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3 style={{ fontSize: 16 }}>{provider.name}</h3>
          <div className="xsmall muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{provider.kind} provider</div>
        </div>
        <div className="actions">
          <Badge tone={provider.configured ? (provider.environment === 'live' ? 'good' : 'warn') : 'bad'}>
            {provider.configured ? (provider.environment === 'live' ? 'LIVE' : 'TEST') : 'NOT CONNECTED'}
          </Badge>
        </div>
      </div>
      <div className="card-body stack">
        {provider.description ? <p className="small muted">{provider.description}</p> : null}
        {!provider.configured ? (
          <div className="alert alert-warn">
            This provider is not connected. Missing: {provider.missing?.join(', ') || 'configuration'}. No real bookings or messages can be sent until it is configured.
          </div>
        ) : null}
        {provider.note ? <div className="hint-box">{provider.note}</div> : null}

        <div className="form-grid">
          {provider.fields.map((field: any) => (
            <Field key={field.key} label={`${field.label}${field.required ? ' *' : ''}`} hint={field.help}>
              {field.secret ? (
                <Input
                  type="password"
                  placeholder={provider.secretsSet?.[field.key] ? 'Stored — enter a new value to replace' : field.placeholder ?? 'Not set'}
                  value={secrets[field.key] ?? ''}
                  onChange={(e) => setSecrets({ ...secrets, [field.key]: e.target.value })}
                  autoComplete="new-password"
                />
              ) : (
                <Input
                  value={config[field.key] ?? ''}
                  placeholder={field.placeholder ?? ''}
                  onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>

        <div className="row">
          <Select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            options={[{ value: 'test', label: 'Test environment' }, { value: 'live', label: 'Live environment' }]}
            style={{ width: 190 }}
          />
          <Btn onClick={saveConfig} loading={busy === 'config'}>Save configuration</Btn>
          <Btn onClick={saveSecrets} loading={busy === 'secrets'}>Save credentials</Btn>
          <Btn variant="primary" onClick={test} loading={busy === 'test'}>Test connection</Btn>
        </div>

        {check ? <div className={`alert ${check.ok ? 'alert-good' : 'alert-bad'}`}>{check.message}</div> : null}
        {provider.docsUrl ? <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="small muted" style={{ textDecoration: 'underline' }}>Provider documentation ↗</a> : null}
        <div className="xsmall muted">Last checked: {provider.lastCheckAt ? dateTime(provider.lastCheckAt) : 'never'}</div>
      </div>
    </div>
  );
}

/* --------------------------------- Users -------------------------------- */

function UsersTab({ users, onAdd, onReset, onChanged, onChangePassword }: { users: any[]; onAdd: () => void; onReset: (user: any) => void; onChanged: () => void; onChangePassword: () => void }) {
  const { push } = useToast();
  async function update(user: any, body: any) {
    try {
      await patch(`/settings/users/${user.id}`, body);
      push('User updated', 'good');
      onChanged();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }
  return (
    <div className="card">
      <div className="card-head">
        <h3>Users & access</h3>
        <div className="actions"><Btn size="sm" onClick={onChangePassword}>Change my password</Btn><Btn size="sm" variant="primary" onClick={onAdd}>+ Add user</Btn></div>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {users.map((user: any) => (
              <tr key={user.id}>
                <td className="strong">{user.name}</td>
                <td className="small">{user.email}</td>
                <td>
                  <Select value={user.role} onChange={(e) => update(user, { role: e.target.value })} options={[{ value: 'admin', label: 'Admin' }, { value: 'ops', label: 'Operations' }, { value: 'viewer', label: 'Read-only' }]} style={{ width: 140 }} />
                </td>
                <td><Badge tone={user.active ? 'good' : 'neutral'}>{user.active ? 'Active' : 'Disabled'}</Badge></td>
                <td className="small muted">{user.last_login_at ? dateTime(user.last_login_at) : 'Never'}</td>
                <td className="actions-cell">
                  <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    <Btn size="sm" variant="ghost" onClick={() => onReset(user)}>Reset password</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => update(user, { active: !user.active })}>{user.active ? 'Disable' : 'Enable'}</Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="hint-box">Roles: <strong>Admin</strong> full access including settings and credentials; <strong>Operations</strong> can run orders, procurement, production and dispatch; <strong>Read-only</strong> can view everything but change nothing. Permissions are enforced on the server.</div>
      </div>
    </div>
  );
}

function AddUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'ops' });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await post('/settings/users', form);
      push('User created', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Add user" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name || !form.email || form.password.length < 8}>Create user</Btn></>}>
      <div className="form-grid">
        <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters. Share it privately."><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={[{ value: 'ops', label: 'Operations' }, { value: 'admin', label: 'Admin' }, { value: 'viewer', label: 'Read-only' }]} /></Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: any; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await post(`/settings/users/${user.id}/password`, { password });
      push('Password reset — all sessions for that user were signed out', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Reset password — ${user.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={password.length < 8}>Reset password</Btn></>}>
      <Field label="New password" hint="At least 8 characters."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
    </Modal>
  );
}

function ChangeOwnPasswordModal({ onClose }: { onClose: () => void }) {
  const { push } = useToast();
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: current, newPassword: next });
      push('Password changed', 'good');
      await logout();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Change my password" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={next.length < 8}>Change password</Btn></>}>
      <div className="stack">
        <Field label="Current password"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
        <Field label="New password"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <div className="hint-box">You will be signed out after changing your password.</div>
      </div>
    </Modal>
  );
}

/* -------------------------------- Activity ------------------------------- */

function ActivityTab({ audit, apiLogs }: { audit: any[]; apiLogs: any[] }) {
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState(false);
  const filtered = useMemo(
    () =>
      audit.filter((entry) => {
        if (overrides && !entry.manual_override) return false;
        if (search && !`${entry.action} ${entry.entity_label ?? ''} ${entry.user_name ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [audit, search, overrides],
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h3>Audit trail</h3><span className="badge badge-outline">{filtered.length} entries</span></div>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={search} onChange={setSearch} placeholder="Search action, record or user…" /></div>
          <label className="check"><input type="checkbox" checked={overrides} onChange={(e) => setOverrides(e.target.checked)} /> Manual overrides only</label>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td className="small muted nowrap-text">{dateTime(entry.created_at)}</td>
                  <td className="small">{entry.user_name ?? 'System'}</td>
                  <td className="small">{entry.action.replace(/[._]/g, ' ')}{entry.manual_override ? <Badge tone="warn">override</Badge> : null}</td>
                  <td className="small">{entry.entity_type ?? '—'} {entry.entity_label ? `· ${entry.entity_label}` : ''}</td>
                  <td className="small muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.meta ?? ''}>{entry.meta ?? '—'}</td>
                </tr>
              ))}
              {!filtered.length ? <tr><td colSpan={5}><EmptyState title="No matching activity" /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>API calls</h3><span className="badge badge-outline">{apiLogs.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Provider</th><th>Action</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {apiLogs.map((log) => (
                <tr key={log.id}>
                  <td className="small muted">{dateTime(log.created_at)}</td>
                  <td className="small">{log.provider_name ?? '—'}</td>
                  <td className="small mono">{log.action}</td>
                  <td><Badge tone={log.status === 'failed' ? 'bad' : log.status === 'test_success' ? 'warn' : 'good'}>{log.status}</Badge></td>
                  <td className="small muted">{log.error ?? '—'}</td>
                </tr>
              ))}
              {!apiLogs.length ? <tr><td colSpan={5}><EmptyState title="No API activity" /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
