import { useState } from 'react';
import { post } from '../lib/api';
import { Btn, Field, Input, Modal, Select, Textarea, useToast } from './ui';

export function StockActionModal({
  type,
  row,
  products,
  locations,
  cities,
  onClose,
  onDone,
}: {
  type: 'adjust' | 'receive' | 'transfer';
  row?: any;
  products: any[];
  locations: any[];
  cities: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [productId, setProductId] = useState(row?.product_id ? String(row.product_id) : '');
  const [localId, setLocalId] = useState(row?.location_id ? String(row.location_id) : '');
  const [fromId, setFromId] = useState(row?.location_id ? String(row.location_id) : '');
  const [toId, setToId] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const visibleLocations = cityFilter ? locations.filter((l: any) => String(l.city_id) === cityFilter) : locations;

  async function submit() {
    setBusy(true);
    try {
      if (type === 'adjust') {
        await post('/inventory/adjust', { product_id: Number(productId), location_id: Number(localId), qty: Number(qty), reason });
        push('Stock adjustment recorded with reason', 'good');
      } else if (type === 'receive') {
        await post('/inventory/receive', { product_id: Number(productId), location_id: Number(localId), qty: Number(qty), reason: reason || 'Manual stock receipt' });
        push('Stock received into the ledger', 'good');
      } else {
        await post('/inventory/transfer', { product_id: Number(productId), from_location_id: Number(fromId), to_location_id: Number(toId), qty: Number(qty), note: reason || null });
        push('Stock transferred between locations', 'good');
      }
      onDone();
    } catch (error) {
      push((error as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  const valid = productId && Number(qty) !== 0 && (type === 'transfer' ? toId && fromId && fromId !== toId : localId) && (type !== 'adjust' || reason.trim().length >= 3);

  return (
    <Modal
      title={type === 'adjust' ? 'Adjust stock' : type === 'receive' ? 'Receive stock' : 'Transfer stock'}
      subtitle={type === 'adjust' ? 'Manual corrections require a reason and are written to the audit log.' : type === 'receive' ? 'For purchases outside a purchase order.' : 'Transfers create two linked movements, out and in.'}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={busy} disabled={!valid}>{type === 'adjust' ? 'Record adjustment' : type === 'receive' ? 'Receive stock' : 'Transfer'}</Btn></>}
    >
      <div className="stack">
        <Field label="Product">
          <Select placeholder="Choose product" value={productId} onChange={(e) => setProductId(e.target.value)} options={products.map((p: any) => ({ value: p.id, label: `${p.name} — ${p.sku}` }))} />
        </Field>
        <div className="row" style={{ gap: 8 }}>
          <Select placeholder="Filter by city" value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} options={cities.map((c: any) => ({ value: c.id, label: c.name }))} style={{ width: 170 }} />
          {type === 'transfer' ? (
            <>
              <Select placeholder="From location" value={fromId} onChange={(e) => setFromId(e.target.value)} options={visibleLocations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
              <Select placeholder="To location" value={toId} onChange={(e) => setToId(e.target.value)} options={visibleLocations.filter((l: any) => String(l.id) !== fromId).map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
            </>
          ) : (
            <div style={{ flex: 1 }}>
              <Select placeholder="Location" value={localId} onChange={(e) => setLocalId(e.target.value)} options={visibleLocations.map((l: any) => ({ value: l.id, label: `${l.name} — ${l.city_name}` }))} />
            </div>
          )}
        </div>
        <Field label={type === 'adjust' ? 'Quantity change (+ or −)' : 'Quantity'} hint={type === 'adjust' ? 'Use a negative number to reduce stock.' : undefined}>
          <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={type === 'adjust' ? '-2' : '10'} />
        </Field>
        <Field label={type === 'adjust' ? 'Reason (required)' : 'Note'}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'adjust' ? 'Damaged in storage, count correction…' : 'Optional note'} />
        </Field>
      </div>
    </Modal>
  );
}
