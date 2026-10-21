import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApi, useAuth, usePage, useToast } from '../../lib/app';
import { fmtDate, fmtRelative } from '../../lib/format';
import { Checkbox, ConfirmModal, Empty, ErrorBanner, LoadingBlock, Modal, SelectField, TextField } from '../../components/ui';
import { ConnectedAppsCard } from './ConnectedApps';
import { CopyButton } from './shared';
import type { DateFormat, Me } from '@shared/types';

interface SettingsData { timezone: string; dateFormat: DateFormat; sidebarTheme: 'dark' | 'light'; name: string; email: string; timezones: string[] }
interface Alerts { onComplete: boolean; onFailed: boolean; risePoints: number; quotaPct: number; emailAlerts: boolean }
interface Token { id: number; name: string; prefix: string; lastUsedAt: string | null; createdAt: string }

const FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'dd-mmm-yyyy', label: 'dd-mmm-yyyy' },
  { value: 'mm/dd/yyyy', label: 'mm/dd/yyyy' },
  { value: 'dd/mm/yyyy', label: 'dd/mm/yyyy' },
  { value: 'yyyy-mm-dd', label: 'yyyy-mm-dd' },
];

/** Example date rendered in a given format (independent of the global formatter). */
function example(fmt: DateFormat, tz: string): string {
  const now = new Date();
  let p: Intl.DateTimeFormatPart[];
  try {
    p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  } catch {
    return '';
  }
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(g('month')) - 1];
  const date = fmt === 'mm/dd/yyyy' ? `${g('month')}/${g('day')}/${g('year')}` : fmt === 'dd/mm/yyyy' ? `${g('day')}/${g('month')}/${g('year')}` : fmt === 'yyyy-mm-dd' ? `${g('year')}-${g('month')}-${g('day')}` : `${g('day')}-${mon}-${g('year')}`;
  return `${date} ${g('hour')}:${g('minute')}`;
}

export function SettingsPage() {
  usePage('Settings');
  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <PreferencesCard />
      <AlertsCard />
      <ConnectedAppsCard />
      <TokensCard />
    </div>
  );
}

function PreferencesCard() {
  const { setMe } = useAuth();
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<SettingsData>('/account/settings');
  const [form, setForm] = useState<Omit<SettingsData, 'timezones' | 'email'> | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setForm({ timezone: data.timezone, dateFormat: data.dateFormat, sidebarTheme: data.sidebarTheme, name: data.name });
  }, [data]);

  const tzSet = useMemo(() => new Set(data?.timezones ?? []), [data]);
  if (loading && !data) return <div className="card card__body"><LoadingBlock /></div>;
  if (error || !data || !form) return <ErrorBanner message={error ?? 'Could not load settings.'} onRetry={() => void reload()} />;

  const tzInvalid = !tzSet.has(form.timezone);
  const dirty = form.timezone !== data.timezone || form.dateFormat !== data.dateFormat || form.sidebarTheme !== data.sidebarTheme || form.name !== data.name;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tzInvalid) return;
    setBusy(true);
    setSaveError(null);
    try {
      const r = await api.put<{ me: Me }>('/account/settings', form);
      setMe(r.me);
      push({ kind: 'success', title: 'Settings saved' });
      void reload(true);
    } catch (err) {
      setSaveError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} aria-labelledby="prefs-title" noValidate>
      <div className="card__head">
        <h2 id="prefs-title">Preferences</h2>
        <span className="small muted">{data.email}</span>
      </div>
      <div className="card__body stack">
        {saveError && !saveError.fields.length && <ErrorBanner message={saveError.message} />}
        <div className="form-grid">
          <TextField label="Display name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} autoComplete="name" />
          <div>
            <TextField
              label="Timezone"
              list="tz-list"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              hint="Type to search, e.g. “Karachi” or “New_York”. Schedules and dates use this timezone."
              error={tzInvalid ? 'Choose a timezone from the list.' : saveError?.fieldError('timezone')}
              autoComplete="off"
              spellCheck={false}
            />
            <datalist id="tz-list">
              {data.timezones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <SelectField
            label="Date/time format"
            value={form.dateFormat}
            onChange={(e) => setForm({ ...form, dateFormat: e.target.value as DateFormat })}
            options={FORMATS}
            hint={tzInvalid ? undefined : `Example: ${example(form.dateFormat, form.timezone)}`}
          />
          {/* The sidebar theme setting was replaced by the light/dark toggle in the top bar (sidebar is always the brand gradient). */}
        </div>
      </div>
      <div className="card__foot">
        <span>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <div className="form-actions">
          <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setForm({ timezone: data.timezone, dateFormat: data.dateFormat, sidebarTheme: data.sidebarTheme, name: data.name })}>
            Cancel
          </button>
          <button type="submit" className="btn btn--success" disabled={!dirty || busy || tzInvalid}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

