import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patch, post, useApi } from '../lib/api';
import { dateLabel, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Loading, Modal, PageHead, SearchInput, Select, Textarea, useToast } from '../components/ui';

export function Customers() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (status) query.set('status', status);
  const { data, loading, error, reload } = useApi<any>(`/customers?${query.toString()}`, [search, status]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  const customers = data?.customers ?? [];

  return (
    <>
      <PageHead title="Customers" subtitle="Companies and people who commission campaigns, with their spend and history." actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New customer</Btn>} />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={search} onChange={setSearch} placeholder="Search company, contact, email or phone…" /></div>
          <Select placeholder="All statuses" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'prospect', label: 'Prospect' }]} style={{ width: 150 }} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Company</th><th>Contact</th><th>Type</th><th className="num">Orders</th><th className="num">Total spend</th><th>Last order</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {customers.map((customer: any) => (
                <tr key={customer.id} className="clickable" onClick={() => navigate(`/customers/${customer.id}`)}>
                  <td className="strong">{customer.company_name}{customer.demo ? <span className="badge badge-outline" style={{ marginLeft: 6 }}>demo</span> : null}</td>
                  <td className="small">{customer.contact_person ?? '—'}<div className="xsmall muted">{customer.email ?? customer.phone ?? ''}</div></td>
                  <td className="small" style={{ textTransform: 'capitalize' }}>{customer.customer_type}</td>
                  <td className="num">{customer.order_count}</td>
                  <td className="num">{inr(customer.total_spend_paise)}</td>
                  <td className="small muted">{customer.last_order_date ? dateLabel(customer.last_order_date) : '—'}</td>
                  <td><Badge tone={customer.status === 'active' ? 'good' : customer.status === 'prospect' ? 'warn' : 'neutral'}>{customer.status}</Badge></td>
                  <td className="actions-cell">
                    <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(customer); }}>Edit</Btn>
                  </td>
                </tr>
              ))}
              {!customers.length ? <tr><td colSpan={8}><EmptyState title="No customers yet" message="Add the first company you are producing for." action={<Btn onClick={() => setCreating(true)}>New customer</Btn>} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {creating || editing ? (
        <CustomerModal customer={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={(customer) => { setCreating(false); setEditing(null); reload(); if (customer) navigate(`/customers/${customer.id}`); }} />
      ) : null}
    </>
  );
}

export function CustomerModal({ customer, onClose, onDone }: { customer?: any; onClose: () => void; onDone: (customer?: any) => void }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>(
    customer ?? { company_name: '', contact_person: '', email: '', phone: '', billing_address: '', gstin: '', customer_type: 'corporate', notes: '', status: 'active' },
  );
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = customer ? await patch(`/customers/${customer.id}`, form) : await post('/customers', form);
      push(customer ? 'Customer updated' : 'Customer created', 'good');
      onDone(result.customer);
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={customer ? customer.company_name : 'New customer'}
      onClose={onClose}
      wide
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.company_name}>Save customer</Btn></>}
    >
      <div className="form-grid">
        <Field label="Company name"><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
        <Field label="Contact person"><Input value={form.contact_person ?? ''} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Billing address" span2><Textarea value={form.billing_address ?? ''} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></Field>
        <Field label="GSTIN (optional)"><Input value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value })} /></Field>
        <Field label="Customer type">
          <Select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })} options={[{ value: 'corporate', label: 'Corporate' }, { value: 'startup', label: 'Startup' }, { value: 'agency', label: 'Agency' }, { value: 'individual', label: 'Individual' }, { value: 'other', label: 'Other' }]} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={[{ value: 'active', label: 'Active' }, { value: 'prospect', label: 'Prospect' }, { value: 'inactive', label: 'Inactive' }]} />
        </Field>
        <Field label="Notes"><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
