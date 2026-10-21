import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, Play, Settings2, Square, RotateCcw } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth, useToast } from '../lib/app';
import { fmtDuration, fmtTime } from '../lib/format';
import { Bar, RadioGroup, TextField } from './ui';
import { SCOPE_LABELS, type ScanScope } from '@shared/options';
import type { ScanProgress } from '@shared/types';

/** Normalise a typed address the way the server does (auto-https), for instant feedback. */
export function previewUrl(input: string): { url: string | null; error: string | null } {
  const s = input.trim();
  if (!s) return { url: null, error: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!['http:', 'https:'].includes(u.protocol)) return { url: null, error: 'Only http and https addresses can be scanned.' };
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return { url: null, error: 'Enter a full domain name, such as example.com' };
    return { url: u.toString(), error: null };
  } catch {
    return { url: null, error: 'That does not look like a web address.' };
  }
}

/** New Scan card body: 4 scope radios, URL with validation + auto-https, Scan button (Plan.md §5.3). */
export function NewScanForm({ compact = false, onStarted, clientId }: { compact?: boolean; onStarted?: (r: { siteId: number; scanId: number }) => void; clientId?: number | null }) {
  const [scope, setScope] = useState<ScanScope>('site');
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { push } = useToast();
  const { can } = useAuth();
  const navigate = useNavigate();
  const preview = previewUrl(url);
  const error = serverError ?? (touched ? preview.error : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!preview.url) return;
    setBusy(true);
    setServerError(null);
    try {
      const r = await api.post<{ siteId: number; scanId: number }>('/scans', { url: preview.url, scope, clientId: clientId ?? undefined });
      push({ kind: 'success', title: 'Scan started', body: preview.url, link: { to: `/sites/${r.siteId}`, label: 'Watch progress' } });
      setUrl('');
      setTouched(false);
      if (onStarted) onStarted(r);
      else navigate(`/sites/${r.siteId}`);
    } catch (err) {
      setServerError((err as ApiError).fieldError('url') ?? (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!can('scan.run')) return <p className="muted">Your role can view reports but not start scans.</p>;

  return (
    <form onSubmit={submit} className="stack" noValidate>
      <RadioGroup<ScanScope>
        legend="What to scan"
        name="scope"
        value={scope}
        onChange={setScope}
        cards
        options={(Object.keys(SCOPE_LABELS) as ScanScope[]).map((s) => ({ value: s, label: SCOPE_LABELS[s] }))}
      />
      <div className="newscan__form">
        <TextField
          label="Site address"
          placeholder="https://example.com"
          value={url}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          onChange={(e) => {
            setUrl(e.target.value);
            setServerError(null);
          }}
          onBlur={() => setTouched(true)}
          error={error ?? undefined}
          hint={preview.url && preview.url !== url.trim() ? `Will scan ${preview.url}` : compact ? undefined : 'We add https:// for you if you leave it out.'}
          className="input--lg"
        />
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
          {busy ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          Scan
        </button>
      </div>
      {!compact && (
        <div className="newscan__features">
          {['Broken links', 'Accessibility (WCAG 2.2, ADA, Section 508)', 'Browser compatibility', 'SEO and search guidelines', 'HTML and CSS standards', 'Usability'].map((f) => (
            <span key={f}>
              <CheckCircle2 size={15} aria-hidden="true" />
              {f}
            </span>
          ))}
        </div>
      )}
    </form>
  );
}

const PHASE_LABEL: Record<ScanProgress['phase'], string> = {
  queued: 'Waiting for a free scanner…',
  crawl: 'Analysing pages',
  links: 'Checking links and files',
  finishing: 'Building the report',
  done: '',
};

/** Live progress block: phase, progress bar, started badge, counts, current URL, ETA. */
export function LiveProgress({ p, showUrl = true }: { p: ScanProgress; showUrl?: boolean }) {
  const queued = p.status === 'queued';
  const showPageUrl = showUrl && p.phase === 'crawl' && p.currentUrl && /^https?:/.test(p.currentUrl);
  return (
    <div className="live" aria-live="polite">
      <div className="row" style={{ gap: 8 }}>
        <span className={`badge ${queued ? 'badge--info' : 'badge--success badge--live'}`}>{queued ? 'Queued' : `Started ${fmtTime(p.startedAt)}`}</span>
        {!queued && <strong className="small">{p.percent}%</strong>}
      </div>
      <Bar value={queued ? 0 : p.percent} tone="progress" label={`Scan progress: ${PHASE_LABEL[p.phase] || 'scanning'}`} />
      <div className="live__meta">
        <span className="live__phase">{PHASE_LABEL[p.phase]}</span>
        {p.phase === 'links' ? (
          <span>
            {p.linksDone.toLocaleString()} of {p.linksTotal.toLocaleString()} links · {p.pagesDone.toLocaleString()} pages done
          </span>
        ) : (
          !queued && (
            <span>
              {p.pagesFound.toLocaleString()} pages found, {p.pagesDone.toLocaleString()} done
            </span>
          )
        )}
        {p.etaSeconds !== null && <span>About {fmtDuration(p.etaSeconds)} remaining</span>}
      </div>
      {showPageUrl && (
        <span className="live__url" title={p.currentUrl ?? ''}>
          Analysing {p.currentUrl}
        </span>
      )}
    </div>
  );
}

export function StopScanButton({ scanId, onDone, small = false }: { scanId: number; onDone?: () => void; small?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const { can } = useAuth();
  if (!can('scan.run')) return null;
  return (
    <button
      type="button"
      className={`btn btn--danger ${small ? 'btn--sm' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/scans/${scanId}/stop`);
          push({ kind: 'info', title: 'Stopping scan', body: 'Pages already checked are kept in the report.' });
          onDone?.();
        } catch (e) {
          push({ kind: 'error', title: 'Could not stop the scan', body: (e as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Square size={14} aria-hidden="true" fill="currentColor" />}
      Stop Scan
    </button>
  );
}

export function ScanNowButton({ siteId, onDone, small = false, light = true }: { siteId: number; onDone?: (scanId: number) => void; small?: boolean; light?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  const { can } = useAuth();
  if (!can('scan.run')) return null;
  return (
    <button
      type="button"
      className={`btn ${light ? '' : 'btn--primary'} ${small ? 'btn--sm' : ''}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const r = await api.post<{ scanId: number }>(`/sites/${siteId}/scan`);
          push({ kind: 'success', title: 'Scan started' });
          onDone?.(r.scanId);
        } catch (e) {
          push({ kind: 'error', title: 'Could not start the scan', body: (e as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
      Scan Now
    </button>
  );
}

export function ResumeButton({ scanId, onDone }: { scanId: number; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const { push } = useToast();
  return (
    <button
      type="button"
      className="btn btn--sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/scans/${scanId}/resume`);
          push({ kind: 'success', title: 'Scan resumed' });
          onDone?.();
        } catch (e) {
          push({ kind: 'error', title: 'Could not resume', body: (e as Error).message });
        } finally {
          setBusy(false);
        }
      }}
    >
      <RotateCcw size={14} aria-hidden="true" />
      Resume
    </button>
  );
}

export function OptionsLink({ siteId, small = false, primary = true }: { siteId: number; small?: boolean; primary?: boolean }) {
  const { can } = useAuth();
  if (!can('scan.options')) return null;
  return (
    <Link to={`/sites/${siteId}/options`} className={`btn ${primary ? 'btn--primary' : ''} ${small ? 'btn--sm' : ''}`}>
      <Settings2 size={15} aria-hidden="true" />
      Options…
    </Link>
  );
}
