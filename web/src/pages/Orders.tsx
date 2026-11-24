import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, paiseToRupees } from '../lib/format';
import { Btn, EmptyState, Field, Input, Loading, Modal, Money, MoneyInput, PageHead, SearchInput, Select, Textarea, useToast } from '../components/ui';
import { today } from '../lib/format';

export function Orders() {
  const { meta, reload: reloadMeta } = useMeta();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [campaign, setCampaign] = useState('');
  const [city, setCity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);

  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (campaign) q.set('campaign_type', campaign);
    if (city) q.set('city_id', city);
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return q.toString();
  }, [search, status, campaign, city, from, to]);

  const { data, loading, error, reload } = useApi<any>(`/orders${query ? `?${query}` : ''}`, [query]);
  const customers = useApi<any>('/customers');
  const cities = useApi<any>('/locations/cities');
  const templates = useApi<any>('/templates');

  return (
    <>
      <PageHead
        title="Orders"
        subtitle="Campaigns with their recipients, packages, procurement and fulfilment."
        actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New order</Btn>}
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ minWidth: 220, flex: 1 }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search ref, campaign or customer…" />
          </div>
          <Select
            style={{ width: 178 }}
            placeholder="All statuses"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={(meta?.enums.orderStatuses ?? []).map((s) => ({ value: s.value, label: s.label }))}
          />
          <Select
            style={{ width: 170 }}
            placeholder="All campaign types"
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            options={(meta?.enums.campaignTypes ?? []).map((c) => ({ value: c.value, label: c.label }))}
          />
          <Select
            style={{ width: 140 }}
            placeholder="All cities"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            options={(cities.data?.cities ?? []).map((c: any) => ({ value: c.id, label: c.name }))}
          />
          <input className="input" type="date" style={{ width: 145 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
          <input className="input" type="date" style={{ width: 145 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          {(search || status || campaign || city || from || to) ? (
            <Btn size="sm" variant="ghost" onClick={() => { setSearch(''); setStatus(''); setCampaign(''); setCity(''); setFrom(''); setTo(''); }}>Clear</Btn>
          ) : null}
        </div>
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? <div className="alert alert-bad" style={{ margin: 16 }}>{error}</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="num">Packages</th>
                  <th className="num">Value</th>
                  <th className="num">Est. margin</th>
                  <th>Dispatch</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {(data?.orders ?? []).map((order: any) => {
                  const margin = order.total_value_paise ? ((order.total_value_paise - order.estimated_cost_paise) / order.total_value_paise) * 100 : 0;
                  const metaEntry = meta?.enums.orderStatuses.find((s) => s.value === order.status);
                  return (
                    <tr key={order.id} className="clickable" onClick={() => navigate(`/orders/${order.id}`)}>
                      <td className="mono strong">{order.ref}</td>
                      <td>{order.company_name}</td>
                      <td>
                        <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.campaign_name}</div>
                        <div className="xsmall muted">{meta?.enums.campaignTypeLabel[order.campaign_type] ?? order.campaign_type}</div>
                      </td>
                      <td><span className={`badge badge-${metaEntry?.tone ?? 'neutral'}`}>{metaEntry?.label ?? order.status}</span></td>
                      <td className="num">{order.package_count}</td>
                      <td className="num"><Money paise={order.total_value_paise} /></td>
                      <td className={`num ${margin < 0 ? 'money neg' : margin < 10 ? 'money' : 'money pos'}`}>{order.total_value_paise ? `${margin.toFixed(0)}%` : '—'}</td>
                      <td className="small muted nowrap-text">{dateLabel(order.expected_dispatch_date)}</td>
                      <td className="small muted nowrap-text">{dateLabel(order.target_delivery_date)}</td>
                    </tr>
                  );
                })}
                {data && !data.orders.length ? (
                  <tr><td colSpan={9}><EmptyState title="No orders match these filters" message="Clear the filters or create a new campaign." action={<Btn onClick={() => setCreating(true)}>New order</Btn>} /></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating ? (
        <NewOrderModal
          customers={customers.data?.customers ?? []}
          templates={templates.data?.templates ?? []}
          cities={cities.data?.cities ?? []}
          locations={meta?.locations ?? []}
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            reload();
            reloadMeta();
            navigate(`/orders/${order.id}`);
          }}
        />
      ) : null}
    </>
  );
}

