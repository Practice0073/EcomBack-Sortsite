import { useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Eye, EyeOff, Globe, Loader2, X } from 'lucide-react';
import type { ScanStatus, Severity } from '@shared/types';

// ── Gauge (circular issue ring) ───────────────────────────────────────────────
export function Gauge({ value, size = 120, stroke = 11, label, sub, tone = 'issues', ariaLabel }: { value: number; size?: number; stroke?: number; label?: ReactNode; sub?: string; tone?: 'issues' | 'score' | 'progress'; ariaLabel?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'score' ? (v >= 90 ? 'var(--success)' : v >= 70 ? 'var(--warning-dot)' : 'var(--priority)') : tone === 'progress' ? 'var(--progress-a)' : v === 0 ? 'var(--success)' : 'var(--priority)';
  return (
    <div className="gauge" style={{ width: size, height: size }} role="img" aria-label={ariaLabel ?? `${Math.round(v)}%`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <div className="gauge__label" aria-hidden="true" style={{ fontSize: size * 0.22 }}>
        <span>
          {label ?? `${Math.round(v)}%`}
          {sub && <small>{sub}</small>}
        </span>
      </div>
    </div>
  );
}

export function MiniRing({ value, title }: { value: number | null; title?: string }) {
  if (value === null) return <span className="muted small">—</span>;
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
      <Gauge value={value} size={36} stroke={5} label="" ariaLabel={title ?? `${value}% of pages have issues`} />
      <strong className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(value)}%</strong>
    </span>
  );
}

export function Bar({ value, tone = 'danger', label }: { value: number; tone?: 'danger' | 'progress' | 'success' | 'warn'; label?: string }) {
  return (
    <div className={`bar ${tone === 'progress' ? 'bar--progress' : tone === 'success' ? 'bar--success' : tone === 'warn' ? 'bar--warn' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label={label}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function BarRow({ label, pct, help, tone }: { label: string; pct: number; help?: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className="bar-row">
      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {label}
        {help && <HelpTip text={help} label={`About ${label}`} />}
      </span>
      <Bar value={pct} tone={tone} label={`${label}: ${pct}% of pages`} />
      <span className="bar-row__pct">{Math.round(pct)}%</span>
    </div>
  );
}

// ── Help tooltip ("?" button) — keyboard and pointer accessible ──────────────
export function HelpTip({ text, label = 'More information' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="help__btn" aria-label={label} aria-describedby={open ? id : undefined} aria-expanded={open} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
        ?
      </button>
      {open && (
        <span role="tooltip" id={id} className="help__tip">
          {text}
        </span>
      )}
    </span>
  );
}

// ── Chips, badges, severity ───────────────────────────────────────────────────
export function GuidelineChip({ label, url }: { label: string; url: string | null }) {
  return url ? (
    <a className="chip" href={url} target="_blank" rel="noreferrer noopener">
      {label}
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  ) : (
    <span className="chip">{label}</span>
  );
}

const SEV_LABEL: Record<Severity, string> = { priority: 'Priority issue', other: 'Other issue', warning: 'Warning' };
export function SevDot({ severity }: { severity: Severity }) {
  return (
    <span className={`sev-dot sev-dot--${severity}`} role="img" aria-label={SEV_LABEL[severity]} title={SEV_LABEL[severity]} />
  );
}

export function StatusBadge({ status }: { status: ScanStatus | string }) {
  const map: Record<string, [string, string]> = {
    queued: ['badge--info', 'Queued'],
    running: ['badge--success badge--live', 'Running'],
    completed: ['badge--neutral', 'Completed'],
    stopped: ['badge--warning', 'Stopped'],
    failed: ['badge--danger', 'Failed'],
  };
  const [cls, label] = map[status] ?? ['badge--neutral', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────
export function Thumb({ src, alt = '', large = false }: { src: string | null; alt?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className={`thumb thumb--placeholder ${large ? 'thumb--lg' : ''}`} aria-hidden={alt ? undefined : true} role={alt ? 'img' : undefined} aria-label={alt || undefined}>
        <Globe size={large ? 34 : 20} />
      </span>
    );
  }
  return <img className={`thumb ${large ? 'thumb--lg' : ''}`} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

/** Site identity cell: thumbnail, host (link) and the full address, truncated cleanly. */
export function SiteCell({ url, to, thumbnail, children }: { url: string; to: string; thumbnail: string | null; children?: ReactNode }) {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep raw */
  }
  return (
    <div className="url-cell">
      <Thumb src={thumbnail} />
      <div style={{ minWidth: 0 }}>
        <NavLink to={to} className="url-cell__host" title={url}>
          {host}
        </NavLink>
        <span className="url-cell__path" title={url}>
          {url}
        </span>
        {children}
      </div>
    </div>
  );
}

// ── Modal (focus-trapped dialog) ──────────────────────────────────────────────
export function Modal({ title, onClose, children, footer, wide = false }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previously = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []);
    (focusables().find((f) => f.dataset.autofocus === 'true') ?? focusables()[1] ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previously?.focus();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Destructive confirmation that requires typing a word (Plan.md §5.5 typed confirmation). */
export function ConfirmModal({ title, message, confirmWord, confirmLabel, onConfirm, onClose, busy = false, error }: { title: string; message: ReactNode; confirmWord?: string; confirmLabel: string; onConfirm: (typed: string) => void; onClose: () => void; busy?: boolean; error?: string | null }) {
  const [typed, setTyped] = useState('');
  const ok = !confirmWord || typed.trim() === confirmWord;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" disabled={!ok || busy} onClick={() => onConfirm(typed.trim())}>
            {busy && <Loader2 size={16} className="spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{message}</div>
        {confirmWord && (
          <TextField label={`Type ${confirmWord} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-autofocus="true" error={error ?? undefined} />
        )}
        {!confirmWord && error && <p className="field__error">{error}</p>}
      </div>
    </Modal>
  );
}

