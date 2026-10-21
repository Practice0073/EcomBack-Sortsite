import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, Ban, CalendarClock, FileBarChart, Link2, ListChecks, Loader2, Save, Server } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth, usePage, useToast } from '../lib/app';
import { hostOf } from '../lib/format';
import { Checkbox, ConfirmModal, ErrorBanner, LoadingBlock, PasswordField, RadioGroup, SelectField, TextArea, TextField } from '../components/ui';
import {
  BROWSER_LABELS,
  CATEGORIES,
  CATEGORY_LABELS,
  READING_AGE_LABELS,
  SCOPE_LABELS,
  SPELL_LANGUAGE_LABELS,
  type AuthMode,
  type BrowserId,
  type Category,
  type Compatibility,
  type DomMode,
  type ReadingAge,
  type ScanOptions,
  type ScanScope,
  type ScheduleFrequency,
  type SearchEngine,
  type SpellLanguage,
  type WcagLevel,
  type WcagVersion,
} from '@shared/options';
import '../styles/workspace.css';

type Section = 'rules' | 'blocks' | 'reports' | 'links' | 'crawler' | 'schedule';
const SECTIONS: { id: Section; label: string; icon: typeof ListChecks }[] = [
  { id: 'rules', label: 'Rules', icon: ListChecks },
  { id: 'blocks', label: 'Blocks', icon: Ban },
  { id: 'reports', label: 'Reports', icon: FileBarChart },
  { id: 'links', label: 'Links', icon: Link2 },
  { id: 'crawler', label: 'Crawler', icon: Server },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
];

interface OptionsResponse { url: string; scope: ScanScope; options: ScanOptions }
type Errors = Record<string, string>;

/** Section (and rules sub-tab) a server error path belongs to, e.g. 'rules.errors.pageWeightLimitKb'. */
function locate(path: string): { section: Section; category?: Category } {
  const [head, second] = path.split('.');
  if (head === 'rules' && second && (CATEGORIES as readonly string[]).includes(second)) return { section: 'rules', category: second as Category };
  if (head && SECTIONS.some((s) => s.id === head)) return { section: head as Section };
  return { section: 'rules' };
}

