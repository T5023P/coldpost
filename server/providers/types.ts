export type ProviderKind = 'shipping' | 'tracking' | 'notification';

export interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  required?: boolean;
}

export interface ProviderDescriptor {
  kind: ProviderKind;
  slug: string;
  name: string;
  description: string;
  fields: ProviderField[];
  docsUrl?: string;
  note?: string;
  /** true when the provider can never be fully configured from this app. */
  requiresExternalSetup?: boolean;
}

export interface ProviderRow {
  id: number;
  kind: ProviderKind;
  slug: string;
  name: string;
  description: string | null;
  config: string;
  environment: 'test' | 'live';
  status: string;
  last_check_at: string | null;
  last_check_message: string | null;
  is_default: number;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface Runtime {
  provider: ProviderRow;
  config: Record<string, any>;
  secrets: Record<string, string>;
  environment: 'test' | 'live';
}

export interface ProviderResult<T = unknown> {
  ok: boolean;
  test?: boolean;
  message?: string;
  data?: T;
  httpStatus?: number;
  requestMeta?: Record<string, unknown>;
  responseMeta?: Record<string, unknown>;
}

export interface ShipmentBookingInput {
  reference: string;
  orderRef: string;
  recipient: {
    name: string;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    country?: string | null;
  };
  packageCount: number;
  weightG?: number | null;
  dimensions?: string | null;
  service?: string | null;
  declaredValuePaise?: number;
}

export interface ShipmentBookingResult {
  awb: string;
  trackingUrl?: string | null;
  providerRef?: string | null;
  courierName?: string | null;
}

export interface TrackingEvent {
  status: string;
  description?: string;
  location?: string;
  eventAt?: string;
}

export interface TrackingResult {
  status?: string;
  events: TrackingEvent[];
  raw?: unknown;
}

export interface MessageInput {
  to: string;
  body: string;
  reference: string;
}

export interface MessageResult {
  providerRef?: string | null;
  message?: string;
}
