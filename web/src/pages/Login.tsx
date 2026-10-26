import { lazy, Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, CheckCircle2, Info, KeyRound, Loader2, Lock } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/app';
import { Checkbox, PasswordField, TextField } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';
import { PRODUCT_NAME } from '@shared/types';
import '../styles/auth.css';

// The stage (canvas + framer-motion) loads in its own chunk, so signed-in pages never pay for it.
const ScanStage = lazy(() => import('../components/ScanStage').then((m) => ({ default: m.ScanStage })));

const ECOMBACK = 'https://www.ecomback.com';

/**
 * Public layout (sign in, 2FA, forgot/reset password, OAuth consent): a dark stage showing a live scan
 * behind a glass card. `aside={false}` centres the card and dims the stage (consent, errors).
 */
export function AuthLayout({ heading, accent, intro, children, aside = true }: { heading: string; accent?: string; intro?: ReactNode; children: ReactNode; aside?: boolean }) {
  useEffect(() => {
    document.title = `${heading}${accent ? ` ${accent}` : ''} · ${PRODUCT_NAME}`;
  }, [heading, accent]);
  return (
    <div className={`auth ${aside ? '' : 'auth--single'}`}>
      <a href="#auth-main" className="skip-link">
        Skip to content
      </a>
      <Suspense fallback={null}>
        <ScanStage dim={!aside} />
      </Suspense>
      <header className="auth__top">
        <a href={ECOMBACK} className="auth__brand" aria-label="Ecomback website">
          <span className="auth__mark" aria-hidden="true">
            <img src="/ecomback-mark.svg" alt="" width={26} height={26} />
          </span>
          <span>
            <strong>SortSite Tools</strong>
            <small>by Ecomback</small>
          </span>
        </a>
        <div className="auth__top-right">
          <ThemeToggle />
          <a className="auth__top-link" href={`${ECOMBACK}/contact-us`}>
            <span>Contact Ecomback</span>
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </header>
      <main id="auth-main" className="auth__main">
        <div className="auth__card">
          <span className="auth__overline">SortSite Tools · site quality scanner</span>
          <h1 className="auth__title">
            {heading}
            {accent && <em>{accent}</em>}
          </h1>
          {intro && <p className="auth__intro">{intro}</p>}
          {children}
        </div>
      </main>
      <footer className="auth__foot">
        <nav aria-label="Legal">
          <a href={`${ECOMBACK}/privacy-policy`}>Privacy Policy</a>
          <a href={`${ECOMBACK}/accessibility`}>Accessibility</a>
          <a href={`${ECOMBACK}/website-content-disclaimer`}>Content Disclaimer</a>
          <span>© {new Date().getFullYear()} Ecomback · v{__APP_VERSION__}</span>
        </nav>
      </footer>
    </div>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [stage, setStage] = useState<'login' | '2fa'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) navigate(from, { replace: true });
  }, [me, from, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError(new ApiError(400, !email.trim() ? 'Enter your email address to sign in.' : 'Enter your password to sign in.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ stage: 'done' | '2fa' }>('/auth/login', { email, password, remember });
      if (r.stage === '2fa') setStage('2fa');
      else if (await refresh()) navigate(from, { replace: true });
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const submit2fa = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login/2fa', { code, mode: recovery ? 'recovery' : 'totp' });
      if (await refresh()) navigate(from, { replace: true });
    } catch (err) {
      const ae = err as ApiError;
      if (ae.status === 401 && /expired/i.test(ae.message)) setStage('login');
      setError(ae);
    } finally {
      setBusy(false);
    }
  };

  const locked = error?.status === 423;

  if (stage === '2fa') {
    return (
      <AuthLayout heading="One more step." accent="Verify it’s you." intro={recovery ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works once.' : 'Open your authenticator app and enter the 6-digit code for SortSite Tools by Ecomback.'}>
        <form onSubmit={submit2fa} className="stack" style={{ gap: 20 }} noValidate>
          {error && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error.message}</div>
            </div>
          )}
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="auth__icon" aria-hidden="true">
              <KeyRound size={22} />
            </span>
            <div style={{ flex: 1 }}>
              <TextField
                label={recovery ? 'Recovery code' : 'Authentication code'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode={recovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={recovery ? 'xxxxx-xxxxx' : '123 456'}
                className="input--lg"
                autoFocus
                maxLength={recovery ? 11 : 7}
              />
            </div>
          </div>
          <button type="submit" className="btn btn--primary btn--lg btn--block auth__submit" disabled={busy || !code}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            Verify and sign in
          </button>
          <div className="auth__row">
            <button type="button" className="linklike" onClick={() => { setRecovery((r) => !r); setCode(''); setError(null); }}>
              {recovery ? 'Use authenticator app instead' : 'Use a recovery code'}
            </button>
            <button type="button" className="btn" onClick={() => { void api.post('/auth/logout'); setStage('login'); setCode(''); setError(null); }}>
              Back to sign in
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout heading="Welcome back." accent="See what the scan found." intro="Your sites, scan history, reports and schedules — exactly where you left them.">
      <form onSubmit={submit} className="stack" style={{ gap: 20 }} noValidate>
        {error && (
          <div className={`banner ${locked ? 'banner--warning' : 'banner--danger'}`} role="alert">
            {locked ? <Lock size={18} aria-hidden="true" /> : <AlertCircle size={18} aria-hidden="true" />}
            <div>
              {error.message}
              {locked && (
                <>
                  {' '}
                  <Link to="/forgot-password">Reset your password</Link>
                </>
              )}
            </div>
          </div>
        )}
        <TextField label="Email address" type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="input--lg" autoFocus />
        <PasswordField label="Password" name="password" value={password} onChange={setPassword} large />
        <div className="auth__row">
          <Checkbox label="Remember me for 30 days" checked={remember} onChange={setRemember} />
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className="btn btn--primary btn--lg btn--block auth__submit" disabled={busy}>
          {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
          Sign in
        </button>
        <div className="auth__divider">Need an account?</div>
        <p className="auth__note">
          Accounts are set up by the Ecomback team. Email <a href="mailto:billing@ecomback.com">billing@ecomback.com</a> or call <a href="tel:+18188398888">1-818-839-8888</a> and we will create yours.
        </p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter the email address you sign in with.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/forgot', { email });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout heading="Forgot it?" accent="Happens to everyone." intro={sent ? undefined : "Enter the email address you sign in with and we'll send you a link to choose a new password."}>
      {sent ? (
        <div className="stack" style={{ gap: 20 }} role="status">
          <div className="banner banner--success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>
              If an account exists for <strong>{email}</strong>, we've sent a link to reset the password. It works for one hour.
            </div>
          </div>
          <p className="muted small">
            <Info size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Running locally without SMTP? An administrator can open the email from <em>Help › Email Outbox</em>.
          </p>
          <Link to="/login" className="btn btn--lg btn--block">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 20 }} noValidate>
          {error && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}
          <TextField label="Email address" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="input--lg" autoFocus required />
          <button type="submit" className="btn btn--primary btn--lg btn--block auth__submit" disabled={busy}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            Send reset link
          </button>
          <div className="auth__row">
            <Link to="/login">Back to sign in</Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const invite = params.get('invite') === '1';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    if (!password) {
      setError(new ApiError(400, 'Enter a new password.', [{ path: 'password', message: 'Enter a new password.' }]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      heading={invite ? 'You’re in.' : 'New password.'}
      accent={invite ? 'Choose a password to begin.' : 'Make it a good one.'}
      intro={done || !token ? undefined : 'Use a passphrase of 16+ characters, or 8+ characters with upper and lower case letters plus a digit or punctuation.'}
    >
      {done ? (
        <div className="stack" style={{ gap: 20 }} role="status">
          <div className="banner banner--success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>Your password is set. You can sign in now.</div>
          </div>
          <Link to="/login" className="btn btn--primary btn--lg btn--block auth__submit">
            Go to sign in
          </Link>
        </div>
      ) : !token ? (
        <div className="stack" style={{ gap: 20 }}>
          <div className="banner banner--danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>This link is incomplete. Open the link from your email again, or request a new one.</div>
          </div>
          <Link to="/forgot-password" className="btn btn--lg btn--block">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: 20 }} noValidate>
          {error && !error.fieldError('password') && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error.message}</div>
            </div>
          )}
          <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" strength large error={error?.fieldError('password')} />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" large error={mismatch ? 'The passwords do not match.' : undefined} />
          <button type="submit" className="btn btn--primary btn--lg btn--block auth__submit" disabled={busy || mismatch}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            {invite ? 'Activate account' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
