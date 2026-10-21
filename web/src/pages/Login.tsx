import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CircleHelp, FileText, Info, KeyRound, Loader2, Lock, ShieldCheck, Accessibility, Sparkles, ArrowRight } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/app';
import { Checkbox, PasswordField, TextField } from '../components/ui';
import { PRODUCT_NAME } from '@shared/types';

const ECOMBACK = 'https://www.ecomback.com';

/** Public layout matching the reference sign-in screen: white header, content + help card, dark footer. */
export function AuthLayout({ heading, children, aside = true }: { heading: string; children: ReactNode; aside?: boolean }) {
  useEffect(() => {
    document.title = `${heading} · ${PRODUCT_NAME}`;
  }, [heading]);
  return (
    <div className="auth">
      <a href="#auth-main" className="skip-link">
        Skip to content
      </a>
      <header className="auth__header">
        <a href={ECOMBACK} className="auth__brand" aria-label="Ecomback website">
          <img className="logo-on-light" src="/ecomback-logo.svg" alt="Ecomback" width={168} height={37} />
          <img className="logo-on-dark" src="/ecomback-logo-white.svg" alt="Ecomback" width={168} height={37} />
          <span className="auth__product">SortSite Tools</span>
        </a>
        <h1 className="auth__title">{heading}</h1>
      </header>
      <main id="auth-main" className={`auth__main ${aside ? '' : 'auth__main--single'}`}>
        <div className="auth__content">{children}</div>
        {aside && <HelpCard />}
      </main>
      <AuthFooter />
    </div>
  );
}

