import { all, get, run } from '../db.js';

export const defaultSettings = {
  business: {
    name: 'Cold Post',
    tagline: 'Physical campaigns, gifting & fulfilment',
    email: '',
    phone: '',
    address: '',
    gstin: '',
    website: '',
  },
  currency: { code: 'INR', symbol: '₹', locale: 'en-IN' },
  tax: {
    label: 'GST',
    defaultRatePct: 18,
    inclusive: false,
    rates: [
      { name: 'GST 5%', ratePct: 5 },
      { name: 'GST 12%', ratePct: 12 },
      { name: 'GST 18%', ratePct: 18 },
      { name: 'GST 28%', ratePct: 28 },
    ],
  },
  numbering: {
    orderPrefix: 'CP',
    quotationPrefix: 'QT',
    purchasePrefix: 'PO',
    includeYear: true,
    padding: 4,
  },
  costing: {
    assemblyLabourPerPackagePaise: 12000,
    qcLabourPerPackagePaise: 3000,
    paymentFeePct: 2,
    defaultShippingPerPackagePaise: 15000,
    packagingBufferPct: 5,
  },
  qcChecklist: [
    'Correct recipient name',
    'Correct personalised letter',
    'Correct QR code or destination',
    'All required products included',
    'Products free from visible defects',
    'Stickers and labels applied correctly',
    'Packaging arranged correctly',
    'Protective filler included',
    'Tamper-evident seal applied',
    'Final package photographs uploaded',
    'Shipping label details checked',
  ],
  messaging: {
    defaultCountryCode: '+91',
    signature: '— Team Cold Post',
  },
  procurement: {
    advanceRequirementPct: 50,
  },
  operatingMode: 'manual' as 'manual' | 'api',
  notifications: {
    feedbackDelayDays: 3,
    lowStockAlerts: true,
  },
};

export type SettingsShape = typeof defaultSettings;

export function getSetting<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key as string);
  const fallback = defaultSettings[key];
  if (!row) return fallback;
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(fallback)) {
      return { ...(fallback as object), ...parsed } as SettingsShape[K];
    }
    return parsed as SettingsShape[K];
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown, userId?: number | null) {
  run(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`,
    key,
    JSON.stringify(value),
    userId ?? null,
  );
}

export function getAllSettings() {
  const stored = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const result: Record<string, any> = { ...defaultSettings };
  for (const row of stored) {
    try {
      const parsed = JSON.parse(row.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(result[row.key])) {
        result[row.key] = { ...(result[row.key] ?? {}), ...parsed };
      } else {
        result[row.key] = parsed;
      }
    } catch {
      /* skip malformed */
    }
  }
  return result;
}

export function operatingMode(): 'manual' | 'api' {
  const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'operatingMode'");
  if (!row) return 'manual';
  try {
    const parsed = JSON.parse(row.value);
    return parsed === 'api' ? 'api' : 'manual';
  } catch {
    return 'manual';
  }
}
