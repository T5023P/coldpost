import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Meta {
  user: any;
  operatingMode: 'manual' | 'api';
  settings: any;
  providers: any[];
  cities: any[];
  locations: any[];
  suppliers: any[];
  enums: {
    campaignTypes: { value: string; label: string }[];
    orderStatuses: { value: string; label: string; tone: string }[];
    packageStatuses: { value: string; label: string }[];
    shipmentStatuses: { value: string; label: string }[];
    productCategories: { value: string; label: string }[];
    storeCategories: { value: string; label: string }[];
    customisationMethods: string[];
    productCategoryLabel: Record<string, string>;
    campaignTypeLabel: Record<string, string>;
    orderTransitions: Record<string, string[]>;
    packageTransitions: Record<string, string[]>;
  };
  stats: { products: number; openOrders: number; qcQueue: number };
}

const MetaContext = createContext<{ meta: Meta | null; loading: boolean; reload: () => Promise<void> }>({
  meta: null,
  loading: true,
  reload: async () => undefined,
});

export function MetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<Meta>('/meta');
      setMeta(data);
    } catch {
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo(() => ({ meta, loading, reload }), [meta, loading, reload]);
  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  return useContext(MetaContext);
}

export function statusLabel(meta: Meta | null, status: string) {
  return meta?.enums.orderStatuses.find((s) => s.value === status)?.label ?? status.replace(/_/g, ' ');
}

export function statusTone(meta: Meta | null, status: string) {
  return meta?.enums.orderStatuses.find((s) => s.value === status)?.tone ?? 'neutral';
}

export function campaignLabel(meta: Meta | null, value: string) {
  return meta?.enums.campaignTypeLabel[value] ?? value;
}
