import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertCircle, ArrowLeftRight, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/app';
import { AuthLayout } from './Login';

interface ConsentInfo {
  app: { name: string; clientId: string; redirectHost: string };
  scopes: { id: string; label: string }[];
  user: { name: string; email: string };
}

/**
 * OAuth 2.0 consent screen (GET /oauth/authorize). Signed-out users go through the normal login
 * (including two-factor) and come straight back here; nothing is granted until they press Allow.
 */
export function OAuthConsentPage() {
  const { me, loading, logout } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    if (!me) return;
    api
      .get<ConsentInfo>(`/oauth/authorize/info${location.search}`)
      .then(setInfo)
      .catch((e: ApiError) => setError(e.message));
  }, [me, location.search]);

  if (loading) return null;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  const decide = async (decision: 'allow' | 'deny') => {
    setBusy(decision);
    try {
      const r = await api.post<{ redirect: string }>('/oauth/authorize', {
        decision,
        client_id: params.get('client_id'),
        redirect_uri: params.get('redirect_uri'),
        scope: params.get('scope'),
        state: params.get('state'),
        code_challenge: params.get('code_challenge'),
        code_challenge_method: params.get('code_challenge_method'),
      });
      window.location.assign(r.redirect);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <AuthLayout heading="Connect an App" aside={false}>
      <div className="auth__form" style={{ maxWidth: 560 }}>
        {error ? (
          <div className="banner banner--danger" role="alert">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <strong>This connection request can't be completed.</strong>
              <div style={{ marginTop: 4 }}>{error}</div>
            </div>
          </div>
        ) : !info ? (
          <p className="row" role="status">
            <Loader2 size={18} className="spin" aria-hidden="true" /> Checking the request…
          </p>
        ) : (
          <>
            <div className="consent__apps" aria-hidden="true">
              <span className="consent__logo">
                <img src="/ecomback-mark.svg" alt="" width={36} height={36} />
              </span>
              <ArrowLeftRight size={22} />
              <span className="consent__logo consent__logo--app">{info.app.name.slice(0, 1)}</span>
            </div>
            <h2 style={{ fontSize: '1.45rem', textAlign: 'center' }}>
              <strong>{info.app.name}</strong> wants to access your SortSite Tools account
            </h2>
            <p className="muted" style={{ textAlign: 'center' }}>
              Signed in as <strong>{info.user.name}</strong> ({info.user.email}).{' '}
              <button type="button" className="linklike" onClick={() => void logout()}>
                Not you?
              </button>
            </p>
            <div className="card" style={{ padding: '18px 20px' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>This will allow {info.app.name} to:</h3>
              <ul role="list" className="consent__scopes">
                {info.scopes.map((s) => (
                  <li key={s.id}>
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span>{s.label}</span>
                  </li>
                ))}
              </ul>
              <p className="small muted row" style={{ gap: 6, marginTop: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <ShieldCheck size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
                <span>
                  It will not see your password and cannot manage users, security or billing. You can disconnect it at any time under Settings › Connected apps. You'll be sent back to <strong>{info.app.redirectHost}</strong>.
                </span>
              </p>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <button type="button" className="btn btn--lg" style={{ flex: 1 }} disabled={!!busy} onClick={() => void decide('deny')}>
                {busy === 'deny' && <Loader2 size={18} className="spin" aria-hidden="true" />}
                Cancel
              </button>
              <button type="button" className="btn btn--primary btn--lg" style={{ flex: 2 }} disabled={!!busy} onClick={() => void decide('allow')} autoFocus>
                {busy === 'allow' && <Loader2 size={18} className="spin" aria-hidden="true" />}
                Allow and connect
              </button>
            </div>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