function HelpCard() {
  const links: [string, string][] = [
    ['Website accessibility audit & remediation', `${ECOMBACK}/ada-website-accessibility-audit-remediation`],
    ['Website accessibility checklist', `${ECOMBACK}/website-accessibility-checklist`],
    ['PDF remediation services', `${ECOMBACK}/pdf-remediation-services`],
  ];
  return (
    <aside className="card auth__aside" aria-labelledby="help-card-title">
      <div className="auth__aside-head">
        <h2 id="help-card-title">Need accessibility help?</h2>
        <p className="muted small">SortSite Tools is Ecomback's scanner for clients and partners. Looking for something else? Try these:</p>
      </div>
      <ul role="list" className="auth__links">
        {links.map(([label, href]) => (
          <li key={href}>
            <a href={href}>
              {label}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <div className="auth__aside-foot">
        <a className="btn btn--sm" href={`${ECOMBACK}/contact-us`}>
          Contact Ecomback
        </a>
      </div>
    </aside>
  );
}

function AuthFooter() {
  return (
    <footer className="auth__footer">
      <div className="auth__footer-inner">
        <div className="auth__footer-brand">
          <img src="/ecomback-logo-white.svg" alt="Ecomback" width={168} height={37} />
          <p>
            {PRODUCT_NAME}: a cloud-based scanner for accessibility (WCAG, ADA), broken links, SEO, compatibility and site quality. It works on any device, with nothing to install.
          </p>
        </div>
        <nav aria-labelledby="f-help">
          <h2 id="f-help">Help and Support</h2>
          <ul role="list">
            <li>
              <a href={`${ECOMBACK}/contact-us`}>
                <CircleHelp size={18} aria-hidden="true" /> Help
              </a>
            </li>
            <li>
              <a href={`${ECOMBACK}/news`}>
                <Sparkles size={18} aria-hidden="true" /> News
              </a>
            </li>
            <li>
              <a href={`${ECOMBACK}/guides`}>
                <ShieldCheck size={18} aria-hidden="true" /> Guides
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="f-legal">
          <h2 id="f-legal">Legal</h2>
          <ul role="list">
            <li>
              <a href={`${ECOMBACK}/accessibility`}>
                <Accessibility size={18} aria-hidden="true" /> Accessibility
              </a>
            </li>
            <li>
              <a href={`${ECOMBACK}/privacy-policy`}>
                <Lock size={18} aria-hidden="true" /> Privacy Policy
              </a>
            </li>
            <li>
              <a href={`${ECOMBACK}/website-content-disclaimer`}>
                <FileText size={18} aria-hidden="true" /> Content Disclaimer
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="auth__copyright">© {new Date().getFullYear()} Ecomback. All rights reserved.</div>
    </footer>
  );
}

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

  return (
    <AuthLayout heading="Log In">
      {stage === 'login' ? (
        <form onSubmit={submit} className="auth__form" noValidate>
          <p className="auth__intro">
            This page is for signing in to {PRODUCT_NAME}, Ecomback's website quality and accessibility scanner. Need an account? <a href={`${ECOMBACK}/contact-us`}>Contact Ecomback.</a>
          </p>
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
          <Checkbox label="Remember me for 30 days" checked={remember} onChange={setRemember} />
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !email || !password}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            Log In
          </button>
          <p style={{ textAlign: 'center' }}>
            <Link to="/forgot-password" style={{ fontWeight: 500 }}>
              Forgot your password?
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={submit2fa} className="auth__form" noValidate>
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <span className="auth__icon" aria-hidden="true">
              <KeyRound size={22} />
            </span>
            <div>
              <h2>Two-factor authentication</h2>
              <p className="muted" style={{ marginTop: 6 }}>
                {recovery ? 'Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works once.' : 'Open your authenticator app and enter the 6-digit code for SortSite Tools by Ecomback.'}
              </p>
            </div>
          </div>
          {error && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error.message}</div>
            </div>
          )}
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
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !code}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            Verify and sign in
          </button>
          <div className="row row--between">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setRecovery((r) => !r); setCode(''); setError(null); }}>
              {recovery ? 'Use authenticator app instead' : 'Use a recovery code'}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void api.post('/auth/logout'); setStage('login'); setCode(''); setError(null); }}>
              Back to sign in
            </button>
          </div>
        </form>
      )}
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
    <AuthLayout heading="Reset Password">
      {sent ? (
        <div className="auth__form" role="status">
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
        <form onSubmit={submit} className="auth__form" noValidate>
          <p className="auth__intro">Enter the email address you sign in with and we'll send you a link to choose a new password.</p>
          {error && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error}</div>
            </div>
          )}
          <TextField label="Email address" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="input--lg" autoFocus required />
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !email}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            Send reset link
          </button>
          <p style={{ textAlign: 'center' }}>
            <Link to="/login">Back to sign in</Link>
          </p>
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
    <AuthLayout heading={invite ? 'Activate Account' : 'Choose Password'}>
      {done ? (
        <div className="auth__form" role="status">
          <div className="banner banner--success">
            <CheckCircle2 size={18} aria-hidden="true" />
            <div>Your password is set. You can sign in now.</div>
          </div>
          <Link to="/login" className="btn btn--primary btn--lg btn--block">
            Go to sign in
          </Link>
        </div>
      ) : !token ? (
        <div className="auth__form">
          <div className="banner banner--danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>This link is incomplete. Open the link from your email again, or request a new one.</div>
          </div>
          <Link to="/forgot-password" className="btn btn--lg btn--block">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="auth__form" noValidate>
          <p className="auth__intro">{invite ? 'Welcome! Choose a password to activate your account.' : 'Choose a new password for your account.'} Use a passphrase of 16+ characters, or 8+ characters with upper and lower case letters plus a digit or punctuation.</p>
          {error && !error.fieldError('password') && (
            <div className="banner banner--danger" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <div>{error.message}</div>
            </div>
          )}
          <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" strength large error={error?.fieldError('password')} />
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" large error={mismatch ? 'The passwords do not match.' : undefined} />
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy || !password || mismatch}>
            {busy && <Loader2 size={18} className="spin" aria-hidden="true" />}
            {invite ? 'Activate account' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
