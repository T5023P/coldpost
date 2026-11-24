import { useState } from 'react';
import { del, patch, post, useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateTime, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Field, FileUpload, Input, Loading, Modal, MoneyInput, PageHead, PhotoGrid, SearchInput, Select, Tabs, Textarea, useToast } from '../components/ui';

export function Products() {
  const { meta } = useMeta();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState('true');
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (category) query.set('category', category);
  if (active) query.set('active', active);
  const { data, loading, error, reload } = useApi<any>(`/products?${query.toString()}`, [search, category, active]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const products = data?.products ?? [];

  return (
    <>
      <PageHead
        title="Product catalogue"
        subtitle="One product record, sold by many stores across cities at different prices and lead times."
        actions={<Btn variant="primary" onClick={() => setCreating(true)}>+ New product</Btn>}
      />

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ minWidth: 220, flex: 1 }}><SearchInput value={search} onChange={setSearch} placeholder="Search name or SKU…" /></div>
          <Select placeholder="All categories" value={category} onChange={(e) => setCategory(e.target.value)} options={(meta?.enums.productCategories ?? []).map((c) => ({ value: c.value, label: c.label }))} style={{ width: 190 }} />
          <Select value={active} onChange={(e) => setActive(e.target.value)} options={[{ value: 'true', label: 'Active only' }, { value: '', label: 'All products' }]} style={{ width: 150 }} />
        </div>
      </div>

      <div className="card">
        {loading && !data ? <Loading /> : error ? <div className="alert alert-bad" style={{ margin: 16 }}>{error}</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Product</th><th>Category</th><th>Supplier</th><th className="num">Cost</th><th className="num">Sell</th><th className="num">On hand</th><th className="num">Locations</th><th>Customisation</th><th></th></tr>
              </thead>
              <tbody>
                {products.map((product: any) => (
                  <tr key={product.id} className="clickable" onClick={() => setDetail(product.id)}>
                    <td>
                      <div className="strong">{product.name}</div>
                      <div className="xsmall muted mono">{product.sku}</div>
                    </td>
                    <td className="small">{meta?.enums.productCategoryLabel[product.category] ?? product.category}</td>
                    <td className="small">{product.supplier_name ?? '—'}</td>
                    <td className="num">{inr(product.purchase_price_paise)}</td>
                    <td className="num">{product.selling_price_paise ? inr(product.selling_price_paise) : '—'}</td>
                    <td className="num">
                      <strong>{product.stock_available}</strong>
                      {product.stock_reserved ? <span className="xsmall muted"> / {product.stock_reserved} res</span> : null}
                      {product.stock_available <= product.min_stock ? <div><Badge tone="warn">Low stock</Badge></div> : null}
                    </td>
                    <td className="num">{product.offer_count}</td>
                    <td className="small">{product.customisation_method?.replace(/_/g, ' ') ?? '—'}</td>
                    <td className="actions-cell">
                      <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(product); }}>Edit</Btn>
                    </td>
                  </tr>
                ))}
                {!products.length ? <tr><td colSpan={9}><EmptyState title="No products found" message="Add your first product to build BOMs." action={<Btn onClick={() => setCreating(true)}>New product</Btn>} /></td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating || editing ? (
        <ProductModal
          product={editing}
          suppliers={meta?.suppliers ?? []}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => { setCreating(false); setEditing(null); reload(); }}
        />
      ) : null}
      {detail ? <ProductDetail productId={detail} onClose={() => setDetail(null)} onEdit={(product) => { setDetail(null); setEditing(product); }} /> : null}
    </>
  );
}

