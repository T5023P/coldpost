import { useState } from 'react';
import { del, patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, dateTime } from '../lib/format';
import { Badge, Btn, EmptyState, Field, FileUpload, Input, KeyValue, Loading, Modal, PageHead, PhotoGrid, SearchInput, Select, Tabs, Textarea, useToast } from '../components/ui';

export function Locations() {
  const { meta, reload: reloadMeta } = useMeta();
  const [tab, setTab] = useState<'cities' | 'stores'>('cities');
  const [cityFilter, setCityFilter] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const cities = useApi<any>('/locations/cities');
  const stores = useApi<any>('/locations');
  const [cityModal, setCityModal] = useState<any>(null);
  const [storeModal, setStoreModal] = useState<any>(null);
  const [storeDetail, setStoreDetail] = useState<number | null>(null);
  const [cityOverview, setCityOverview] = useState<number | null>(null);

  const allLocations = stores.data?.locations ?? [];
  const filteredLocations = allLocations.filter((location: any) => {
    if (cityFilter && String(location.city_id) !== cityFilter) return false;
    if (category && location.category !== category) return false;
    if (search && !`${location.name} ${location.city_name} ${location.contact_person ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <PageHead
        title="Cities & stores"
        subtitle="Add cities yourself. Each city holds unlimited stores, warehouses and printing shops, each with its own stock and prices."
        actions={
          <>
            <Btn onClick={() => setCityModal({})}>+ New city</Btn>
            <Btn variant="primary" onClick={() => setStoreModal({})}>+ New store</Btn>
          </>
        }
      />

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'cities', label: 'Cities', count: cities.data?.cities?.length }, { key: 'stores', label: 'Stores & locations', count: allLocations.length }]} />

      {tab === 'cities' ? (
        <div className="card">
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>City</th><th>State</th><th className="num">Stores</th><th className="num">Suppliers</th><th className="num">Sourcing orders</th><th className="num">Fulfilment orders</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(cities.data?.cities ?? []).map((city: any) => (
                  <tr key={city.id}>
                    <td className="strong">{city.name}{city.demo ? <span className="badge badge-outline" style={{ marginLeft: 6 }}>demo</span> : null}</td>
                    <td>{city.state ?? '—'}</td>
                    <td className="num">{city.location_count}</td>
                    <td className="num">{city.supplier_count}</td>
                    <td className="num">{city.sourcing_orders}</td>
                    <td className="num">{city.fulfilment_orders}</td>
                    <td><Badge tone={city.active ? 'good' : 'neutral'}>{city.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="actions-cell">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Btn size="sm" variant="ghost" onClick={() => setCityOverview(city.id)}>Overview</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setCityModal(city)}>Edit</Btn>
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await patch(`/locations/cities/${city.id}`, { active: !city.active });
                            cities.reload();
                            reloadMeta();
                          }}
                        >
                          {city.active ? 'Deactivate' : 'Activate'}
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
                {!cities.data?.cities?.length ? <tr><td colSpan={8}><EmptyState title="No cities yet" message="Add Lucknow, Delhi, Mumbai or any city you operate in." action={<Btn onClick={() => setCityModal({})}>Add city</Btn>} /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="card">
            <div className="card-body tight row">
              <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder="Search store or contact…" /></div>
              <Select placeholder="All cities" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} options={(cities.data?.cities ?? []).map((c: any) => ({ value: c.id, label: c.name }))} style={{ width: 160 }} />
              <Select placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} options={(meta?.enums.storeCategories ?? []).map((c: any) => ({ value: c.value, label: c.label }))} style={{ width: 190 }} />
            </div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Store</th><th>City</th><th>Category</th><th>Supplier</th><th className="num">Offers</th><th className="num">Stock units</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {filteredLocations.map((location: any) => (
                    <tr key={location.id} className="clickable" onClick={() => setStoreDetail(location.id)}>
                      <td><div className="strong">{location.name}</div><div className="xsmall muted">{location.contact_person ?? ''} {location.phone ? `· ${location.phone}` : ''}</div></td>
                      <td>{location.city_name}</td>
                      <td className="small">{meta?.enums.storeCategories.find((c: any) => c.value === location.category)?.label ?? location.category}</td>
                      <td className="small">{location.supplier_name ?? '—'}</td>
                      <td className="num">{location.offer_count}</td>
                      <td className="num">{location.stock_units}</td>
                      <td><Badge tone={location.active ? 'good' : 'neutral'}>{location.active ? 'Active' : 'Inactive'}</Badge></td>
                      <td className="actions-cell"><Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setStoreModal(location); }}>Edit</Btn></td>
                    </tr>
                  ))}
                  {!filteredLocations.length ? <tr><td colSpan={8}><EmptyState title="No stores match" message="Add a store inside any city." action={<Btn onClick={() => setStoreModal({})}>Add store</Btn>} /></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {cityModal ? (
        <CityModal
          city={cityModal.id ? cityModal : null}
          onClose={() => setCityModal(null)}
          onDone={() => { setCityModal(null); cities.reload(); reloadMeta(); }}
        />
      ) : null}
      {storeModal ? (
        <StoreModal
          store={storeModal.id ? storeModal : null}
          cities={cities.data?.cities ?? []}
          suppliers={meta?.suppliers ?? []}
          onClose={() => setStoreModal(null)}
          onDone={() => { setStoreModal(null); stores.reload(); cities.reload(); reloadMeta(); }}
        />
      ) : null}
      {storeDetail ? <StoreDetail id={storeDetail} onClose={() => setStoreDetail(null)} onChanged={() => stores.reload()} /> : null}
      {cityOverview ? <CityOverview id={cityOverview} onClose={() => setCityOverview(null)} /> : null}
    </>
  );
}

function CityModal({ city, onClose, onDone }: { city: any | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [form, setForm] = useState<any>(city ?? { name: '', state: '', code: '', notes: '', active: true });
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      if (city) await patch(`/locations/cities/${city.id}`, form);
      else await post('/locations/cities', form);
      push(city ? 'City updated' : 'City added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={city ? `Edit ${city.name}` : 'New city'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name}>Save city</Btn></>}>
      <div className="form-grid">
        <Field label="City name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="State"><Input value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></Field>
        <Field label="Short code"><Input value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="LKO" /></Field>
        <Field label="Active"><label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for orders</label></Field>
        <Field label="Notes" span2><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function StoreModal({ store, cities, suppliers, onClose, onDone }: { store: any | null; cities: any[]; suppliers: any[]; onClose: () => void; onDone: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [form, setForm] = useState<any>(
    store ?? { city_id: '', name: '', category: 'retail_shop', address: '', contact_person: '', phone: '', whatsapp: '', email: '', opening_hours: '', notes: '', rating: '', supplier_id: '', is_fulfilment_hub: false, active: true },
  );
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        city_id: Number(form.city_id),
        rating: form.rating === '' ? null : Number(form.rating),
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
      };
      if (store) await patch(`/locations/${store.id}`, payload);
      else await post('/locations', payload);
      push(store ? 'Store updated' : 'Store added', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={store ? store.name : 'New store'}
      subtitle="Retail, wholesale, packaging, printing, warehouse, storage or a local fulfilment hub."
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name || !form.city_id}>Save store</Btn></>}
    >
      <div className="form-grid">
        <Field label="City"><Select placeholder="Choose city" value={form.city_id} onChange={(e) => setForm({ ...form, city_id: e.target.value })} options={cities.map((c: any) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Store name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} options={(meta?.enums.storeCategories ?? []).map((c: any) => ({ value: c.value, label: c.label }))} />
        </Field>
        <Field label="Linked supplier (if a supplier branch)">
          <Select placeholder="Not a supplier branch" value={form.supplier_id ?? ''} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} options={suppliers.map((s: any) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Address" span2><Input value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
        <Field label="Contact person"><Input value={form.contact_person ?? ''} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></Field>
        <Field label="Phone"><Input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="WhatsApp"><Input value={form.whatsapp ?? ''} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
        <Field label="Email"><Input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Opening hours"><Input value={form.opening_hours ?? ''} onChange={(e) => setForm({ ...form, opening_hours: e.target.value })} placeholder="Mon–Sat 10:30–19:00" /></Field>
        <Field label="Reliability rating (0–5)"><Input type="number" step="0.1" min="0" max="5" value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value })} /></Field>
        <Field label="Fulfilment hub"><label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.is_fulfilment_hub} onChange={(e) => setForm({ ...form, is_fulfilment_hub: e.target.checked })} /> Packages can be assembled and dispatched here</label></Field>
        <Field label="Active"><label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for procurement</label></Field>
        <Field label="Notes" span2><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function StoreDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { push } = useToast();
  const { data, loading, reload } = useApi<any>(`/locations/${id}`, [id]);
  async function removePhoto(attachmentId: number) {
    try {
      await del(`/attachments/${attachmentId}`);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }
  return (
    <Modal
      title={data?.location?.name ?? 'Store'}
      subtitle={data?.location ? `${data.location.city_name} · ${data.location.category.replace(/_/g, ' ')}` : undefined}
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Close</Btn></>}
    >
      {loading && !data ? <Loading /> : !data ? null : (
        <div className="stack">
          <KeyValue
            rows={[
              ['Address', data.location.address],
              ['Contact', `${data.location.contact_person ?? ''} ${data.location.phone ? `· ${data.location.phone}` : ''}`],
              ['WhatsApp', data.location.whatsapp],
              ['Opening hours', data.location.opening_hours],
              ['Supplier', data.location.supplier_name],
              ['Rating', data.location.rating ? `${data.location.rating} / 5` : '—'],
              ['Notes', data.location.notes],
            ]}
          />
          <div className="divider" />
          <h4>Stock at this location</h4>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Product</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Damaged</th><th className="num">Min</th></tr></thead>
              <tbody>
                {data.inventory.map((row: any) => (
                  <tr key={row.id}><td>{row.product_name}<div className="xsmall muted mono">{row.sku}</div></td><td className="num">{row.qty_available}</td><td className="num">{row.qty_reserved}</td><td className="num">{row.qty_damaged}</td><td className="num">{row.min_stock}</td></tr>
                ))}
                {!data.inventory.length ? <tr><td colSpan={5} className="small muted" style={{ padding: 16 }}>No stock recorded here.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h4>Offers & price list</h4>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Product</th><th>Supplier</th><th className="num">Price</th><th className="num">MOQ</th></tr></thead>
              <tbody>
                {data.offers.map((offer: any) => (
                  <tr key={offer.id}><td>{offer.product_name}<div className="xsmall muted mono">{offer.sku}</div></td><td className="small">{offer.supplier_name ?? '—'}</td><td className="num">{offer.unit_price_paise ? `₹${(offer.unit_price_paise / 100).toLocaleString('en-IN')}` : '—'}</td><td className="num">{offer.moq}</td></tr>
                ))}
                {!data.offers.length ? <tr><td colSpan={4} className="small muted" style={{ padding: 16 }}>No price list entries yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h4>Recent movements</h4>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>By</th></tr></thead>
              <tbody>
                {data.recentMovements.map((movement: any) => (
                  <tr key={movement.id}><td className="small muted">{dateTime(movement.created_at)}</td><td>{movement.product_name}</td><td>{movement.type}</td><td className="num">{movement.qty}</td><td className="small muted">{movement.user_name ?? 'system'}</td></tr>
                ))}
                {!data.recentMovements.length ? <tr><td colSpan={5} className="small muted" style={{ padding: 16 }}>No movements.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <h4>Photographs</h4>
          <FileUpload entityType="location" entityId={id} kind="photo" label="Upload a store photograph" accept="image/*" onDone={reload} />
          <PhotoGrid attachments={data.photos} onDelete={removePhoto} />
        </div>
      )}
    </Modal>
  );
}

function CityOverview({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading } = useApi<any>(`/locations/cities/${id}/overview`, [id]);
  return (
    <Modal title={data?.city?.name ? `${data.city.name} overview` : 'City overview'} wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      {loading && !data ? <Loading /> : !data ? null : (
        <div className="stack">
          <div className="grid grid-3">
            <div><div className="tag">Stores</div><div className="big-money">{data.locations.length}</div></div>
            <div><div className="tag">Suppliers</div><div className="big-money">{data.suppliers.length}</div></div>
            <div><div className="tag">Orders touching this city</div><div className="big-money">{data.orders.length}</div></div>
          </div>
          <h4>Stores</h4>
          {data.locations.map((location: any) => (
            <div key={location.id} className="row small" style={{ justifyContent: 'space-between' }}>
              <span>{location.name} <span className="xsmall muted">{location.category.replace(/_/g, ' ')}</span></span>
              <span className="xsmall muted">{location.stock_units} units · {location.offer_count} offers</span>
            </div>
          ))}
          <h4>Suppliers</h4>
          {data.suppliers.length ? data.suppliers.map((supplier: any) => (
            <div key={supplier.id} className="row small" style={{ justifyContent: 'space-between' }}>
              <span>{supplier.name}</span>
              <span className="xsmall muted">{supplier.category ?? ''} · {supplier.lead_time_days ? `${supplier.lead_time_days}d lead` : ''}</span>
            </div>
          )) : <div className="small muted">No suppliers in this city yet.</div>}
          <h4>Stock highlights</h4>
          {data.stock.slice(0, 10).map((row: any) => (
            <div key={row.id} className="row small" style={{ justifyContent: 'space-between' }}>
              <span>{row.name}</span>
              <span className="mono">{row.available} available</span>
            </div>
          ))}
          <h4>Recent orders</h4>
          {data.orders.map((order: any) => (
            <div key={order.id} className="row small" style={{ justifyContent: 'space-between' }}>
              <span><span className="mono">{order.ref}</span> {order.campaign_name}</span>
              <Badge tone="outline">{order.status}</Badge>
            </div>
          ))}
          {!data.orders.length ? <div className="small muted">No orders reference this city yet.</div> : null}
        </div>
      )}
    </Modal>
  );
}
