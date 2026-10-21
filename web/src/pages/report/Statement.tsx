import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileCode2, Info } from 'lucide-react';
import { useApi, useToast } from '../../lib/app';
import { fmtDate, hostOf } from '../../lib/format';
import { ErrorBanner, LoadingBlock, SelectField, TextArea, TextField } from '../../components/ui';
import { downloadText, useReport, type StatementData } from './context';

interface Draft {
  org: string;
  email: string;
  phone: string;
  standard: string;
  reviewDate: string;
  limitations: string;
  responseTime: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function loadDraft(key: string): Partial<Draft> {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

/** Builds the statement following the W3C WAI model structure. Never claims full conformance from automated data. */
function buildStatement(d: Draft, data: StatementData) {
  const site = hostOf(data.siteUrl);
  const org = d.org.trim() || site;
  const full = data.score === 100 && data.knownLimitations.length === 0;
  const status = full
    ? `Automated testing found no failures against ${d.standard}. Because automated tools cannot test every criterion, ${org} considers the site to be aiming for full conformance, pending manual review.`
    : `${site} is partially conformant with ${d.standard}. Partially conformant means that some parts of the content do not fully conform to the accessibility standard.`;
  const limits = d.limitations
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
  const review = d.reviewDate ? fmtDate(d.reviewDate) : fmtDate(data.scanDate);
  const sections = {
    title: `Accessibility statement for ${org}`,
    commitment: `${org} is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone and applying the relevant accessibility standards.`,
    standard: `The Web Content Accessibility Guidelines (WCAG) define requirements for designers and developers to improve accessibility for people with disabilities. We aim to meet ${d.standard}.`,
    status,
    limitations: limits,
    feedback: `We welcome your feedback on the accessibility of ${site}. Please let us know if you encounter accessibility barriers:`,
    contacts: [d.email.trim() ? `E-mail: ${d.email.trim()}` : '', d.phone.trim() ? `Phone: ${d.phone.trim()}` : ''].filter(Boolean),
    response: `We try to respond to feedback within ${d.responseTime}.`,
    assessment: `${org} assessed the accessibility of ${site} by self-evaluation, using automated testing with SortSite Tools by Ecomback (${data.pagesChecked.toLocaleString()} pages checked on ${fmtDate(data.scanDate)}). Automated testing cannot detect every accessibility problem, so we also review the site manually with keyboard and screen readers.`,
    date: `This statement was created on ${fmtDate(new Date().toISOString())} and last reviewed on ${review}.`,
  };

  const html = `<section lang="en" class="accessibility-statement">
  <h1>${esc(sections.title)}</h1>
  <p>${esc(sections.commitment)}</p>
  <h2>Conformance status</h2>
  <p>${esc(sections.standard)}</p>
  <p>${esc(sections.status)}</p>
${limits.length ? `  <h2>Known limitations</h2>\n  <p>Despite our efforts, some content may not yet be fully accessible. These are the known issues we are working to fix:</p>\n  <ul>\n${limits.map((l) => `    <li>${esc(l)}</li>`).join('\n')}\n  </ul>\n` : ''}  <h2>Feedback</h2>
  <p>${esc(sections.feedback)}</p>
  <ul>
${sections.contacts.map((c) => `    <li>${esc(c)}</li>`).join('\n') || '    <li>(add a contact method)</li>'}
  </ul>
  <p>${esc(sections.response)}</p>
  <h2>Assessment approach</h2>
  <p>${esc(sections.assessment)}</p>
  <h2>Date</h2>
  <p>${esc(sections.date)}</p>
</section>`;

  const md = [
    `# ${sections.title}`,
    '',
    sections.commitment,
    '',
    '## Conformance status',
    '',
    sections.standard,
    '',
    sections.status,
    ...(limits.length ? ['', '## Known limitations', '', 'Despite our efforts, some content may not yet be fully accessible. These are the known issues we are working to fix:', '', ...limits.map((l) => `- ${l}`)] : []),
    '',
    '## Feedback',
    '',
    sections.feedback,
    '',
    ...(sections.contacts.length ? sections.contacts.map((c) => `- ${c}`) : ['- (add a contact method)']),
    '',
    sections.response,
    '',
    '## Assessment approach',
    '',
    sections.assessment,
    '',
    '## Date',
    '',
    sections.date,
    '',
  ].join('\n');

  return { sections, html, md, full };
}

export function Statement() {
  const { scanId, summary } = useReport();
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<StatementData>(`/scans/${scanId}/report/statement`);
  const storageKey = `sst-statement-site-${summary.site.id}`;
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!data || draft) return;
    const saved = loadDraft(storageKey);
    setDraft({
      org: saved.org ?? summary.site.clientName ?? '',
      email: saved.email ?? '',
      phone: saved.phone ?? '',
      standard: saved.standard ?? data.standard,
      reviewDate: saved.reviewDate ?? (data.scanDate ? data.scanDate.slice(0, 10) : ''),
      limitations: saved.limitations ?? data.knownLimitations.map((l) => `${l.title}${l.guidelines.length ? ` (${l.guidelines.join(', ')})` : ''}`).join('\n'),
      responseTime: saved.responseTime ?? '5 business days',
    });
  }, [data, draft, storageKey, summary.site.clientName]);

  useEffect(() => {
    if (!draft) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* storage unavailable (private mode) — the draft simply isn't remembered */
    }
  }, [draft, storageKey]);

  const built = useMemo(() => (draft && data ? buildStatement(draft, data) : null), [draft, data]);

  if (error) return <ErrorBanner message={error} onRetry={() => void reload()} />;
  if (loading || !data || !draft || !built) return <LoadingBlock rows={8} />;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const host = hostOf(data.siteUrl);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(built.html);
      push({ kind: 'success', title: 'Statement HTML copied' });
    } catch {
      push({ kind: 'error', title: 'Copy failed', body: 'Your browser blocked clipboard access. Use Download .html instead.' });
    }
  };

  return (
    <div className="statement-grid">
      <section className="card" aria-labelledby="st-form">
        <div className="card__head">
          <h2 id="st-form">Statement details</h2>
        </div>
        <div className="card__body stack">
          <p className="small muted row" style={{ gap: 6, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <Info size={15} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
            Follows the W3C WAI model statement. Known limitations are prefilled from this scan's priority accessibility issues. Your draft is saved in this browser.
          </p>
          <TextField label="Organisation name" value={draft.org} onChange={(e) => set('org', e.target.value)} placeholder={host} />
          <TextField label="Contact email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder={`accessibility@${host.replace(/^www\./, '')}`} />
          <TextField label="Phone (optional)" type="tel" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
          <SelectField
            label="Conformance target"
            value={draft.standard}
            onChange={(e) => set('standard', e.target.value)}
            options={[...new Set([data.standard, 'WCAG 2.2 Level AA', 'WCAG 2.1 Level AA', 'WCAG 2.0 Level AA'])].map((s) => ({ value: s, label: s }))}
          />
          <TextField label="Date of last review" type="date" value={draft.reviewDate} onChange={(e) => set('reviewDate', e.target.value)} />
          <TextArea label="Known limitations" hint="One per line. Describe each barrier in plain language and, if you can, when it will be fixed." value={draft.limitations} onChange={(e) => set('limitations', e.target.value)} rows={7} />
          <TextField label="Feedback response time" value={draft.responseTime} onChange={(e) => set('responseTime', e.target.value)} />
          <div className="row">
            <button type="button" className="btn btn--primary" onClick={copy}>
              <Copy size={15} aria-hidden="true" /> Copy HTML
            </button>
            <button type="button" className="btn" onClick={() => downloadText(`accessibility-statement-${host}.html`, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(built.sections.title)}</title></head><body>\n${built.html}\n</body></html>\n`, 'text/html')}>
              <FileCode2 size={15} aria-hidden="true" /> Download .html
            </button>
            <button type="button" className="btn" onClick={() => downloadText(`accessibility-statement-${host}.md`, built.md, 'text/markdown')}>
              <Download size={15} aria-hidden="true" /> Download .md
            </button>
          </div>
        </div>
      </section>

      <section className="card" aria-labelledby="st-preview">
        <div className="card__head">
          <h2 id="st-preview">Preview</h2>
          <span className={`badge ${built.full ? 'badge--success' : 'badge--warning'}`}>{built.full ? 'No automated failures' : 'Partially conformant'}</span>
        </div>
        <article className="card__body statement-preview" aria-label="Statement preview">
          <h3 className="statement-preview__h1">{built.sections.title}</h3>
          <p>{built.sections.commitment}</p>
          <h4>Conformance status</h4>
          <p>{built.sections.standard}</p>
          <p>{built.sections.status}</p>
          {built.sections.limitations.length > 0 && (
            <>
              <h4>Known limitations</h4>
              <p>Despite our efforts, some content may not yet be fully accessible. These are the known issues we are working to fix:</p>
              <ul>
                {built.sections.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </>
          )}
          <h4>Feedback</h4>
          <p>{built.sections.feedback}</p>
          <ul>
            {built.sections.contacts.length ? built.sections.contacts.map((c) => <li key={c}>{c}</li>) : <li className="muted">(add a contact method)</li>}
          </ul>
          <p>{built.sections.response}</p>
          <h4>Assessment approach</h4>
          <p>{built.sections.assessment}</p>
          <h4>Date</h4>
          <p>{built.sections.date}</p>
        </article>
      </section>
    </div>
  );
}