export function NewOrderModal({
  customers,
  templates,
  cities,
  locations,
  onClose,
  onCreated,
}: {
  customers: any[];
  templates: any[];
  cities: any[];
  locations: any[];
  onClose: () => void;
  onCreated: (order: any) => void;
}) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    customer_id: '',
    template_id: '',
    campaign_name: '',
    campaign_type: 'cold_outreach',
    order_date: today(),
    description: '',
    expected_dispatch_date: '',
    target_delivery_date: '',
    procurement_city_id: '',
    fulfilment_location_id: '',
    quotation_amount_paise: 0,
    advance_received_paise: 0,
    packing_requirements: '',
    special_instructions: '',
    internal_notes: '',
  });
  const set = (key: string, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  const filteredLocations = form.procurement_city_id
    ? locations.filter((l: any) => String(l.city_id) === String(form.procurement_city_id))
    : locations;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.customer_id) return push('Choose a customer', 'bad');
    setBusy(true);
    try {
      const payload: any = {
        ...form,
        customer_id: Number(form.customer_id),
        template_id: form.template_id ? Number(form.template_id) : null,
        procurement_city_id: form.procurement_city_id ? Number(form.procurement_city_id) : null,
        fulfilment_location_id: form.fulfilment_location_id ? Number(form.fulfilment_location_id) : null,
        total_value_paise: form.quotation_amount_paise,
        expected_dispatch_date: form.expected_dispatch_date || null,
        target_delivery_date: form.target_delivery_date || null,
      };
      const result = await post('/orders', payload);
      push(`Order ${result.order.ref} created as a draft`, 'good');
      onCreated(result.order);
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New order"
      subtitle="Start with the client and campaign template. Products, recipients and the BOM come next."
      wide
      onClose={onClose}
      footer={
        <>
          <span className="note">Order reference is generated automatically.</span>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={submit} loading={busy}>Create draft order</Btn>
        </>
      }
    >
      <form className="stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Customer">
            <Select
              required
              placeholder="Choose a customer"
              value={form.customer_id}
              onChange={(e) => set('customer_id', e.target.value)}
              options={customers.map((c) => ({ value: c.id, label: c.company_name }))}
            />
          </Field>
          <Field label="Campaign template" hint="Fills the campaign type and seeds the BOM later.">
            <Select
              placeholder="No template"
              value={form.template_id}
              onChange={(e) => {
                const template = templates.find((t) => String(t.id) === e.target.value);
                set('template_id', e.target.value);
                if (template) {
                  set('campaign_type', template.campaign_type);
                  if (!form.campaign_name) set('campaign_name', template.name);
                }
              }}
              options={templates.map((t) => ({ value: t.id, label: t.name }))}
            />
          </Field>
          <Field label="Campaign name" span2>
            <Input required value={form.campaign_name} onChange={(e) => set('campaign_name', e.target.value)} placeholder="Founder outreach — 20 warm prospects" />
          </Field>
          <Field label="Campaign type">
            <Select value={form.campaign_type} onChange={(e) => set('campaign_type', e.target.value)} options={(meta?.enums.campaignTypes ?? []).map((c) => ({ value: c.value, label: c.label }))} />
          </Field>
          <Field label="Order date">
            <Input type="date" required value={form.order_date} onChange={(e) => set('order_date', e.target.value)} />
          </Field>
          <Field label="Expected dispatch">
            <Input type="date" value={form.expected_dispatch_date} onChange={(e) => set('expected_dispatch_date', e.target.value)} />
          </Field>
          <Field label="Target delivery">
            <Input type="date" value={form.target_delivery_date} onChange={(e) => set('target_delivery_date', e.target.value)} />
          </Field>
          <Field label="Procurement city">
            <Select placeholder="Choose city" value={form.procurement_city_id} onChange={(e) => set('procurement_city_id', e.target.value)} options={cities.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Fulfilment location" hint="Where packages are assembled and packed.">
            <Select
              placeholder="Choose store or hub"
              value={form.fulfilment_location_id}
              onChange={(e) => set('fulfilment_location_id', e.target.value)}
              options={filteredLocations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))}
            />
          </Field>
          <Field label="Quotation / order value">
            <MoneyInput value={form.quotation_amount_paise} onChange={(v) => set('quotation_amount_paise', v)} />
          </Field>
          <Field label="Advance received">
            <MoneyInput value={form.advance_received_paise} onChange={(v) => set('advance_received_paise', v)} />
          </Field>
          <Field label="Description" span2>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What is this campaign for, and what should each recipient receive?" />
          </Field>
          <Field label="Packing requirements">
            <Textarea value={form.packing_requirements} onChange={(e) => set('packing_requirements', e.target.value)} />
          </Field>
          <Field label="Special instructions">
            <Textarea value={form.special_instructions} onChange={(e) => set('special_instructions', e.target.value)} />
          </Field>
          <Field label="Internal notes" span2>
            <Textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} />
          </Field>
        </div>
        {form.quotation_amount_paise ? (
          <div className="hint-box">
            {`Order value ₹${paiseToRupees(form.quotation_amount_paise)} with ₹${paiseToRupees(form.advance_received_paise)} advance. `}
            Procurement warnings start at 50% advance (configurable in Settings → Procurement).
          </div>
        ) : null}
        <button type="submit" style={{ display: 'none' }} />
      </form>
    </Modal>
  );
}
