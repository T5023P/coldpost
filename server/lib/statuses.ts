export const ORDER_STATUSES = [
  'draft',
  'quotation',
  'awaiting_approval',
  'confirmed',
  'procurement',
  'items_received',
  'assembly_queued',
  'assembling',
  'qc_pending',
  'qc_passed',
  'packed',
  'ready_to_dispatch',
  'shipment_booked',
  'dispatched',
  'in_transit',
  'delivered',
  'closed',
  'on_hold',
  'cancelled',
  'delayed',
  'qc_failed',
  'shipment_exception',
  'returned',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  quotation: 'Quotation',
  awaiting_approval: 'Awaiting approval',
  confirmed: 'Confirmed',
  procurement: 'Procurement',
  items_received: 'Items received',
  assembly_queued: 'Assembly queued',
  assembling: 'Assembling',
  qc_pending: 'QC pending',
  qc_passed: 'QC passed',
  packed: 'Packed',
  ready_to_dispatch: 'Ready to dispatch',
  shipment_booked: 'Shipment booked',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  closed: 'Closed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
  delayed: 'Delayed',
  qc_failed: 'QC failed',
  shipment_exception: 'Shipment exception',
  returned: 'Returned',
};

export const ORDER_STATUS_TONE: Record<string, string> = {
  draft: 'neutral',
  quotation: 'info',
  awaiting_approval: 'warn',
  confirmed: 'info',
  procurement: 'warn',
  items_received: 'info',
  assembly_queued: 'info',
  assembling: 'warn',
  qc_pending: 'warn',
  qc_passed: 'good',
  packed: 'good',
  ready_to_dispatch: 'good',
  shipment_booked: 'info',
  dispatched: 'info',
  in_transit: 'info',
  delivered: 'good',
  closed: 'neutral',
  on_hold: 'warn',
  cancelled: 'bad',
  delayed: 'bad',
  qc_failed: 'bad',
  shipment_exception: 'bad',
  returned: 'bad',
};

/** Allowed manual order transitions. Anything else is rejected server-side. */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  draft: ['quotation', 'awaiting_approval', 'confirmed', 'cancelled', 'on_hold'],
  quotation: ['awaiting_approval', 'confirmed', 'draft', 'cancelled', 'on_hold'],
  awaiting_approval: ['quotation', 'confirmed', 'cancelled', 'on_hold'],
  confirmed: ['procurement', 'assembly_queued', 'items_received', 'on_hold', 'cancelled', 'delayed'],
  procurement: ['items_received', 'assembly_queued', 'on_hold', 'cancelled', 'delayed'],
  items_received: ['assembly_queued', 'procurement', 'on_hold', 'delayed'],
  assembly_queued: ['assembling', 'on_hold', 'cancelled', 'delayed'],
  assembling: ['qc_pending', 'assembly_queued', 'on_hold', 'delayed'],
  qc_pending: ['qc_passed', 'qc_failed', 'assembling', 'on_hold'],
  qc_failed: ['assembling', 'qc_pending', 'on_hold'],
  qc_passed: ['packed', 'qc_pending', 'on_hold'],
  packed: ['ready_to_dispatch', 'qc_pending', 'on_hold'],
  ready_to_dispatch: ['shipment_booked', 'packed', 'on_hold', 'cancelled'],
  shipment_booked: ['dispatched', 'ready_to_dispatch', 'on_hold'],
  dispatched: ['in_transit', 'delivered', 'shipment_exception', 'on_hold'],
  in_transit: ['delivered', 'shipment_exception', 'returned'],
  delivered: ['closed', 'returned'],
  closed: [],
  on_hold: ['confirmed', 'procurement', 'assembly_queued', 'ready_to_dispatch', 'cancelled', 'draft'],
  cancelled: [],
  delayed: [],
  shipment_exception: ['in_transit', 'delivered', 'returned', 'on_hold'],
  returned: ['closed', 'on_hold'],
};

