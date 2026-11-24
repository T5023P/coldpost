import { all, insert } from '../db.js';

export interface AuditInput {
  userId?: number | null;
  action: string;
  entityType?: string;
  entityId?: number | null;
  entityLabel?: string | null;
  meta?: Record<string, unknown>;
  manualOverride?: boolean;
}

export function logAudit(input: AuditInput) {
  return insert('audit_logs', {
    user_id: input.userId ?? null,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    entity_label: input.entityLabel ?? null,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    manual_override: input.manualOverride ? 1 : 0,
  });
}

export function recentActivity(limit = 12) {
  return all(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.entity_label, a.meta, a.manual_override, a.created_at,
            u.name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT ?`,
    limit,
  );
}
