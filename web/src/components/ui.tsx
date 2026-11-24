import { apiUrl } from '../lib/api';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { uploadFile } from '../lib/api';
import { inr } from '../lib/format';

/* --------------------------------- Toasts -------------------------------- */

type Toast = { id: number; message: string; tone: 'good' | 'bad' | 'warn' | 'neutral' };
const ToastContext = createContext<{ push: (message: string, tone?: Toast['tone']) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast['tone'] = 'neutral') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 4200);
  }, []);
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`} role="status">
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button className="close" onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* --------------------------------- Buttons ------------------------------- */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'accent' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  block?: boolean;
};

export function Btn({ variant = 'default', size = 'md', loading, block, className = '', children, ...rest }: BtnProps) {
  const variantClass = variant === 'default' ? '' : `btn-${variant}`;
  return (
    <button
      type="button"
      {...rest}
      className={`btn ${variantClass} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`}
      disabled={rest.disabled || loading}
    >
      {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : null}
      {children}
    </button>
  );
}

/* --------------------------------- Inputs -------------------------------- */

export function Field({ label, hint, children, span2 }: { label: string; hint?: string; children: ReactNode; span2?: boolean }) {
  return (
    <div className={`field ${span2 ? 'span-2' : ''}`}>
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`textarea ${props.className ?? ''}`} />;
}

export function Select({ options, placeholder, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string | number; label: string }[];
  placeholder?: string;
}) {
  return (
    <select {...rest} className={`select ${rest.className ?? ''}`}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: number;
  onChange: (paise: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => (value ? String(value / 100) : ''));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ? String(value / 100) : '');
  }, [value]);
  return (
    <div style={{ position: 'relative' }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', fontSize: 13 }}>₹</span>
      <input
        className="input"
        style={{ paddingLeft: 22 }}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder ?? '0.00'}
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          setText(value ? String(value / 100) : '');
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9.]/g, '');
          setText(next);
          const n = Number(next);
          onChange(Number.isFinite(n) ? Math.round(n * 100) : 0);
        }}
      />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search…'} />
    </div>
  );
}

/* ---------------------------------- Modal -------------------------------- */

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  narrow,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  narrow?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="sub">{subtitle}</div> : null}
          </div>
          <Btn variant="ghost" className="close" onClick={onClose} aria-label="Close">✕</Btn>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------- Misc --------------------------------- */

export function Badge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  const allowed = ['good', 'warn', 'bad', 'info', 'neutral', 'accent', 'outline'];
  return <span className={`badge ${allowed.includes(tone) ? `badge-${tone}` : 'badge-neutral'}`}>{children}</span>;
}

export function DotBadge({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  return (
    <Badge tone={tone}>
      <span className="dot" />
      {children}
    </Badge>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16v12H4z" />
          <path d="M4 7 7 3h10l3 4" />
        </svg>
      </div>
      <strong>{title}</strong>
      {message ? <span className="small">{message}</span> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading-block">
      <span className="spinner" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (key: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.key} role="tab" aria-selected={value === tab.key} className={`tab ${value === tab.key ? 'active' : ''}`} onClick={() => onChange(tab.key)}>
          {tab.label}
          {tab.count !== undefined ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label,
  value,
  foot,
  tone,
  onClick,
  dark,
}: {
  label: string;
  value: ReactNode;
  foot?: ReactNode;
  tone?: 'warn' | 'bad';
  onClick?: () => void;
  dark?: boolean;
}) {
  return (
    <div className={`stat ${dark ? 'accent' : ''} ${tone ?? ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {foot ? <div className="foot">{foot}</div> : null}
    </div>
  );
}

export function PageHead({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([key, value], index) => (
        <div key={`${key}-${index}`} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FileUpload({
  entityType,
  entityId,
  kind,
  label,
  accept = 'image/*,application/pdf',
  onDone,
  caption,
}: {
  entityType: string;
  entityId: number;
  kind: string;
  label?: string;
  accept?: string;
  onDone: () => void;
  caption?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const inputId = useId();
  return (
    <label className="upload-zone" htmlFor={inputId} style={{ display: 'block' }}>
      {busy ? (
        <span className="row" style={{ justifyContent: 'center' }}>
          <span className="spinner" /> Uploading…
        </span>
      ) : (
        label ?? 'Click to upload a photograph or document'
      )}
      <input
        id={inputId}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            await uploadFile(file, { entity_type: entityType, entity_id: String(entityId), kind, caption: caption ?? '' });
            push('Photo uploaded', 'good');
            onDone();
          } catch (error) {
            push((error as Error).message, 'bad');
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

export function PhotoGrid({ attachments, onDelete }: { attachments: any[]; onDelete?: (id: number) => void }) {
  if (!attachments?.length) return <div className="small muted">No photographs uploaded yet.</div>;
  return (
    <div className="photo-grid">
      {attachments.map((attachment) => (
        <div className="photo" key={attachment.id}>
          {attachment.mime?.startsWith('image/') ? (
            <a href={apiUrl(`/uploads/${attachment.file_path}`)} target="_blank" rel="noreferrer">
              <img src={apiUrl(`/uploads/${attachment.file_path}`)} alt={attachment.caption || attachment.file_name} />
            </a>
          ) : (
            <a href={apiUrl(`/uploads/${attachment.file_path}`)} target="_blank" rel="noreferrer" className="small" style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', padding: 8, textAlign: 'center' }}>
              {attachment.file_name}
            </a>
          )}
          <div className="cap">{attachment.kind}{attachment.caption ? ` · ${attachment.caption}` : ''}</div>
          {onDelete ? (
            <button
              onClick={() => onDelete(attachment.id)}
              title="Delete"
              style={{ position: 'absolute', top: 3, right: 3, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 6, width: 20, height: 20, cursor: 'pointer', fontSize: 12, lineHeight: 1 }}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Money({ paise, className = '', tone }: { paise: number | null | undefined; className?: string; tone?: 'pos' | 'neg' }) {
  const value = paise ?? 0;
  const resolved = tone ?? (value < 0 ? 'neg' : undefined);
  return <span className={`money ${resolved === 'neg' ? 'neg' : resolved === 'pos' ? 'pos' : ''} ${className}`}>{inr(value)}</span>;
}

export function Progress({ value, accent }: { value: number; accent?: boolean }) {
  return (
    <div className={`progress ${accent ? 'accent' : ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
