import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { inr } from '../lib/format';
import { Badge, Btn, EmptyState, Field, Input, Loading, Modal, PageHead, SearchInput, Select, Textarea, useToast } from '../components/ui';

export function Suppliers() {
  const { meta } = useMeta();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [city, setCity] = useState('');
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (city) query.set('city_id', city);
  const { data, loading, error, reload } = useApi<any>(`/suppliers?${query.toString()}`, [search, city]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  const suppliers = data?.suppliers ?? [];

  return (
    <>
      <PageHead
        title="Suppliers"
        subtitle="Who supplies what, at which outlet, at what price and how reliably. Branches can sit in different cities."
        actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New supplier</Btn>}
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 220 }}><SearchInput value={search} onChange={setSearch} placeholder="Search supplier, category or contact…" /></div>
          <Select placeholder="All cities" value={city} onChange={(e) => setCity(e.target.value)} options={(meta?.cities ?? []).map((c: any) => ({ value: c.id, label: c.name }))} style={{ width: 170 }} />
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Supplier</th><th>City</th><th>Category</th><th className="num">POs</th><th className="num">Spend</th><th className="num">On time</th><th className="num">Quality</th><th className="num">Lead</th><th>Status</th></tr></thead>
            <tbody>
              {suppliers.map((supplier: any) => (
                <tr key={supplier.id} className="clickable" onClick={() => navigate(`/suppliers/${supplier.id}`)}>
                  <td>
                    <div className="strong">{supplier.name}</div>
                    <div className="xsmall muted">{supplier.contact_person ?? ''} {supplier.phone ? `· ${supplier.phone}` : ''}</div>
                  </td>
                  <td>{supplier.city_name ?? '—'}</td>
                  <td className="small">{supplier.category ?? '—'}</td>
                  <td className="num">{supplier.po_count}</td>
                  <td className="num">{inr(supplier.spend_paise)}</td>
                  <td className="num">{supplier.delivered_count ? `${Math.round((supplier.on_time_count / supplier.delivered_count) * 100)}%` : '—'}</td>
                  <td className="num">{supplier.quality_rating ? `${Number(supplier.quality_rating).toFixed(1)} ★` : '—'}</td>
                  <td className="num">{supplier.lead_time_days ?? '—'}d</td>
                  <td><Badge tone={supplier.active ? 'good' : 'neutral'}>{supplier.active ? 'Active' : 'Inactive'}</Badge></td>
                </tr>
              ))}
              {!suppliers.length ? <tr><td colSpan={9}><EmptyState title="No suppliers yet" message="Add the shops and wholesalers you actually buy from." action={<Btn onClick={() => setCreating(true)}>New supplier</Btn>} /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {creating || editing ? (
        <SupplierModal
          supplier={editing}
          cities={meta?.cities ?? []}
          suppliers={suppliers.filter((s: any) => s.id !== editing?.id)}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => { setCreating(false); setEditing(null); reload(); }}
        />
      ) : null}
    </>
  );
}

export function SupplierModal({
  supplier,
  cities,
  suppliers,
  onClose,
  onDone,
}: {
  supplier?: any;
  cities: any[];
  suppliers: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [form, setForm] = useState<any>(
    supplier ?? {
      name: '',
      category: '',
      contact_person: '',
      phone: '',
      email: '',
      city_id: '',
      address: '',
      products_supplied: '',
      moq: '',
      lead_time_days: '',
      payment_terms: '',
      quality_rating: '',
      reliability_notes: '',
      backup_supplier_id: '',
      active: true,
    },
  );
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        city_id: form.city_id ? Number(form.city_id) : null,
        moq: form.moq === '' ? null : Number(form.moq),
        lead_time_days: form.lead_time_days === '' ? null : Number(form.lead_time_days),
        quality_rating: form.quality_rating === '' ? null : Number(form.quality_rating),
        backup_supplier_id: form.backup_supplier_id ? Number(form.backup_supplier_id) : null,
      };
      if (supplier) await patch(`/suppliers/${supplier.id}`, payload);
      else await post('/suppliers', payload);
      push(supplier ? 'Supplier updated' : 'Supplier added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={supplier ? supplier.name : 'New supplier'}
      subtitle="Supplier records are yours — Cold Post ships no invented supplier data."
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name}>Save supplier</Btn></>}
    >
      <div className="form-grid">
        <Field label="Supplier name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><Input value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="Stationery, packaging, printing…" /></Field>
        <Field label="Contact person"><Input value={form.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="City">
          <Select placeholder="Choose city" value={form.city_id ?? ''} onChange={(e) => set('city_id', e.target.value)} options={cities.map((c: any) => ({ value: c.id, label: c.name }))} />
        </Field>
        <Field label="Address" span2><Input value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Products supplied" span2><Textarea value={form.products_supplied ?? ''} onChange={(e) => set('products_supplied', e.target.value)} /></Field>
        <Field label="Minimum order quantity"><Input type="number" value={form.moq ?? ''} onChange={(e) => set('moq', e.target.value)} /></Field>
        <Field label="Lead time (days)"><Input type="number" value={form.lead_time_days ?? ''} onChange={(e) => set('lead_time_days', e.target.value)} /></Field>
        <Field label="Payment terms"><Input value={form.payment_terms ?? ''} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
        <Field label="Quality rating (0–5)"><Input type="number" step="0.1" min="0" max="5" value={form.quality_rating ?? ''} onChange={(e) => set('quality_rating', e.target.value)} /></Field>
        <Field label="Backup supplier">
          <Select placeholder="None" value={form.backup_supplier_id ?? ''} onChange={(e) => set('backup_supplier_id', e.target.value)} options={suppliers.map((s: any) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Active"><label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} /> Available for sourcing</label></Field>
        <Field label="Reliability notes" span2><Textarea value={form.reliability_notes ?? ''} onChange={(e) => set('reliability_notes', e.target.value)} placeholder="Packaging condition on arrival, colour consistency, who to speak to…" /></Field>
      </div>
    </Modal>
  );
}
