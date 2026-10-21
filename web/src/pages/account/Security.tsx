import { useState, type FormEvent } from 'react';
import { CheckCircle2, Download, Loader2, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApi, usePage, useToast } from '../../lib/app';
import { fmtDateTime, fmtRelative } from '../../lib/format';
import { Checkbox, ConfirmModal, ErrorBanner, LoadingBlock, Modal, PasswordField, TextField } from '../../components/ui';
import { CopyButton, describeAgent, downloadText } from './shared';

interface TwoFactorStatus { enabled: boolean; recoveryCodesLeft: number }
interface Session { ip: string | null; userAgent: string; createdAt: string; lastSeenAt: string; current: boolean }

const POLICY = 'Use a passphrase of 16+ characters, or 8+ characters with upper and lower case letters plus a digit or punctuation.';

export function SecurityPage() {
  usePage('Security');
  return (
    <div className="stack-lg" style={{ maxWidth: 980 }}>
      <PasswordCard />
      <TwoFactorCard />
      <SessionsCard />
    </div>
  );
}

function PasswordCard() {
  const { push } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== next;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/account/password', { current, password: next, confirm });
      push({ kind: 'success', title: 'Password changed', body: 'Other sessions were signed out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit} aria-labelledby="pw-title" noValidate>
      <div className="card__head">
        <h2 id="pw-title">Change Password</h2>
      </div>
      <div className="card__body stack">
        <p className="muted small">{POLICY}</p>
        {error && !error.fields.length && <ErrorBanner message={error.message} />}
        <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" error={error?.fieldError('current')} />
        <div className="form-grid">
          <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" strength error={error?.fieldError('password')} />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" error={mismatch ? 'The passwords do not match.' : error?.fieldError('confirm')} />
        </div>
      </div>
      <div className="card__foot">
        <span>Changing your password signs out your other sessions.</span>
        <div className="form-actions">
          <button type="button" className="btn" disabled={busy || (!current && !next && !confirm)} onClick={() => { setCurrent(''); setNext(''); setConfirm(''); setError(null); }}>
            Cancel
          </button>
          <button type="submit" className="btn btn--success" disabled={busy || !current || !next || !confirm || mismatch}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `SortSite Tools by Ecomback — recovery codes\nEach code can be used once.\n\n${codes.join('\n')}\n`;
  return (
    <div className="stack" role="status">
      <div className="banner banner--warning">Save these recovery codes now. Each one signs you in once if you lose your phone. They will not be shown again.</div>
      <ul className="codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row">
        <CopyButton text={codes.join('\n')} label="Copy codes" />
        <button type="button" className="btn btn--sm" onClick={() => downloadText('sortsite-recovery-codes.txt', text)}>
          <Download size={14} aria-hidden="true" />
          Download .txt
        </button>
      </div>
      <Checkbox label="I've saved these recovery codes somewhere safe" checked={saved} onChange={setSaved} />
      <div className="form-actions">
        <button type="button" className="btn btn--primary" disabled={!saved} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function TwoFactorCard() {
  const { push } = useToast();
  const status = useApi<TwoFactorStatus>('/account/2fa/status');
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pwAction, setPwAction] = useState<'disable' | 'regenerate' | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ secret: string; qrSvg: string }>('/account/2fa/setup');
      setSetup(r);
      setCode('');
    } catch (err) {
      push({ kind: 'error', title: 'Could not start set-up', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>('/account/2fa/enable', { code });
      setCodes(r.recoveryCodes);
      void status.reload(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  const confirmPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pwAction) return;
    setBusy(true);
    setError(null);
    try {
      if (pwAction === 'disable') {
        await api.post('/account/2fa/disable', { password });
        push({ kind: 'success', title: 'Two-factor authentication turned off' });
        setPwAction(null);
      } else {
        const r = await api.post<{ recoveryCodes: string[] }>('/account/2fa/recovery-codes', { password });
        setPwAction(null);
        setCodes(r.recoveryCodes);
      }
      setPassword('');
      void status.reload(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data;
  return (
    <section className="card" aria-labelledby="tfa-title">
      <div className="card__head">
        <h2 id="tfa-title">Two-Factor Authentication</h2>
      </div>
      <div className="card__body stack">
        {status.loading && !s ? (
          <LoadingBlock rows={2} />
        ) : status.error || !s ? (
          <ErrorBanner message={status.error ?? 'Could not load status.'} onRetry={() => void status.reload()} />
        ) : s.enabled ? (
          <>
            <div className="banner banner--success" role="status">
              <ShieldCheck size={18} aria-hidden="true" />
              <div>
                <strong>Two-factor authentication is on.</strong> You have {s.recoveryCodesLeft} recovery code{s.recoveryCodesLeft === 1 ? '' : 's'} left.
                {s.recoveryCodesLeft <= 3 && ' Generate new ones soon.'}
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => { setError(null); setPassword(''); setPwAction('regenerate'); }}>
                Regenerate recovery codes
              </button>
              <button type="button" className="btn btn--danger" onClick={() => { setError(null); setPassword(''); setPwAction('disable'); }}>
                Turn off
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="banner banner--warning" role="status">
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>Two-factor authentication is off.</strong> Add a second step at sign-in with an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.
              </div>
            </div>
            <div>
              <button type="button" className="btn btn--primary" onClick={() => void startSetup()} disabled={busy}>
                {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                Set up two-factor authentication
              </button>
            </div>
          </>
        )}
      </div>

      {setup && (
        <Modal title={codes ? 'Save your recovery codes' : 'Set up two-factor authentication'} onClose={() => { setSetup(null); setCodes(null); }} wide={!codes}>
          {codes ? (
            <RecoveryCodes codes={codes} onDone={() => { setSetup(null); setCodes(null); push({ kind: 'success', title: 'Two-factor authentication is on' }); }} />
          ) : (
            <form onSubmit={enable} className="stack" noValidate>
              <ol className="stack" style={{ paddingLeft: 20, margin: 0, gap: 12 }}>
                <li>Open your authenticator app and scan this QR code.</li>
                <li>Can't scan? Enter the key manually (time-based, 6 digits).</li>
                <li>Type the 6-digit code the app shows.</li>
              </ol>
              <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
                <img className="qr" src={svgDataUrl(setup.qrSvg)} alt="QR code for adding SortSite Tools by Ecomback to an authenticator app. Use the setup key if you cannot scan it." width={200} height={200} />
                <div className="stack" style={{ flex: '1 1 260px' }}>
                  <div className="field">
                    <span className="field__label">Setup key</span>
                    <div className="secret-box">
                      <code>{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                      <CopyButton text={setup.secret} label="Copy key" />
                    </div>
                  </div>
                  <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={error?.fieldError('code') ?? (error && !error.fields.length ? error.message : undefined)} data-autofocus="true" />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setSetup(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn--success" disabled={busy || code.replace(/\s/g, '').length !== 6}>
                  {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                  Verify and turn on
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {!setup && codes && (
        <Modal title="Your new recovery codes" onClose={() => setCodes(null)}>
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        </Modal>
      )}

      {pwAction && (
        <Modal
          title={pwAction === 'disable' ? 'Turn off two-factor authentication?' : 'Regenerate recovery codes?'}
          onClose={() => setPwAction(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPwAction(null)}>
                Cancel
              </button>
              <button type="submit" form="tfa-pw" className={`btn ${pwAction === 'disable' ? 'btn--danger' : 'btn--primary'}`} disabled={busy || !password}>
                {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
                {pwAction === 'disable' ? 'Turn off' : 'Generate new codes'}
              </button>
            </>
          }
        >
          <form id="tfa-pw" onSubmit={confirmPassword} className="stack" noValidate>
            <p>{pwAction === 'disable' ? 'Your account will be protected by your password only.' : 'Your old recovery codes stop working immediately.'} Confirm with your password.</p>
            <PasswordField label="Password" value={password} onChange={setPassword} error={error?.fieldError('password') ?? (error && !error.fields.length ? error.message : undefined)} />
          </form>
        </Modal>
      )}
    </section>
  );
}

function SessionsCard() {
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<Session[]>('/account/sessions');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const others = (data ?? []).filter((s) => !s.current).length;

  const revoke = async () => {
    setBusy(true);
    try {
      await api.post('/account/sessions/revoke-others');
      push({ kind: 'success', title: 'Signed out other sessions' });
      setConfirm(false);
      void reload(true);
    } catch (err) {
      push({ kind: 'error', title: 'Could not sign out other sessions', body: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card--flush" aria-labelledby="sess-title">
      <div className="card__head">
        <h2 id="sess-title">Active sessions</h2>
        <button type="button" className="btn btn--sm" disabled={!others} onClick={() => setConfirm(true)}>
          <LogOut size={14} aria-hidden="true" />
          Sign out other sessions
        </button>
      </div>
      {loading && !data ? (
        <div className="card__body"><LoadingBlock rows={2} /></div>
      ) : error ? (
        <div className="card__body"><ErrorBanner message={error} onRetry={() => void reload()} /></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Devices signed in to your account</caption>
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">IP address</th>
                <th scope="col">Signed in</th>
                <th scope="col">Last active</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((s, i) => (
                <tr key={`${s.createdAt}-${i}`}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      {describeAgent(s.userAgent)}
                      {s.current && (
                        <span className="badge badge--success">
                          <CheckCircle2 size={12} aria-hidden="true" />
                          This device
                        </span>
                      )}
                    </span>
                  </td>
                  <td><code>{s.ip ?? '—'}</code></td>
                  <td>{fmtDateTime(s.createdAt)}</td>
                  <td>{fmtRelative(s.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && <ConfirmModal title="Sign out other sessions?" message={<p>All devices except this one will need to sign in again.</p>} confirmLabel="Sign out others" busy={busy} onConfirm={() => void revoke()} onClose={() => setConfirm(false)} />}
    </section>
  );
}