export function canTransitionOrder(from: string, to: string) {
  if (from === to) return true;
  if (to === 'closed') return from !== 'cancelled';
  if (to === 'cancelled') return !['dispatched', 'in_transit', 'delivered', 'closed'].includes(from);
  if (to === 'delayed') return !['closed', 'cancelled', 'delivered'].includes(from);
  if (to === 'on_hold') return !['closed', 'cancelled'].includes(from);
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export const PACKAGE_STATUSES = [
  'pending',
  'procurement',
  'ready_for_assembly',
  'assembling',
  'qc_pending',
  'qc_failed',
  'rework',
  'qc_passed',
  'packed',
  'ready_to_dispatch',
  'shipment_booked',
  'dispatched',
  'in_transit',
  'delivered',
  'exception',
  'returned',
] as const;

export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  procurement: 'Awaiting stock',
  ready_for_assembly: 'Ready for assembly',
  assembling: 'Assembling',
  qc_pending: 'QC pending',
  qc_failed: 'QC failed',
  rework: 'Rework',
  qc_passed: 'QC passed',
  packed: 'Packed',
  ready_to_dispatch: 'Ready to dispatch',
  shipment_booked: 'Shipment booked',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  delivered: 'Delivered',
  exception: 'Exception',
  returned: 'Returned',
};

export const SHIPMENT_STATUSES = [
  'pending',
  'booked',
  'test_only',
  'dispatched',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'returned',
  'cancelled',
] as const;

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  booked: 'Booked',
  test_only: 'Test only — not a real booking',
  dispatched: 'Dispatched',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Exception',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const CAMPAIGN_TYPES = [
  'cold_outreach',
  'client_appreciation',
  'launch_pr',
  'event_invitation',
  'city_signature',
] as const;

export const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  cold_outreach: 'Cold Outreach Kit',
  client_appreciation: 'Client Appreciation Kit',
  launch_pr: 'Launch & PR Kit',
  event_invitation: 'Event & Invitation Kit',
  city_signature: 'City Signature Kit',
  custom: 'Custom',
};

export const PRODUCT_CATEGORIES = [
  'stationery',
  'desk_accessories',
  'drinkware',
  'bags',
  'interactive',
  'printed_materials',
  'samples',
  'artisan',
  'packaging',
  'other',
] as const;

export const PRODUCT_CATEGORY_LABEL: Record<string, string> = {
  stationery: 'Stationery',
  desk_accessories: 'Desk accessories',
  drinkware: 'Drinkware',
  bags: 'Bags',
  interactive: 'Interactive products',
  printed_materials: 'Printed materials',
  samples: 'Product samples',
  artisan: 'Artisan products',
  packaging: 'Packaging components',
  other: 'Other',
};

export const CUSTOMISATION_METHODS = [
  'sticker',
  'waterproof_label',
  'belly_band',
  'fabric_label',
  'sleeve',
  'printed_insert',
  'screen_print',
  'none',
] as const;

export const STORE_CATEGORIES = [
  'retail_shop',
  'wholesale_shop',
  'packaging_store',
  'printing_shop',
  'warehouse',
  'storage',
  'fulfilment_hub',
  'supplier_branch',
] as const;

export const STORE_CATEGORY_LABEL: Record<string, string> = {
  retail_shop: 'Retail shop',
  wholesale_shop: 'Wholesale shop',
  packaging_store: 'Packaging store',
  printing_shop: 'Printing shop',
  warehouse: 'Warehouse',
  storage: 'Storage location',
  fulfilment_hub: 'Local fulfilment hub',
  supplier_branch: 'Supplier branch',
};

export const PACKAGE_TRANSITIONS: Record<string, string[]> = {
  pending: ['procurement', 'ready_for_assembly', 'assembling'],
  procurement: ['ready_for_assembly', 'pending'],
  ready_for_assembly: ['assembling', 'pending'],
  assembling: ['qc_pending', 'ready_for_assembly'],
  qc_pending: ['qc_passed', 'qc_failed'],
  qc_failed: ['rework', 'assembling'],
  rework: ['assembling', 'qc_pending'],
  qc_passed: ['packed', 'ready_to_dispatch'],
  packed: ['ready_to_dispatch', 'qc_pending'],
  ready_to_dispatch: ['shipment_booked', 'packed'],
  shipment_booked: ['dispatched', 'ready_to_dispatch'],
  dispatched: ['in_transit', 'delivered'],
  in_transit: ['delivered', 'exception'],
  delivered: [],
  exception: ['in_transit', 'returned', 'delivered'],
  returned: [],
};

export function canTransitionPackage(from: string, to: string) {
  if (from === to) return true;
  return (PACKAGE_TRANSITIONS[from] ?? []).includes(to);
}

export const PACKAGE_ASSEMBLY_PATH: string[] = [
  'pending',
  'ready_for_assembly',
  'assembling',
  'qc_pending',
  'qc_passed',
  'packed',
  'ready_to_dispatch',
  'shipment_booked',
  'dispatched',
  'delivered',
];