function AlertsCard() {
  const { can } = useAuth();
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<Alerts>('/account/alerts');
  const [form, setForm] = useState<Alerts | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('users.manage');
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (loading && !data) return <div className="card card__body"><LoadingBlock rows={3} /></div>;
  if (error || !form || !data) return <ErrorBanner message={error ?? 'Could not load alert settings.'} onRetry={() => void reload()} />;
  const dirty = JSON.stringify(form) !== JSON.stringify(data);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      await api.put('/account/alerts', form);
      push({ kind: 'success', title: 'Alert preferences saved' });
      void reload(true);
    } catch (err) {
      setSaveError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} aria-labelledby="alerts-title" noValidate>
      <div className="card__head">
        <h2 id="alerts-title">Alerts</h2>
        {!editable && <span className="badge badge--neutral">Read-only — administrators can change these</span>}
      </div>
      <fieldset className="fieldset card__body stack" disabled={!editable}>
        <legend className="sr-only">Alert preferences</legend>
        {saveError && !saveError.fields.length && <ErrorBanner message={saveError.message} />}
        <p className="muted small">Alerts appear in the notification bell for everyone on the account.</p>
        <Checkbox label="A scan completed" checked={form.onComplete} onChange={(v) => setForm({ ...form, onComplete: v })} />
        <Checkbox label="A scan failed or a scheduled scan was skipped" checked={form.onFailed} onChange={(v) => setForm({ ...form, onFailed: v })} />
        <div className="form-grid">
          <TextField label="Issue rise threshold (points)" type="number" min={1} max={100} value={String(form.risePoints)} onChange={(e) => setForm({ ...form, risePoints: Number(e.target.value) })} hint="Alert when the share of pages with issues rises by more than this many points between scans." error={saveError?.fieldError('risePoints')} />
          <TextField label="Disk quota warning (%)" type="number" min={10} max={100} value={String(form.quotaPct)} onChange={(e) => setForm({ ...form, quotaPct: Number(e.target.value) })} hint="Alert when disk use reaches this percentage of the plan quota." error={saveError?.fieldError('quotaPct')} />
        </div>
        <Checkbox label="Also email failed-scan and issue-rise alerts to administrators" checked={form.emailAlerts} onChange={(v) => setForm({ ...form, emailAlerts: v })} />
      </fieldset>
      {editable && (
        <div className="card__foot">
          <span>{dirty ? 'You have unsaved changes.' : ''}</span>
          <div className="form-actions">
            <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setForm(data)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--success" disabled={!dirty || busy}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              Save
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function TokensCard() {
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<Token[]>('/account/tokens');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setCreateError(null);
    try {
      const r = await api.post<{ token: string }>('/account/tokens', { name });
      setCreated(r.token);
      setName('');
      void reload(true);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(`/account/tokens/${revoking.id}`);
      push({ kind: 'success', title: `Revoked “${revoking.name}”` });
      setRevoking(null);
      void reload(true);
    } catch (err) {
      push({ kind: 'error', title: 'Could not revoke token', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="tokens-title">
      <div className="card__head">
        <h2 id="tokens-title">Personal API tokens</h2>
        <button type="button" className="btn btn--sm" onClick={() => { setCreating(true); setCreated(null); setCreateError(null); }}>
          <Plus size={14} aria-hidden="true" />
          New token
        </button>
      </div>
      <div className="card__body stack">
        <p className="muted small">Tokens let scripts use the REST API (/api/v1) as you, with your role's permissions. Treat them like passwords.</p>
        <div className="secret-box">
          <code>curl -H "Authorization: Bearer &lt;token&gt;" {origin}/api/v1/sites</code>
          <CopyButton text={`curl -H "Authorization: Bearer <token>" ${origin}/api/v1/sites`} label="Copy example" />
        </div>
        {loading && !data ? (
          <LoadingBlock rows={2} />
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => void reload()} />
        ) : !data?.length ? (
          <Empty icon={<KeyRound size={32} aria-hidden="true" />} title="No tokens yet">Create one to call the API from scripts or CI.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Your API tokens</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Token</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Created</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td><code>{t.prefix}…</code></td>
                    <td>{t.lastUsedAt ? fmtRelative(t.lastUsedAt) : <span className="muted">Never</span>}</td>
                    <td>{fmtDate(t.createdAt)}</td>
                    <td className="num">
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setRevoking(t)} aria-label={`Revoke ${t.name}`}>
                        <Trash2 size={14} aria-hidden="true" />
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <Modal
          title={created ? 'Copy your new token' : 'New API token'}
          onClose={() => setCreating(false)}
          footer={
            created ? (
              <button type="button" className="btn btn--primary" onClick={() => setCreating(false)}>
                Done
              </button>
            ) : (
              <>
                <button type="button" className="btn" onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button type="submit" form="token-form" className="btn btn--success" disabled={busy || !name.trim()}>
                  {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                  Create token
                </button>
              </>
            )
          }
        >
          {created ? (
            <div className="stack" role="status">
              <div className="banner banner--warning">This is the only time the token is shown. Copy it now and store it somewhere safe.</div>
              <div className="secret-box">
                <code>{created}</code>
                <CopyButton text={created} label="Copy token" />
              </div>
            </div>
          ) : (
            <form id="token-form" onSubmit={create} className="stack" noValidate>
              <TextField label="Token name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. CI pipeline" hint="So you can recognise it later." error={createError ?? undefined} data-autofocus="true" />
            </form>
          )}
        </Modal>
      )}
      {revoking && <ConfirmModal title={`Revoke “${revoking.name}”?`} message={<p>Scripts using this token stop working immediately.</p>} confirmLabel="Revoke token" busy={busy} onConfirm={() => void revoke()} onClose={() => setRevoking(null)} />}
    </section>
  );
}