export function ProductModal({ product, suppliers, onClose, onDone }: { product?: any; suppliers: any[]; onClose: () => void; onDone: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [form, setForm] = useState<any>(
    product ?? {
      sku: '',
      name: '',
      category: 'stationery',
      description: '',
      supplier_id: '',
      purchase_price_paise: 0,
      selling_price_paise: 0,
      min_stock: 0,
      uom: 'pcs',
      customisation_method: '',
      personalisation_notes: '',
      dimensions: '',
      weight_g: '',
      is_packaging: false,
      active: true,
      image_path: '',
    },
  );
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: any) => setForm((prev: any) => ({ ...prev, [key]: value }));

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        ...form,
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        weight_g: form.weight_g === '' ? null : Number(form.weight_g),
        customisation_method: form.customisation_method || null,
      };
      if (product) await patch(`/products/${product.id}`, payload);
      else await post('/products', payload);
      push(product ? 'Product updated' : 'Product created', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={product ? product.name : 'New product'}
      subtitle="Purchase prices are your costs; selling prices are optional reference retail."
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!form.name || !form.sku}>Save product</Btn></>}
    >
      <div className="form-grid">
        <Field label="SKU"><Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="STN-NBK-01" /></Field>
        <Field label="Product name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => set('category', e.target.value)} options={(meta?.enums.productCategories ?? []).map((c) => ({ value: c.value, label: c.label }))} />
        </Field>
        <Field label="Default supplier">
          <Select placeholder="No supplier" value={form.supplier_id ?? ''} onChange={(e) => set('supplier_id', e.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Purchase price"><MoneyInput value={form.purchase_price_paise} onChange={(v) => set('purchase_price_paise', v)} /></Field>
        <Field label="Selling price"><MoneyInput value={form.selling_price_paise} onChange={(v) => set('selling_price_paise', v)} /></Field>
        <Field label="Minimum stock" hint="Low-stock alerts trigger at or below this level."><Input type="number" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} /></Field>
        <Field label="Unit of measurement"><Input value={form.uom} onChange={(e) => set('uom', e.target.value)} /></Field>
        <Field label="Customisation method">
          <Select placeholder="No customisation" value={form.customisation_method ?? ''} onChange={(e) => set('customisation_method', e.target.value)} options={(meta?.enums.customisationMethods ?? []).map((m) => ({ value: m, label: m.replace(/_/g, ' ') }))} />
        </Field>
        <Field label="Weight (g)"><Input type="number" value={form.weight_g ?? ''} onChange={(e) => set('weight_g', e.target.value)} /></Field>
        <Field label="Dimensions"><Input value={form.dimensions ?? ''} onChange={(e) => set('dimensions', e.target.value)} placeholder="24 × 18 × 8 cm" /></Field>
        <Field label="Packaging component">
          <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.is_packaging} onChange={(e) => set('is_packaging', e.target.checked)} /> This is packaging, not a gift item</label>
        </Field>
        <Field label="Description" span2><Textarea value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Personalisation notes" span2><Textarea value={form.personalisation_notes ?? ''} onChange={(e) => set('personalisation_notes', e.target.value)} placeholder="What must be printed, labelled or checked before packing?" /></Field>
        <Field label="Product photograph" span2>
          {form.id ? (
            <div className="stack-sm">
              <FileUpload entityType="product" entityId={form.id} kind="photo" label="Upload a product photograph" onDone={() => push('Uploaded — reopen the product to see it', 'good')} accept="image/*" />
            </div>
          ) : <div className="small muted">Save the product first, then upload its photograph.</div>}
        </Field>
        <Field label="Active">
          <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.active} onChange={(e) => set('active', e.target.checked)} /> Available for new BOMs</label>
        </Field>
      </div>
    </Modal>
  );
}