export function EditScanPage() {
  const { id } = useParams();
  const siteId = Number(id);
  const navigate = useNavigate();
  const { me } = useAuth();
  const { push } = useToast();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<ScanScope>('site');
  const [o, setO] = useState<ScanOptions | null>(null);
  const [original, setOriginal] = useState('');
  const [section, setSection] = useState<Section>('rules');
  const [category, setCategory] = useState<Category>('accessibility');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  usePage(url ? `Options · ${hostOf(url)}` : 'Edit Scan');

  const load = useCallback(async () => {
    try {
      const r = await api.get<OptionsResponse>(`/sites/${siteId}/options`);
      setUrl(r.url);
      setScope(r.scope);
      setO(r.options);
      setOriginal(JSON.stringify({ url: r.url, scope: r.scope, options: r.options }));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !!o && JSON.stringify({ url, scope, options: o }) !== original;

  // Unsaved-changes guard: browser close/reload, and in-app link clicks outside the form.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a || a.closest('[data-editor]') || (a as HTMLAnchorElement).target === '_blank') return;
      if (!window.confirm('You have unsaved changes to these scan options. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  /** Immutable nested update. */
  const upd = (fn: (draft: ScanOptions) => void) =>
    setO((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
  const err = (path: string) => errors[path];

  const save = async () => {
    if (!o) return;
    setSaving(true);
    setFormError(null);
    try {
      const r = await api.put<{ ok: boolean; siteId: number; moved?: boolean }>(`/sites/${siteId}/options`, { url, scope, options: o });
      setErrors({});
      setOriginal(JSON.stringify({ url, scope, options: o }));
      push({ kind: 'success', title: 'Scan options saved', body: 'The next scan uses these settings.' });
      if (r.moved) navigate(`/sites/${r.siteId}`, { replace: true });
    } catch (e) {
      const ae = e as ApiError;
      const map: Errors = {};
      for (const f of ae.fields ?? []) map[f.path] = f.message;
      setErrors(map);
      setFormError(ae.message);
      const first = ae.fields?.[0];
      if (first) {
        const loc = locate(first.path);
        setSection(loc.section);
        if (loc.category) setCategory(loc.category);
      }
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty) setConfirmLeave(true);
    else navigate(`/sites/${siteId}`);
  };

  const sectionErrors = useMemo(() => {
    const s = new Set<Section>();
    for (const p of Object.keys(errors)) s.add(locate(p).section);
    return s;
  }, [errors]);

  if (loadError) return <ErrorBanner message={loadError} onRetry={() => void load()} />;
  if (!o) return <LoadingBlock rows={8} />;

  return (
    <div className="stack-lg" data-editor>
      <section className="card" aria-label="Start page">
        <div className="card__body editor__group" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(200px, 1fr)' }}>
          <TextField label="Start page" type="url" value={url} onChange={(e) => setUrl(e.target.value)} error={err('url')} hint="Changing the address creates a separate site entry with these options." spellCheck={false} />
          <SelectField label="Scope" value={scope} onChange={(e) => setScope(e.target.value as ScanScope)} options={(Object.keys(SCOPE_LABELS) as ScanScope[]).map((s) => ({ value: s, label: SCOPE_LABELS[s] }))} />
        </div>
      </section>

      {formError && (
        <div className="banner banner--danger" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <div>{formError}</div>
        </div>
      )}

      <div className="editor">
        <RailTabs section={section} onChange={setSection} errors={sectionErrors} />
        <div className="editor__panel card" id={`panel-${section}`} role="tabpanel" aria-labelledby={`tab-${section}`} tabIndex={0}>
          <div className="card__body">
            {section === 'rules' && <RulesSection o={o} upd={upd} err={err} category={category} setCategory={setCategory} errors={errors} />}
            {section === 'blocks' && <BlocksSection o={o} upd={upd} err={err} />}
            {section === 'reports' && <ReportsSection o={o} upd={upd} err={err} />}
            {section === 'links' && <LinksSection o={o} upd={upd} err={err} />}
            {section === 'crawler' && <CrawlerSection o={o} upd={upd} err={err} />}
            {section === 'schedule' && <ScheduleSection o={o} upd={upd} err={err} timezone={me?.timezone ?? 'UTC'} />}
          </div>
        </div>
      </div>

      <div className="editor__foot" role="region" aria-label="Save options">
        <button type="button" className="btn btn--success" onClick={() => void save()} disabled={saving || !dirty} title={dirty ? undefined : 'No changes to save'}>
          {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          Save
        </button>
        <button type="button" className="btn" onClick={cancel}>
          Cancel
        </button>
        {dirty && (
          <span className="editor__dirty" role="status">
            Unsaved changes
          </span>
        )}
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="Discard unsaved changes?"
          message={<p>Your changes to these scan options have not been saved.</p>}
          confirmLabel="Discard changes"
          onConfirm={() => {
            setOriginal(JSON.stringify({ url, scope, options: o }));
            setConfirmLeave(false);
            navigate(`/sites/${siteId}`);
          }}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}

// ── Vertical tablist (arrow keys move between sections) ───────────────────────
function RailTabs({ section, onChange, errors }: { section: Section; onChange: (s: Section) => void; errors: Set<Section> }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SECTIONS.findIndex((s) => s.id === section);
    let next = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % SECTIONS.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + SECTIONS.length) % SECTIONS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = SECTIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(SECTIONS[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div className="editor__rail" role="tablist" aria-orientation="vertical" aria-label="Option sections" onKeyDown={onKey}>
      {SECTIONS.map((s, i) => (
        <button
          key={s.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${s.id}`}
          aria-selected={section === s.id}
          aria-controls={`panel-${s.id}`}
          tabIndex={section === s.id ? 0 : -1}
          className="rail-tab"
          onClick={() => onChange(s.id)}
        >
          <s.icon size={18} aria-hidden="true" />
          {s.label}
          {errors.has(s.id) && (
            <>
              <span className="rail-tab__err" aria-hidden="true" />
              <span className="sr-only"> (has errors)</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}

interface SectionProps { o: ScanOptions; upd: (fn: (d: ScanOptions) => void) => void; err: (path: string) => string | undefined }

function NumberInline({ label, value, onChange, disabled, error, min, max, suffix }: { label: string; value: number | null; onChange: (v: number) => void; disabled?: boolean; error?: string; min?: number; max?: number; suffix?: string }) {
  const id = useId();
  return (
    <span className="inline-num">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} className="input" type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : undefined} onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))} />
      {suffix && <span className="small">{suffix}</span>}
      {error && (
        <span id={`${id}-e`} className="field__error" style={{ flexBasis: '100%' }}>
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </span>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="field__error" role="alert">
      <AlertCircle size={14} aria-hidden="true" />
      {message}
    </p>
  );
}

// ── Rules ─────────────────────────────────────────────────────────────────────
function RulesSection({ o, upd, err, category, setCategory, errors }: SectionProps & { category: Category; setCategory: (c: Category) => void; errors: Errors }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = CATEGORIES.indexOf(category);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % CATEGORIES.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + CATEGORIES.length) % CATEGORIES.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = CATEGORIES.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setCategory(CATEGORIES[next]!);
    refs.current[next]?.focus();
  };
  const enabled = o.rules[category].enabled;
  return (
    <div className="editor__section">
      <div>
        <h2>Rules</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Choose which checks run. Turn a group off to skip it entirely and keep reports focused.
        </p>
      </div>
      <div className="subtabs" role="tablist" aria-label="Rule groups" onKeyDown={onKey}>
        {CATEGORIES.map((c, i) => {
          const hasErr = Object.keys(errors).some((p) => p.startsWith(`rules.${c}.`));
          return (
            <button
              key={c}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`rtab-${c}`}
              aria-selected={category === c}
              aria-controls={`rpanel-${c}`}
              tabIndex={category === c ? 0 : -1}
              className="subtab"
              onClick={() => setCategory(c)}
            >
              <span className={`subtab__state ${o.rules[c].enabled ? 'subtab__state--on' : ''}`} aria-hidden="true" />
              {CATEGORY_LABELS[c]}
              <span className="sr-only">{o.rules[c].enabled ? ' (on)' : ' (off)'}</span>
              {hasErr && <span className="sr-only"> (has errors)</span>}
              {hasErr && <AlertCircle size={14} color="var(--danger)" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`rpanel-${category}`} aria-labelledby={`rtab-${category}`} className="stack">
        <div className="editor__toggle">
          <Checkbox label={<strong>Check {CATEGORY_LABELS[category].toLowerCase()}</strong>} checked={enabled} onChange={(v) => upd((d) => void (d.rules[category].enabled = v))} />
          <span className={`badge ${enabled ? 'badge--success' : 'badge--neutral'}`}>{enabled ? 'On' : 'Off'}</span>
        </div>
        <div className="editor__sub" aria-disabled={!enabled}>
          {category === 'accessibility' && <AccessibilityRules o={o} upd={upd} err={err} disabled={!enabled} />}
          {category === 'compatibility' && <CompatibilityRules o={o} upd={upd} err={err} disabled={!enabled} />}
          {category === 'errors' && <ErrorRules o={o} upd={upd} err={err} disabled={!enabled} />}
          {category === 'search' && <SearchRules o={o} upd={upd} err={err} disabled={!enabled} />}
          {category === 'standards' && <StandardsRules o={o} upd={upd} err={err} disabled={!enabled} />}
          {category === 'usability' && <UsabilityRules o={o} upd={upd} disabled={!enabled} />}
        </div>
      </div>
    </div>
  );
}

type RuleProps = SectionProps & { disabled: boolean };

function AccessibilityRules({ o, upd, err, disabled }: RuleProps) {
  const a = o.rules.accessibility;
  return (
    <div className="stack">
      <div className="editor__group">
        <SelectField label="WCAG version" disabled={disabled} value={a.wcagVersion} error={err('rules.accessibility.wcagVersion')} onChange={(e) => upd((d) => void (d.rules.accessibility.wcagVersion = e.target.value as WcagVersion))} options={['2.0', '2.1', '2.2'].map((v) => ({ value: v, label: `WCAG ${v}` }))} />
        <SelectField label="Conformance level" disabled={disabled} value={a.wcagLevel} error={err('rules.accessibility.wcagLevel')} hint="Level AA is what the ADA, Section 508 and EN 301 549 expect." onChange={(e) => upd((d) => void (d.rules.accessibility.wcagLevel = e.target.value as WcagLevel))} options={['A', 'AA', 'AAA'].map((v) => ({ value: v, label: `Level ${v}` }))} />
      </div>
      <div className="editor__checks">
        <Checkbox disabled={disabled} label="ARIA (WAI-ARIA 1.3)" checked={a.aria} onChange={(v) => upd((d) => void (d.rules.accessibility.aria = v))} />
        <Checkbox disabled={disabled} label="US standards (Section 508)" checked={a.usStandards} onChange={(v) => upd((d) => void (d.rules.accessibility.usStandards = v))} />
        <Checkbox disabled={disabled} label="EU standards (EN 301 549)" checked={a.euStandards} onChange={(v) => upd((d) => void (d.rules.accessibility.euStandards = v))} />
        <Checkbox disabled={disabled} label="PDF standards (PDF/UA-1)" checked={a.pdfStandards} onChange={(v) => upd((d) => void (d.rules.accessibility.pdfStandards = v))} />
        <Checkbox disabled={disabled} label="Screen reader support (JAWS, NVDA, VoiceOver)" checked={a.screenReaders} onChange={(v) => upd((d) => void (d.rules.accessibility.screenReaders = v))} />
      </div>
      <SelectField label="Reading age" disabled={disabled} value={a.readingAge} error={err('rules.accessibility.readingAge')} onChange={(e) => upd((d) => void (d.rules.accessibility.readingAge = e.target.value as ReadingAge))} options={(Object.keys(READING_AGE_LABELS) as ReadingAge[]).map((r) => ({ value: r, label: READING_AGE_LABELS[r] }))} />
    </div>
  );
}

function CompatibilityRules({ o, upd, err, disabled }: RuleProps) {
  const browsers = o.rules.compatibility.browsers;
  const toggle = (b: BrowserId, on: boolean) => upd((d) => void (d.rules.compatibility.browsers = on ? [...new Set([...d.rules.compatibility.browsers, b])] : d.rules.compatibility.browsers.filter((x) => x !== b)));
  return (
    <fieldset className="fieldset" disabled={disabled}>
      <legend>Browsers to check (latest versions)</legend>
      <div className="editor__checks">
        {(Object.keys(BROWSER_LABELS) as BrowserId[]).map((b) => (
          <Checkbox key={b} disabled={disabled} label={BROWSER_LABELS[b]} checked={browsers.includes(b)} onChange={(v) => toggle(b, v)} />
        ))}
      </div>
      <FieldError message={err('rules.compatibility.browsers')} />
      <p className="note" style={{ marginTop: 12 }}>Support data comes from MDN browser-compat-data and is refreshed with each browser release.</p>
    </fieldset>
  );
}

function ErrorRules({ o, upd, err, disabled }: RuleProps) {
  const e = o.rules.errors;
  const [kb, setKb] = useState<number>(e.pageWeightLimitKb ?? 1500);
  return (
    <div className="stack">
      <div className="editor__group">
        <div className="stack" style={{ gap: 10 }}>
          <Checkbox disabled={disabled} label="Spell check" checked={e.spellCheck} onChange={(v) => upd((d) => void (d.rules.errors.spellCheck = v))} />
          <Checkbox disabled={disabled || !e.spellCheck} label="Ignore capitalized words" hint="Skips names, brands and words at the start of sentences." checked={e.ignoreCapitalized} onChange={(v) => upd((d) => void (d.rules.errors.ignoreCapitalized = v))} />
        </div>
        <SelectField label="Spell-check language" disabled={disabled || !e.spellCheck} value={e.spellLanguage} error={err('rules.errors.spellLanguage')} onChange={(ev) => upd((d) => void (d.rules.errors.spellLanguage = ev.target.value as SpellLanguage))} options={(Object.keys(SPELL_LANGUAGE_LABELS) as SpellLanguage[]).map((l) => ({ value: l, label: SPELL_LANGUAGE_LABELS[l] }))} />
      </div>
      <div className="editor__group">
        <TextArea disabled={disabled} label="Forbidden text" hint="One phrase per line. Pages containing any of them are reported." value={e.forbiddenText} error={err('rules.errors.forbiddenText')} onChange={(ev) => upd((d) => void (d.rules.errors.forbiddenText = ev.target.value))} rows={4} />
        <TextArea disabled={disabled} label="Required text" hint="One phrase per line. Pages missing any of them are reported." value={e.requiredText} error={err('rules.errors.requiredText')} onChange={(ev) => upd((d) => void (d.rules.errors.requiredText = ev.target.value))} rows={4} />
      </div>
      <fieldset className="fieldset" disabled={disabled}>
        <legend>Page weight</legend>
        <div className="stack" style={{ gap: 10 }}>
          <label className="radio">
            <input type="radio" name="pageweight" checked={e.pageWeightLimitKb === null} onChange={() => upd((d) => void (d.rules.errors.pageWeightLimitKb = null))} />
            <span>Don't check</span>
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label className="radio">
              <input type="radio" name="pageweight" checked={e.pageWeightLimitKb !== null} onChange={() => upd((d) => void (d.rules.errors.pageWeightLimitKb = Number.isFinite(kb) ? kb : 1500))} />
              <span>Report pages larger than</span>
            </label>
            <NumberInline
              label="Page weight limit in kilobytes"
              value={e.pageWeightLimitKb ?? kb}
              min={10}
              max={100000}
              suffix="kilobytes"
              disabled={disabled || e.pageWeightLimitKb === null}
              error={err('rules.errors.pageWeightLimitKb')}
              onChange={(v) => {
                setKb(v);
                upd((d) => void (d.rules.errors.pageWeightLimitKb = v));
              }}
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

function SearchRules({ o, upd, err, disabled }: RuleProps) {
  const s = o.rules.search;
  const toggle = (eng: SearchEngine, on: boolean) => upd((d) => void (d.rules.search.engines = on ? [...new Set([...d.rules.search.engines, eng])] : d.rules.search.engines.filter((x) => x !== eng)));
  return (
    <div className="stack">
      <fieldset className="fieldset" disabled={disabled}>
        <legend>Guidelines</legend>
        <div className="editor__checks">
          <Checkbox disabled={disabled} label="Google" checked={s.engines.includes('google')} onChange={(v) => toggle('google', v)} />
          <Checkbox disabled={disabled} label="DuckDuckGo" checked={s.engines.includes('duckduckgo')} onChange={(v) => toggle('duckduckgo', v)} />
          <Checkbox disabled={disabled} label="Bing" checked={s.engines.includes('bing')} onChange={(v) => toggle('bing', v)} />
          <Checkbox disabled={disabled} label="robots.txt guidelines" checked={s.robotsGuidelines} onChange={(v) => upd((d) => void (d.rules.search.robotsGuidelines = v))} />
          <Checkbox disabled={disabled} label="Best practices" checked={s.bestPractices} onChange={(v) => upd((d) => void (d.rules.search.bestPractices = v))} />
        </div>
        <FieldError message={err('rules.search.engines')} />
      </fieldset>
      <TextArea disabled={disabled} label="Optimize these keywords" hint="One keyword or phrase per line (or comma-separated). Pages are checked for them in the title, main heading and meta description." value={s.keywords} error={err('rules.search.keywords')} onChange={(ev) => upd((d) => void (d.rules.search.keywords = ev.target.value))} rows={4} />
    </div>
  );
}

function StandardsRules({ o, upd, err, disabled }: RuleProps) {
  const s = o.rules.standards;
  return (
    <div className="stack">
      <div className="editor__checks">
        <Checkbox disabled={disabled} label="Validate CSS" checked={s.validateCss} onChange={(v) => upd((d) => void (d.rules.standards.validateCss = v))} />
        <Checkbox disabled={disabled} label="Validate HTML" checked={s.validateHtml} onChange={(v) => upd((d) => void (d.rules.standards.validateHtml = v))} />
        <Checkbox disabled={disabled} label="Check for obsolete features" checked={s.obsoleteFeatures} onChange={(v) => upd((d) => void (d.rules.standards.obsoleteFeatures = v))} />
      </div>
      <RadioGroup<'modern' | 'legacy'>
        legend="Legacy DOCTYPEs (HTML 4, XHTML)"
        name="doctype"
        disabled={disabled}
        value={s.legacyDoctype}
        onChange={(v) => upd((d) => void (d.rules.standards.legacyDoctype = v))}
        options={[
          { value: 'legacy', label: 'Use the legacy validator for pages with old DOCTYPEs', hint: 'Old pages are reported with one DOCTYPE warning instead of many HTML5 errors.' },
          { value: 'modern', label: 'Validate every page as modern HTML5' },
        ]}
      />
      <FieldError message={err('rules.standards.legacyDoctype')} />
    </div>
  );
}

function UsabilityRules({ o, upd, disabled }: Omit<RuleProps, 'err'>) {
  const u = o.rules.usability;
  return (
    <div className="editor__checks">
      <Checkbox disabled={disabled} label="Best practices" hint="New-window links, small text, sideways scrolling on phones, layout shift and more." checked={u.bestPractices} onChange={(v) => upd((d) => void (d.rules.usability.bestPractices = v))} />
      <Checkbox disabled={disabled} label="Readability" hint="Reading ease and long sentences." checked={u.readability} onChange={(v) => upd((d) => void (d.rules.usability.readability = v))} />
    </div>
  );
}

// ── Blocks ────────────────────────────────────────────────────────────────────
function BlocksSection({ o, upd, err }: SectionProps) {
  return (
    <div className="editor__section">
      <div>
        <h2>Blocks</h2>
        <p className="muted small" style={{ marginTop: 4 }}>Links matching these patterns are not requested at all.</p>
      </div>
      <TextArea label="Blocked links" value={o.blocks.patterns} error={err('blocks.patterns')} onChange={(e) => upd((d) => void (d.blocks.patterns = e.target.value))} rows={8} placeholder={'*.pdf\nhttps://example.com/one-page\n/forbidden/*'} hint="One pattern per line. Use * as a wildcard." />
      <div className="note">
        Examples: <code>*.pdf</code> blocks every PDF; <code>https://example.com/basket</code> blocks one exact address; <code>/forbidden/*</code> blocks everything in a folder.
      </div>
      <Checkbox label="Obey robots.txt" hint="Links your robots.txt disallows (for our scanner or for Googlebot) are skipped and listed under Diagnostics." checked={o.blocks.obeyRobots} onChange={(v) => upd((d) => void (d.blocks.obeyRobots = v))} />
      <p className="note">You can also exclude the scanner in robots.txt with <code>User-agent: SortSiteTools</code> followed by <code>Disallow:</code> rules.</p>
    </div>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────
function ReportsSection({ o, upd, err }: SectionProps) {
  return (
    <div className="editor__section">
      <h2>Reports</h2>
      <RadioGroup<DomMode>
        legend="JavaScript DOM changes"
        name="dommode"
        value={o.reports.domMode}
        onChange={(v) => upd((d) => void (d.reports.domMode = v))}
        options={[
          { value: 'none', label: 'None', hint: 'Check the HTML exactly as the server sends it. Fastest; misses content added by scripts.' },
          { value: 'smart', label: 'Smart', hint: 'Run scripts and check the page once it has settled. A good balance for most sites.' },
          { value: 'all', label: 'All', hint: 'Run scripts, wait for the network to go quiet and scroll to load lazy content. Most thorough (recommended for Shopify).' },
        ]}
      />
      <FieldError message={err('reports.domMode')} />
      <RadioGroup<Compatibility>
        legend="Results compatibility"
        name="compatibility"
        value={o.reports.compatibility}
        onChange={(v) => upd((d) => void (d.reports.compatibility = v))}
        options={[
          { value: 'powermapper', label: 'Match PowerMapper', hint: 'Count pages and choose rules the way PowerMapper/SortSite does: product-recommendation links (?pr_prod_strat=…) count as separate pages, and list-structure and touch-target checks are skipped.' },
          { value: 'standard', label: 'Standard', hint: 'Treat recommendation links as one page and run every check, including list structure and WCAG 2.2 touch-target size.' },
        ]}
      />
      <FieldError message={err('reports.compatibility')} />
      <div className="editor__group">
        <TextField label="Maximum pages shown per issue" type="number" min={1} max={5000} value={Number.isFinite(o.reports.maxPagesPerIssue) ? o.reports.maxPagesPerIssue : ''} error={err('reports.maxPagesPerIssue')} hint="Default 140." onChange={(e) => upd((d) => void (d.reports.maxPagesPerIssue = e.target.value === '' ? Number.NaN : Number(e.target.value)))} />
        <TextField label="Maximum line numbers shown per issue" type="number" min={1} max={100} value={Number.isFinite(o.reports.maxLinesPerIssue) ? o.reports.maxLinesPerIssue : ''} error={err('reports.maxLinesPerIssue')} hint="Default 5." onChange={(e) => upd((d) => void (d.reports.maxLinesPerIssue = e.target.value === '' ? Number.NaN : Number(e.target.value)))} />
      </div>
      <div className="banner banner--warning">
        <AlertCircle size={18} aria-hidden="true" />
        <div>Large values make reports and Word/PDF exports much bigger and slower to open. Raise them only when you need every occurrence listed.</div>
      </div>
    </div>
  );
}

// ── Links ─────────────────────────────────────────────────────────────────────
function LinksSection({ o, upd, err }: SectionProps) {
  const l = o.links;
  return (
    <div className="editor__section">
      <h2>Links</h2>
      <Checkbox label="Follow links to related domains" hint="For example shop.example.com and blog.example.com when scanning example.com." checked={l.followRelatedDomains} onChange={(v) => upd((d) => void (d.links.followRelatedDomains = v))} />
      <TextArea label="Additional domains to scan" hint="One domain per line. Their pages are crawled as part of this site." value={l.additionalDomains} error={err('links.additionalDomains')} onChange={(e) => upd((d) => void (d.links.additionalDomains = e.target.value))} rows={3} placeholder="help.example.com" />
      <fieldset className="fieldset">
        <legend>Link depth</legend>
        <div className="stack" style={{ gap: 10 }}>
          <label className="radio">
            <input type="radio" name="depth" checked={l.depthMode === 'entire'} onChange={() => upd((d) => void (d.links.depthMode = 'entire'))} />
            <span>Explore the entire site</span>
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label className="radio">
              <input type="radio" name="depth" checked={l.depthMode === 'limited'} onChange={() => upd((d) => void (d.links.depthMode = 'limited'))} />
              <span>Only pages</span>
            </label>
            <NumberInline label="Maximum clicks from the start page" value={l.maxDepth} min={1} max={50} disabled={l.depthMode !== 'limited'} error={err('links.maxDepth')} suffix="clicks from the start page" onChange={(v) => upd((d) => void (d.links.maxDepth = v))} />
          </div>
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>External links</legend>
        <div className="stack" style={{ gap: 10 }}>
          <label className="radio">
            <input type="radio" name="external" checked={l.externalMode === 'all'} onChange={() => upd((d) => void (d.links.externalMode = 'all'))} />
            <span>Check all external links</span>
          </label>
          <div className="row" style={{ gap: 10 }}>
            <label className="radio">
              <input type="radio" name="external" checked={l.externalMode === 'first'} onChange={() => upd((d) => void (d.links.externalMode = 'first'))} />
              <span>Check the first</span>
            </label>
            <NumberInline label="External links checked per site" value={l.externalFirstN} min={1} max={1000} disabled={l.externalMode !== 'first'} error={err('links.externalFirstN')} suffix="links per external site" onChange={(v) => upd((d) => void (d.links.externalFirstN = v))} />
          </div>
        </div>
      </fieldset>
    </div>
  );
}

// ── Crawler ───────────────────────────────────────────────────────────────────
const AUTH_LABELS: Record<AuthMode, string> = { none: 'None', basic: 'HTTP Basic authentication', headers: 'Custom request headers', 'shopify-web-bot-auth': 'Shopify Web Bot Auth', cookies: 'Cookies' };

function CrawlerSection({ o, upd, err }: SectionProps) {
  const c = o.crawler;
  return (
    <div className="editor__section">
      <h2>Crawler</h2>
      <SelectField label="Request authorisation" value={c.authMode} error={err('crawler.authMode')} onChange={(e) => upd((d) => void (d.crawler.authMode = e.target.value as AuthMode))} options={(Object.keys(AUTH_LABELS) as AuthMode[]).map((m) => ({ value: m, label: AUTH_LABELS[m] }))} hint="Credentials are encrypted at rest and only sent to this site's own domains." />
      {c.authMode === 'basic' && (
        <div className="editor__group">
          <TextField label="Username" value={c.basicUser} autoComplete="off" error={err('crawler.basicUser')} onChange={(e) => upd((d) => void (d.crawler.basicUser = e.target.value))} />
          <PasswordField label="Password" value={c.basicPassword} autoComplete="new-password" error={err('crawler.basicPassword')} onChange={(v) => upd((d) => void (d.crawler.basicPassword = v))} />
        </div>
      )}
      {(c.authMode === 'headers' || c.authMode === 'shopify-web-bot-auth') && (
        <TextArea
          label={c.authMode === 'headers' ? 'Request headers' : 'Shopify Web Bot Auth headers'}
          value={c.headers}
          error={err('crawler.headers')}
          rows={5}
          spellCheck={false}
          onChange={(e) => upd((d) => void (d.crawler.headers = e.target.value))}
          placeholder={c.authMode === 'headers' ? 'X-Api-Key: abc123' : 'Signature-Input: …\nSignature: …\nSignature-Agent: …'}
          hint={
            c.authMode === 'headers'
              ? 'One "Name: value" per line.'
              : 'Paste the Signature-Input, Signature and Signature-Agent headers generated in Shopify admin › Online Store › Preferences › Crawler access. One "Name: value" per line.'
          }
        />
      )}
      {c.authMode === 'cookies' && <TextArea label="Cookies" value={c.cookies} error={err('crawler.cookies')} rows={4} spellCheck={false} onChange={(e) => upd((d) => void (d.crawler.cookies = e.target.value))} placeholder="session=abc123" hint='One "name=value" per line.' />}
      <div className="editor__sub stack">
        <h3>Shopify</h3>
        <Checkbox label="Use the Shopify preset when a Shopify store is detected" hint="Adds cart and collection coverage, skips infinite filter and variant URLs, and validates theme CSS but not app assets." checked={c.shopifyPreset} onChange={(v) => upd((d) => void (d.crawler.shopifyPreset = v))} />
        <PasswordField label="Storefront password (password-protected stores)" value={c.shopifyStorefrontPassword} autoComplete="new-password" error={err('crawler.shopifyStorefrontPassword')} hint="From Shopify admin › Online Store › Preferences › Password protection." onChange={(v) => upd((d) => void (d.crawler.shopifyStorefrontPassword = v))} />
      </div>
      <div className="editor__group">
        <SelectField
          label="Server load throttle"
          value={c.throttle}
          error={err('crawler.throttle')}
          onChange={(e) => upd((d) => void (d.crawler.throttle = e.target.value as ScanOptions['crawler']['throttle']))}
          options={[
            { value: 'auto', label: 'Auto (slows down if the server pushes back)' },
            { value: 'slow', label: 'Slow (1 request at a time)' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
          ]}
        />
        <TextField label="Page timeout (ms)" type="number" min={5000} max={600000} step={1000} value={Number.isFinite(c.pageTimeoutMs) ? c.pageTimeoutMs : ''} error={err('crawler.pageTimeoutMs')} hint="Default 180000 (3 minutes)." onChange={(e) => upd((d) => void (d.crawler.pageTimeoutMs = e.target.value === '' ? Number.NaN : Number(e.target.value)))} />
        <TextField label="Maximum pages per scan" type="number" min={1} max={500} value={Number.isFinite(c.maxPages) ? c.maxPages : ''} error={err('crawler.maxPages')} hint="Your plan allows up to 500 pages per scan." onChange={(e) => upd((d) => void (d.crawler.maxPages = e.target.value === '' ? Number.NaN : Number(e.target.value)))} />
        <TextField label="Retries for failed requests" type="number" min={0} max={5} value={Number.isFinite(c.retries) ? c.retries : ''} error={err('crawler.retries')} onChange={(e) => upd((d) => void (d.crawler.retries = e.target.value === '' ? Number.NaN : Number(e.target.value)))} />
      </div>
    </div>
  );
}

// ── Schedule ──────────────────────────────────────────────────────────────────
function ScheduleSection({ o, upd, err, timezone }: SectionProps & { timezone: string }) {
  const s = o.schedule;
  const off = s.frequency === 'none';
  return (
    <div className="editor__section">
      <h2>Schedule</h2>
      <div className="editor__group">
        <SelectField
          label="When to scan"
          value={s.frequency}
          error={err('schedule.frequency')}
          onChange={(e) => upd((d) => void (d.schedule.frequency = e.target.value as ScheduleFrequency))}
          options={[
            { value: 'none', label: 'Not scheduled' },
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
        />
        <div />
        <TextField label="Start date" type="date" disabled={off} value={s.startDate} error={err('schedule.startDate')} hint="Leave empty to start from today." onChange={(e) => upd((d) => void (d.schedule.startDate = e.target.value))} />
        <TextField label="Time" type="time" disabled={off} value={s.time} error={err('schedule.time')} hint={`Your timezone: ${timezone} (change it in Account › Settings).`} onChange={(e) => upd((d) => void (d.schedule.time = e.target.value))} />
      </div>
      <p className="note">Scheduled scans check up to 500 pages and count towards your plan's scan quotas.</p>
      <SelectField
        label="Email report to"
        value={s.emailTo}
        error={err('schedule.emailTo')}
        onChange={(e) => upd((d) => void (d.schedule.emailTo = e.target.value as ScanOptions['schedule']['emailTo']))}
        options={[
          { value: 'nobody', label: 'Nobody' },
          { value: 'me', label: 'Me (account administrator)' },
          { value: 'all-users', label: 'All account users' },
          { value: 'custom', label: 'Custom addresses' },
        ]}
        hint="Scheduled scans send an Ecomback-branded summary with the executive PDF attached."
      />
      {s.emailTo === 'custom' && <TextArea label="Email addresses" value={s.customEmails} error={err('schedule.customEmails')} rows={3} onChange={(e) => upd((d) => void (d.schedule.customEmails = e.target.value))} placeholder="client@example.com" hint="Separate addresses with commas or new lines." />}
    </div>
  );
}

