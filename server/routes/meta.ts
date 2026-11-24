import { Router } from 'express';
import { all, get } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { getAllSettings, operatingMode } from '../lib/settings.js';
import { publicProvider } from '../providers/service.js';
import { ORDER_TRANSITIONS, PACKAGE_TRANSITIONS } from '../lib/statuses.js';
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABEL,
  CUSTOMISATION_METHODS,
  ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
  PACKAGE_STATUSES,
  PACKAGE_STATUS_LABEL,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABEL,
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABEL,
  STORE_CATEGORIES,
  STORE_CATEGORY_LABEL,
} from '../lib/statuses.js';

export const metaRouter = Router();

metaRouter.get(
  '/',
  asyncHandler((req, res) => {
    res.json({
      user: req.user,
      operatingMode: operatingMode(),
      settings: getAllSettings(),
      providers: all<any>('SELECT * FROM api_providers').map(publicProvider),
      cities: all<any>('SELECT * FROM cities WHERE active = 1 ORDER BY name'),
      locations: all<any>(
        `SELECT l.id, l.name, l.category, l.city_id, l.is_fulfilment_hub, c.name AS city_name
         FROM locations l JOIN cities c ON c.id = l.city_id WHERE l.active = 1 ORDER BY c.name, l.name`,
      ),
      suppliers: all<any>('SELECT id, name, category, city_id, lead_time_days, quality_rating FROM suppliers WHERE active = 1 ORDER BY name'),
      enums: {
        campaignTypes: CAMPAIGN_TYPES.map((value) => ({ value, label: CAMPAIGN_TYPE_LABEL[value] })),
        orderStatuses: ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_LABEL[value], tone: ORDER_STATUS_TONE[value] })),
        packageStatuses: PACKAGE_STATUSES.map((value) => ({ value, label: PACKAGE_STATUS_LABEL[value] })),
        shipmentStatuses: SHIPMENT_STATUSES.map((value) => ({ value, label: SHIPMENT_STATUS_LABEL[value] })),
        productCategories: PRODUCT_CATEGORIES.map((value) => ({ value, label: PRODUCT_CATEGORY_LABEL[value] })),
        storeCategories: STORE_CATEGORIES.map((value) => ({ value, label: STORE_CATEGORY_LABEL[value] })),
        customisationMethods: CUSTOMISATION_METHODS,
        productCategoryLabel: PRODUCT_CATEGORY_LABEL,
        campaignTypeLabel: CAMPAIGN_TYPE_LABEL,
        orderTransitions: ORDER_TRANSITIONS,
        packageTransitions: PACKAGE_TRANSITIONS,
      },
      stats: {
        products: get<{ c: number }>('SELECT COUNT(*) AS c FROM products')!.c,
        openOrders: get<{ c: number }>("SELECT COUNT(*) AS c FROM orders WHERE status NOT IN ('closed','cancelled','delivered')")!.c,
        qcQueue: get<{ c: number }>("SELECT COUNT(*) AS c FROM recipients WHERE status IN ('qc_pending','qc_failed','rework')")!.c,
      },
    });
  }),
);