function ProductDetail({ productId, onClose, onEdit }: { productId: number; onClose: () => void; onEdit: (product: any) => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const { data, loading, reload } = useApi<any>(`/products/${productId}`, [productId]);
  const [tab, setTab] = useState<'offers' | 'stock' | 'movements'>('offers');
  const [offerOpen, setOfferOpen] = useState<any>(null);
  const photos = useApi<any>(`/attachments?entity_type=product&entity_id=${productId}`, [productId]);
  const [busy, setBusy] = useState(false);

  async function removeOffer(id: number) {
    if (!window.confirm('Delete this store offer?')) return;
    try {
      await del(`/offers/${id}`);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  async function deletePhoto(id: number) {
    try {
      await del(`/attachments/${id}`);
      reload();
    } catch (error) {
      push((error as Error).message, 'bad');
    }
  }

  return (
    <Modal
      title={data?.product?.name ?? 'Product'}
      subtitle={data ? `${data.product.sku} · ${meta?.enums.productCategoryLabel[data.product.category] ?? data.product.category}` : undefined}
      wide
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Close</Btn>{data ? <Btn variant="primary" onClick={() => onEdit(data.product)}>Edit product</Btn> : null}</>}
    >
      {loading && !data ? <Loading /> : !data ? null : (
        <div className="stack">
          <div className="grid grid-3">
            <div><div className="tag">Purchase price</div><div className="big-money">{inr(data.product.purchase_price_paise)}</div></div>
            <div><div className="tag">Total stock</div><div className="big-money">{data.inventory.reduce((sum: number, row: any) => sum + row.qty_available, 0)}</div><div className="small muted">across {data.inventory.length} location(s)</div></div>
            <div><div className="tag">Used in BOMs</div><div className="big-money">{data.usedInBoms}</div></div>
          </div>
          {data.product.description ? <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{data.product.description}</p> : null}

          <div className="divider" />
          <div className="row">
            <h4>Store offers & availability</h4>
            <span className="spacer" />
            <Btn size="sm" onClick={() => setOfferOpen({})}>+ Add store offer</Btn>
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'offers', label: 'Offers by city', count: data.offers.length },
              { key: 'stock', label: 'Stock by location', count: data.inventory.length },
              { key: 'movements', label: 'Movements', count: data.movements.length },
            ]}
          />
          {tab === 'offers' ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>City</th><th>Store</th><th>Supplier</th><th className="num">Price</th><th className="num">MOQ</th><th className="num">Lead</th><th className="num">Stock</th><th></th></tr></thead>
                <tbody>
                  {data.offers.map((offer: any) => (
                    <tr key={offer.id}>
                      <td>{offer.city_name ?? '—'}</td>
                      <td className="small">{offer.location_name ?? '—'}<div className="xsmall muted">{offer.location_category?.replace(/_/g, ' ')}</div></td>
                      <td className="small">{offer.supplier_name ?? '—'}{offer.quality_rating ? <span className="xsmall muted"> · {Number(offer.quality_rating).toFixed(1)} ★</span> : null}</td>
                      <td className="num">{inr(offer.unit_price_paise)}</td>
                      <td className="num">{offer.moq}</td>
                      <td className="num">{offer.lead_time_days ?? '—'}d</td>
                      <td className="num">{offer.stock_available}</td>
                      <td className="actions-cell">
                        <Btn size="sm" variant="ghost" onClick={() => setOfferOpen(offer)}>Edit</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => removeOffer(offer.id)}>✕</Btn>
                      </td>
                    </tr>
                  ))}
                  {!data.offers.length ? <tr><td colSpan={8} className="small muted" style={{ padding: 16 }}>No store offers yet. Add one so this product can be procured in a specific city.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {tab === 'stock' ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>City</th><th>Location</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Damaged</th></tr></thead>
                <tbody>
                  {data.inventory.map((row: any) => (
                    <tr key={row.id}>
                      <td>{row.city_name}</td>
                      <td>{row.location_name}</td>
                      <td className="num">{row.qty_available}</td>
                      <td className="num">{row.qty_reserved}</td>
                      <td className="num">{row.qty_damaged}</td>
                    </tr>
                  ))}
                  {!data.inventory.length ? <tr><td colSpan={5} className="small muted" style={{ padding: 16 }}>No stock recorded for this product.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {tab === 'movements' ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>When</th><th>Type</th><th className="num">Qty</th><th>Location</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>
                  {data.movements.map((movement: any) => (
                    <tr key={movement.id}>
                      <td className="small muted">{dateTime(movement.created_at)}</td>
                      <td className="small">{movement.type}</td>
                      <td className="num">{movement.qty}</td>
                      <td className="small">{movement.location_name}</td>
                      <td className="small">{movement.reason ?? '—'}</td>
                      <td className="small muted">{movement.user_name ?? 'system'}</td>
                    </tr>
                  ))}
                  {!data.movements.length ? <tr><td colSpan={6} className="small muted" style={{ padding: 16 }}>No movements recorded.</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="divider" />
          <h4>Photographs</h4>
          <FileUpload entityType="product" entityId={productId} kind="photo" label="Upload a product photograph" accept="image/*" onDone={() => { reload(); photos.reload(); }} />
          <PhotoGrid attachments={photos.data?.attachments ?? []} />
        </div>
      )}
      {offerOpen ? (
        <OfferModal productId={productId} offer={offerOpen.id ? offerOpen : null} onClose={() => setOfferOpen(null)} onDone={() => { setOfferOpen(null); reload(); }} />
      ) : null}
    </Modal>
  );
}

function OfferModal({ productId, offer, onClose, onDone }: { productId: number; offer: any | null; onClose: () => void; onDone: () => void }) {
  const { meta } = useMeta();
  const { push } = useToast();
  const [form, setForm] = useState<any>(offer ?? { supplier_id: '', location_id: '', unit_price_paise: 0, moq: 1, lead_time_days: '', notes: '', active: true });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload = {
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        location_id: form.location_id ? Number(form.location_id) : null,
        unit_price_paise: Number(form.unit_price_paise),
        moq: Number(form.moq),
        lead_time_days: form.lead_time_days === '' ? null : Number(form.lead_time_days),
        notes: form.notes || null,
        active: !!form.active,
      };
      if (offer) await patch(`/offers/${offer.id}`, payload);
      else await post(`/products/${productId}/offers`, payload);
      push('Store offer saved', 'good');
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={offer ? 'Edit store offer' : 'Add store offer'}
      subtitle="Prices and MOQ are specific to a store in a city. The same product can have many offers."
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy}>Save offer</Btn></>}
    >
      <div className="form-grid">
        <Field label="Store / location">
          <Select placeholder="Choose store" value={form.location_id ?? ''} onChange={(e) => setForm({ ...form, location_id: e.target.value })} options={(meta?.locations ?? []).map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
        </Field>
        <Field label="Supplier at this store">
          <Select placeholder="No supplier" value={form.supplier_id ?? ''} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} options={(meta?.suppliers ?? []).map((s: any) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Unit price"><MoneyInput value={form.unit_price_paise} onChange={(v) => setForm({ ...form, unit_price_paise: v })} /></Field>
        <Field label="Minimum order quantity"><Input type="number" value={form.moq} onChange={(e) => setForm({ ...form, moq: e.target.value })} /></Field>
        <Field label="Lead time (days)"><Input type="number" value={form.lead_time_days ?? ''} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} /></Field>
        <Field label="Active"><label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Available for sourcing</label></Field>
        <Field label="Notes" span2><Textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
