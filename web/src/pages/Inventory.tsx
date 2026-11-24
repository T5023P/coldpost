import { useMemo, useState } from 'react';
import { useApi } from '../lib/api';
import { useMeta } from '../lib/meta';
import { dateTime, inr } from '../lib/format';
import { Badge, Btn, EmptyState, Loading, PageHead, SearchInput, Select, Stat, Tabs } from '../components/ui';
import { StockActionModal } from '../components/StockActionModal';

export function Inventory() {
  const { meta } = useMeta();
  const [tab, setTab] = useState<'stock' | 'movements'>('stock');
  const [city, setCity] = useState('');
  const [location, setLocation] = useState('');
  const [search, setSearch] = useState('');
  const [actionOpen, setActionOpen] = useState<null | { type: 'adjust' | 'receive' | 'transfer'; row?: any }>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (city) params.set('city_id', city);
    if (location) params.set('location_id', location);
    if (search) params.set('search', search);
    return params.toString();
  }, [city, location, search]);

  const { data, loading, error, reload } = useApi<any>(`/inventory?${query}`, [query]);
  const movements = useApi<any>(`/inventory/movements?limit=200${location ? `&location_id=${location}` : ''}`, [location, tab]);
  const products = useApi<any>('/products?active=true');

  if (loading && !data) return <Loading />;
  if (error) return <div className="alert alert-bad">{error}</div>;
  if (!data) return null;

  const filteredLocations = city ? (meta?.locations ?? []).filter((l: any) => String(l.city_id) === city) : meta?.locations ?? [];
  const totals = data.totals ?? [];
  const totalUnits = totals.reduce((sum: number, row: any) => sum + row.available, 0);
  const reservedUnits = totals.reduce((sum: number, row: any) => sum + row.reserved, 0);
  const stockValue = totals.reduce((sum: number, row: any) => {
    const product = products.data?.products?.find((p: any) => p.id === row.id);
    return sum + row.available * (product?.purchase_price_paise ?? 0);
  }, 0);

  return (
    <>
      <PageHead
        title="Inventory"
        subtitle="Location-wise stock with an auditable movement behind every change. Nothing is combined across cities."
        actions={
          <>
            <Btn onClick={() => setActionOpen({ type: 'adjust' })}>Adjust stock</Btn>
            <Btn onClick={() => setActionOpen({ type: 'transfer' })}>Transfer</Btn>
            <Btn variant="primary" onClick={() => setActionOpen({ type: 'receive' })}>Receive stock</Btn>
          </>
        }
      />

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Units available" value={totalUnits} foot={`${totals.length} SKUs`} />
        <Stat label="Reserved" value={reservedUnits} foot="Held for confirmed campaigns" />
        <Stat label="Low stock" value={data.lowStock.length} foot="At or below minimum" tone={data.lowStock.length ? 'warn' : undefined} />
        <Stat label="Stock value (cost)" value={inr(stockValue)} foot="Available × purchase price" />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-body tight row">
          <div style={{ flex: 1, minWidth: 200 }}><SearchInput value={search} onChange={setSearch} placeholder="Search product or SKU…" /></div>
          <Select placeholder="All cities" value={city} onChange={(e) => { setCity(e.target.value); setLocation(''); }} options={(meta?.cities ?? []).map((c: any) => ({ value: c.id, label: c.name }))} style={{ width: 160 }} />
          <Select placeholder="All locations" value={location} onChange={(e) => setLocation(e.target.value)} options={filteredLocations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} style={{ width: 240 }} />
          {(city || location || search) ? <Btn size="sm" variant="ghost" onClick={() => { setCity(''); setLocation(''); setSearch(''); }}>Clear</Btn> : null}
        </div>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'stock', label: 'Stock levels', count: data.rows.length }, { key: 'movements', label: 'Movement ledger', count: movements.data?.movements?.length }]} />

      {tab === 'stock' ? (
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Stock by location</h3><span className="badge badge-outline">{data.rows.length} rows</span></div>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Product</th><th>City</th><th>Location</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Damaged</th><th></th></tr></thead>
                <tbody>
                  {data.rows.map((row: any) => (
                    <tr key={row.id}>
                      <td><div className="strong">{row.product_name}</div><div className="xsmall muted mono">{row.sku}</div></td>
                      <td>{row.city_name}</td>
                      <td className="small">{row.location_name}</td>
                      <td className="num">{row.qty_available}{row.qty_available <= row.min_stock ? <div><Badge tone="warn">low</Badge></div> : null}</td>
                      <td className="num">{row.qty_reserved}</td>
                      <td className="num">{row.qty_damaged}</td>
                      <td className="actions-cell">
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                          <Btn size="sm" variant="ghost" onClick={() => setActionOpen({ type: 'adjust', row })}>Adjust</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setActionOpen({ type: 'receive', row })}>Receive</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!data.rows.length ? <tr><td colSpan={7}><EmptyState title="No stock at these locations" message="Receive stock or adjust a count to begin." /></td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="split">
            <div className="card">
              <div className="card-head"><h3>Total stock by product</h3></div>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Product</th><th className="num">Available</th><th className="num">Reserved</th><th className="num">Damaged</th><th className="num">Incoming</th><th className="num">Min</th></tr></thead>
                  <tbody>
                    {totals.slice(0, 40).map((row: any) => {
                      const incoming = data.incoming.find((i: any) => i.product_id === row.id)?.incoming ?? 0;
                      return (
                        <tr key={row.id}>
                          <td>{row.name}<div className="xsmall muted mono">{row.sku}</div></td>
                          <td className="num">{row.available}</td>
                          <td className="num">{row.reserved}</td>
                          <td className="num">{row.damaged}</td>
                          <td className="num">{incoming}</td>
                          <td className="num">{row.min_stock}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h3>Low stock</h3><span className="badge badge-warn">{data.lowStock.length}</span></div>
              <div className="card-body stack-sm">
                {data.lowStock.map((row: any) => (
                  <div key={row.id} className="row" style={{ fontSize: 12.5 }}>
                    <span style={{ flex: 1 }}>{row.name}<div className="xsmall muted mono">{row.sku}</div></span>
                    <span className="mono">{row.available} / {row.min_stock}</span>
                  </div>
                ))}
                {!data.lowStock.length ? <EmptyState title="Stock levels healthy" /> : null}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head"><h3>Inventory movements</h3><span className="badge badge-outline">Newest first</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th>Location</th><th>Reference</th><th>Reason</th><th>By</th></tr></thead>
              <tbody>
                {(movements.data?.movements ?? []).map((movement: any) => (
                  <tr key={movement.id}>
                    <td className="small muted nowrap-text">{dateTime(movement.created_at)}</td>
                    <td>{movement.product_name}<div className="xsmall muted mono">{movement.sku}</div></td>
                    <td><Badge tone={['receive', 'transfer_in', 'return'].includes(movement.type) ? 'good' : ['damage', 'reject'].includes(movement.type) ? 'bad' : 'neutral'}>{movement.type}</Badge></td>
                    <td className="num">{movement.qty}</td>
                    <td className="small">{movement.location_name}<div className="xsmall muted">{movement.city_name}</div></td>
                    <td className="small mono">{movement.ref_type ? `${movement.ref_type}:${movement.ref_id ?? ''}` : '—'}</td>
                    <td className="small" style={{ maxWidth: 240 }}>{movement.reason ?? '—'}</td>
                    <td className="small muted">{movement.user_name ?? 'system'}</td>
                  </tr>
                ))}
                {!movements.data?.movements?.length ? <tr><td colSpan={8}><EmptyState title="No movements yet" /></td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {actionOpen ? (
        <StockActionModal
          type={actionOpen.type}
          row={actionOpen.row}
          products={products.data?.products ?? []}
          locations={meta?.locations ?? []}
          cities={meta?.cities ?? []}
          onClose={() => setActionOpen(null)}
          onDone={() => { setActionOpen(null); reload(); movements.reload(); }}
        />
      ) : null}
    </>
  );
}
