import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateLabel, dateTime, inr } from '../lib/format';
import { Badge, Btn, EmptyState, KeyValue, Loading, PageHead, Stat } from '../components/ui';
import { SupplierModal } from './Suppliers';

export function SupplierDetail() {
  const { id } = useParams();
  const { meta } = useMeta();
  const { data, loading, error, reload } = useApi<any>(`/suppliers/${id}`, [id]);
  const [editing, setEditing] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;
  const { supplier, products, offers, purchaseOrders, branches, performance } = data;
  const onTime = performance.delivered ? Math.round((performance.on_time / performance.delivered) * 100) : null;

  return (
    <>
      <div style={{ marginBottom: 10 }}><Link to="/suppliers" className="small muted" style={{ textDecoration: 'underline' }}>← Suppliers</Link></div>
      <PageHead
        title={supplier.name}
        subtitle={<span className="row"><span>{supplier.category ?? 'Supplier'}</span><span className="muted">·</span><span>{supplier.city_name ?? 'No city'}</span>{supplier.active ? null : <Badge tone="neutral">Inactive</Badge>}</span>}
        actions={<Btn onClick={() => setEditing(true)}>Edit supplier</Btn>}
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Purchase orders" value={performance.po_count} foot={`${performance.delivered} delivered`} />
        <Stat label="Total spend" value={inr(performance.spend_paise)} foot="Across all POs" />
        <Stat label="On-time delivery" value={onTime === null ? '—' : `${onTime}%`} foot={onTime !== null && onTime < 80 ? 'Below target' : 'Delivery reliability'} tone={onTime !== null && onTime < 80 ? 'warn' : undefined} />
        <Stat label="Quality rating" value={supplier.quality_rating ? `${Number(supplier.quality_rating).toFixed(1)} ★` : '—'} foot={supplier.lead_time_days ? `${supplier.lead_time_days} day lead time` : 'No lead time set'} />
      </div>

      <div className="split" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h3>Contact & terms</h3></div>
          <div className="card-body">
            <KeyValue
              rows={[
                ['Contact', supplier.contact_person],
                ['Phone', supplier.phone],
                ['Email', supplier.email],
                ['Address', supplier.address],
                ['Products supplied', supplier.products_supplied],
                ['MOQ', supplier.moq],
                ['Payment terms', supplier.payment_terms],
                ['Backup supplier', supplier.backup_supplier_id ? <Link to={`/suppliers/${supplier.backup_supplier_id}`} style={{ textDecoration: 'underline' }}>View backup</Link> : 'None'],
                ['Reliability notes', supplier.reliability_notes],
              ]}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Branches & outlets</h3><span className="badge badge-outline">{branches.length}</span></div>
          <div className="card-body stack-sm">
            {branches.map((branch: any) => (
              <div key={branch.id} className="row" style={{ justifyContent: 'space-between', fontSize: 12.5 }}>
                <span>{branch.name}<div className="xsmall muted">{branch.city_name}</div></span>
                <Badge tone="outline">{branch.category.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
            {!branches.length ? <EmptyState title="No branches linked" message="Link a store to this supplier from Cities & stores." /> : null}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Products supplied</h3><span className="badge badge-outline">{products.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Product</th><th>SKU</th><th className="num">Purchase price</th><th className="num">Min stock</th><th>Status</th></tr></thead>
            <tbody>
              {products.map((product: any) => (
                <tr key={product.id}>
                  <td className="strong">{product.name}</td>
                  <td className="mono small">{product.sku}</td>
                  <td className="num">{inr(product.purchase_price_paise)}</td>
                  <td className="num">{product.min_stock}</td>
                  <td><Badge tone={product.active ? 'good' : 'neutral'}>{product.active ? 'Active' : 'Inactive'}</Badge></td>
                </tr>
              ))}
              {!products.length ? <tr><td colSpan={5}><EmptyState title="No products linked" /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head"><h3>Prices by store</h3><span className="badge badge-outline">{offers.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Product</th><th>Store</th><th>City</th><th className="num">Unit price</th><th className="num">MOQ</th><th className="num">Lead</th></tr></thead>
            <tbody>
              {offers.map((offer: any) => (
                <tr key={offer.id}>
                  <td>{offer.product_name}<div className="xsmall muted mono">{offer.sku}</div></td>
                  <td className="small">{offer.location_name ?? '—'}</td>
                  <td className="small">{offer.city_name ?? '—'}</td>
                  <td className="num">{inr(offer.unit_price_paise)}</td>
                  <td className="num">{offer.moq}</td>
                  <td className="num">{offer.lead_time_days ?? '—'}d</td>
                </tr>
              ))}
              {!offers.length ? <tr><td colSpan={6}><EmptyState title="No store-level prices yet" message="Add offers on a product to compare this supplier against others." /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Purchase history</h3><span className="badge badge-outline">{purchaseOrders.length}</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>PO</th><th>Campaign</th><th>Status</th><th className="num">Value</th><th>Expected</th><th>Delivered</th><th>Payment</th></tr></thead>
            <tbody>
              {purchaseOrders.map((po: any) => (
                <tr key={po.id}>
                  <td><Link to={`/procurement/${po.id}`} className="mono" style={{ textDecoration: 'underline' }}>{po.ref}</Link></td>
                  <td className="small">{po.order_ref ?? 'Stock purchase'}</td>
                  <td><Badge tone={po.status === 'received' ? 'good' : po.status === 'cancelled' ? 'bad' : 'info'}>{po.status}</Badge></td>
                  <td className="num">{inr(po.total_paise)}</td>
                  <td className="small muted">{dateLabel(po.expected_delivery)}</td>
                  <td className="small muted">{dateLabel(po.actual_delivery)}</td>
                  <td><Badge tone={po.payment_status === 'paid' ? 'good' : po.payment_status === 'partial' ? 'warn' : 'outline'}>{po.payment_status}</Badge></td>
                </tr>
              ))}
              {!purchaseOrders.length ? <tr><td colSpan={7}><EmptyState title="No purchases yet" /></td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      {editing ? (
        <SupplierModal
          supplier={supplier}
          cities={meta?.cities ?? []}
          suppliers={[]}
          onClose={() => setEditing(false)}
          onDone={() => { setEditing(false); reload(); }}
        />
      ) : null}
    </>
  );
}
