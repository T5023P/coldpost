import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { all, get, insert, run } from '../db.js';
import { asyncHandler, idParam, requireRow } from '../lib/http.js';
import { logAudit } from '../lib/audit.js';
import { ApiError } from '../lib/http.js';
import { UPLOAD_DIR } from '../db.js';

export const uploadsRouter = Router();

const ALLOWED_ENTITIES = new Set(['order', 'recipient', 'purchase_order', 'work_order', 'shipment', 'location', 'customer', 'product']);
const ALLOWED_KINDS = new Set(['assembly', 'qc', 'final', 'photo', 'document', 'invoice', 'label', 'pod', 'video']);
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
    const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '.bin';
    cb(null, `${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(10).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Only images, PDFs and short videos are allowed'));
      return;
    }
    cb(null, true);
  },
});

uploadsRouter.post(
  '/',
  upload.single('file'),
  asyncHandler((req, res) => {
    if (!req.file) throw new ApiError(400, 'Choose a file to upload');
    const entityType = String(req.body.entity_type ?? '');
    const kind = String(req.body.kind ?? 'document');
    const entityId = Number(req.body.entity_id);
    if (!ALLOWED_ENTITIES.has(entityType)) throw new ApiError(400, 'Invalid upload target');
    if (!ALLOWED_KINDS.has(kind)) throw new ApiError(400, 'Invalid upload kind');
    if (!Number.isInteger(entityId) || entityId <= 0) throw new ApiError(400, 'Invalid record id');
    const caption = req.body.caption ? String(req.body.caption).slice(0, 300) : null;
    const id = insert('attachments', {
      entity_type: entityType,
      entity_id: entityId,
      kind,
      file_name: req.file.originalname.slice(0, 200),
      file_path: req.file.filename,
      mime: req.file.mimetype,
      size_bytes: req.file.size,
      caption,
      uploaded_by: req.user!.id,
    });
    logAudit({
      userId: req.user!.id,
      action: 'attachment.upload',
      entityType,
      entityId,
      entityLabel: req.file.originalname,
      meta: { kind, attachmentId: id, size: req.file.size },
    });
    res.status(201).json({
      attachment: get('SELECT * FROM attachments WHERE id = ?', id),
      url: `/uploads/${req.file.filename}`,
    });
  }),
);

uploadsRouter.get(
  '/attachments',
  asyncHandler((req, res) => {
    const entityType = String(req.query.entity_type ?? '');
    const entityId = Number(req.query.entity_id);
    res.json({
      attachments: all<any>(
        'SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC',
        entityType,
        entityId,
      ),
    });
  }),
);

uploadsRouter.delete(
  '/attachments/:id',
  asyncHandler((req, res) => {
    const id = idParam(req);
    const attachment = requireRow(get<any>('SELECT * FROM attachments WHERE id = ?', id), 'Attachment');
    if (req.user!.role === 'viewer') throw new ApiError(403, 'Read-only account');
    run('DELETE FROM attachments WHERE id = ?', id);
    try {
      const filePath = path.join(UPLOAD_DIR, path.basename(attachment.file_path));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* file already gone */
    }
    logAudit({ userId: req.user!.id, action: 'attachment.delete', entityType: attachment.entity_type, entityId: attachment.entity_id, entityLabel: attachment.file_name });
    res.json({ ok: true });
  }),
);