// ── Form fields ───────────────────────────────────────────────────────────────
interface FieldShell { label: ReactNode; hint?: ReactNode; error?: string; labelHidden?: boolean }

export function TextField({ label, hint, error, labelHidden, className = '', ...rest }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'field__label'}>
        {label}
      </label>
      <input id={id} className={`input ${className}`} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
      {hint && !error && (
        <span id={`${id}-h`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-e`} className="field__error">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

export function TextArea({ label, hint, error, labelHidden, ...rest }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'field__label'}>
        {label}
      </label>
      <textarea id={id} className="textarea" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest} />
      {hint && !error && (
        <span id={`${id}-h`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-e`} className="field__error">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

export function SelectField({ label, hint, error, labelHidden, options, ...rest }: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'field__label'}>
        {label}
      </label>
      <select id={id} className="select" aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && !error && (
        <span id={`${id}-h`} className="field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-e`} className="field__error">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

export function Checkbox({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`check ${disabled ? 'check--disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="field__hint" style={{ display: 'block' }}>{hint}</span>}
      </span>
    </label>
  );
}

export function RadioGroup<T extends string>({ legend, name, value, options, onChange, disabled, cards = false, legendHidden = false }: { legend: string; name: string; value: T; options: { value: T; label: ReactNode; hint?: ReactNode }[]; onChange: (v: T) => void; disabled?: boolean; cards?: boolean; legendHidden?: boolean }) {
  return (
    <fieldset className="fieldset" disabled={disabled}>
      <legend className={legendHidden ? 'sr-only' : undefined}>{legend}</legend>
      <div className={cards ? 'radio-cards' : 'stack'} style={cards ? undefined : { gap: 10 }}>
        {options.map((o) => (
          <label key={o.value} className={cards ? 'radio-card' : `radio ${disabled ? 'radio--disabled' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>
              {o.label}
              {o.hint && <span className="field__hint" style={{ display: 'block' }}>{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Password input with show/hide eye button and optional strength meter. */
export function PasswordField({ label, error, hint, value, onChange, autoComplete = 'current-password', strength = false, large = false, name }: { label: string; error?: string; hint?: ReactNode; value: string; onChange: (v: string) => void; autoComplete?: string; strength?: boolean; large?: boolean; name?: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  const score = passwordScore(value);
  const colors = ['#c4321d', '#e0701c', '#c49a06', '#15803d'];
  const words = ['Too weak', 'Weak', 'Good', 'Strong'];
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="input-group">
        <input id={id} name={name} className={`input ${large ? 'input--lg' : ''}`} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-invalid={!!error} aria-describedby={`${id}-e ${id}-s`} />
        <button type="button" className="icon-btn input-group__btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {strength && value && (
        <div id={`${id}-s`} aria-live="polite">
          <div className="strength" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ background: i <= score ? colors[score] : undefined }} />
            ))}
          </div>
          <span className="field__hint">Strength: {words[score]}</span>
        </div>
      )}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span id={`${id}-e`} className="field__error">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

/** 0–3 strength, aligned with the server policy (16+ chars, or 8+ with mixed case and digit/punctuation). */
export function passwordScore(pw: string): number {
  if (pw.length >= 20) return 3;
  if (pw.length >= 16) return 2 + (/[^a-zA-Z]/.test(pw) ? 1 : 0);
  if (pw.length < 8) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((r) => r.test(pw)).length;
  return variety >= 4 ? 3 : variety === 3 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) ? 2 : 1;
}

// ── Tabs (router-aware) ───────────────────────────────────────────────────────
export function TabLinks({ tabs, label, pills = false }: { tabs: { to: string; label: ReactNode; end?: boolean; count?: number }[]; label: string; pills?: boolean }) {
  return (
    <nav aria-label={label} className={pills ? 'pills' : 'tabs'}>
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `${pills ? 'pill' : 'tab'} ${isActive ? 'is-active' : ''}`}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count.toLocaleString()}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

export function SegmentedButtons<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`pill ${value === o.value ? 'is-active' : ''}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Sortable header & pagination ──────────────────────────────────────────────
export function SortHeader<K extends string>({ label, sortKey, sort, dir, onSort, className }: { label: string; sortKey: K; sort: K; dir: 'asc' | 'desc'; onSort: (k: K) => void; className?: string }) {
  const active = sort === sortKey;
  return (
    <th scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={className}>
      <button type="button" className="sort-btn" onClick={() => onSort(sortKey)}>
        {label}
        {active ? dir === 'asc' ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : <ArrowUpDown size={13} aria-hidden="true" style={{ opacity: 0.45 }} />}
      </button>
    </th>
  );
}

export function Pagination({ page, perPage, total, onPage }: { page: number; perPage: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted small">
        {(page - 1) * perPage + 1}–{Math.min(total, page * perPage)} of {total.toLocaleString()}
      </span>
      <button type="button" className="btn btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span className="small" aria-current="page">
        Page {page} of {pages}
      </span>
      <button type="button" className="btn btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}

// ── Empty, loading, error ─────────────────────────────────────────────────────
export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={i === 0 ? 28 : 18} w={i === 0 ? '40%' : `${90 - i * 8}%`} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner--danger" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
      <div style={{ flex: 1 }}>{message}</div>
      {onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="row" style={{ gap: 8 }}>
      <Loader2 size={18} className="spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
