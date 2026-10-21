import { useState, type FormEvent } from 'react';
import { AlertTriangle, Link2, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApi, useAuth, useToast } from '../../lib/app';
import { fmtRelative } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBanner, LoadingBlock, Modal, TextField } from '../../components/ui';
import { CopyButton } from './shared';

interface AppsData {
  apps: { id: number; name: string; clientId: string; redirectUris: string[]; createdAt: string; connections: number }[];
  connections: { id: number; app: string; prefix: string; scope: string; lastUsedAt: string | null; createdAt: string; user: string }[];
  scopes: { id: string; label: string }[];
  endpoints: { authorize: string; token: string; revoke: string; metadata: string; api: string };
}

/** The Ecomback Remediation Platform runs on localhost:4610 in development. */
const REMEDIATION_PRESET = { name: 'Ecomback Remediation Platform', redirectUri: 'http://localhost:4610/oauth/callback/sortsite' };

/**
 * Settings › Connected apps — OAuth 2.0 clients (e.g. the Remediation Platform) that users can connect
 * through a sign-in + consent screen, instead of pasting API tokens around.
 */
export function ConnectedAppsCard() {
  const { can } = useAuth();
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<AppsData>('/oauth/apps');
  const [registering, setRegistering] = useState<{ name: string; redirectUri: string } | null>(null);
  const [credentials, setCredentials] = useState<{ name: string; clientId: string; clientSecret: string; redirectUri?: string } | null>(null);
  const [removing, setRemoving] = useState<AppsData['apps'][number] | null>(null);
  const [formError, setFormError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const admin = can('users.manage');

  const register = async (e: FormEvent) => {
    e.preventDefault();
    if (!registering) return;
    setBusy(true);
    setFormError(null);
    try {
      const r = await api.post<{ clientId: string; clientSecret: string }>('/oauth/apps', registering);
      setCredentials({ name: registering.name, redirectUri: registering.redirectUri, ...r });
      setRegistering(null);
      void reload(true);
    } catch (err) {
      setFormError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (app: AppsData['apps'][number]) => {
    const r = await api.post<{ clientId: string; clientSecret: string }>(`/oauth/apps/${app.id}/secret`);
    setCredentials({ name: app.name, ...r });
  };

  const disconnect = async (id: number) => {
    await api.del(`/oauth/connections/${id}`);
    push({ kind: 'success', title: 'Disconnected', body: 'The app can no longer access this account.' });
    void reload(true);
  };

  return (
    <section className="card" aria-labelledby="apps-title" id="connected-apps">
      <div className="card__head">
        <div>
          <h2 id="apps-title">Connected apps</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Let other Ecomback tools, such as the Remediation Platform, start scans and read reports on your behalf. People connect with their own sign-in and approve access on a consent screen. No passwords or tokens are shared.
          </p>
        </div>
        {admin && (
          <div className="row">
            <button type="button" className="btn" onClick={() => setRegistering({ name: '', redirectUri: '' })}>
              <Plus size={16} aria-hidden="true" />
              Register app
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setRegistering({ ...REMEDIATION_PRESET })}>
              <Link2 size={16} aria-hidden="true" />
              Add Remediation Platform
            </button>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="card__body"><LoadingBlock /></div>
      ) : error || !data ? (
        <div className="card__body"><ErrorBanner message={error ?? 'Could not load connected apps.'} onRetry={() => void reload()} /></div>
      ) : (
        <>
          {!data.apps.length ? (
            <Empty icon={<Link2 size={36} aria-hidden="true" />} title="No connected apps yet">
              {admin ? 'Choose “Add Remediation Platform” to let it run SortSite scans and import issues.' : 'An administrator can register apps here.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Registered apps</caption>
                <thead>
                  <tr>
                    <th scope="col">App</th>
                    <th scope="col">Client ID</th>
                    <th scope="col">Redirect URI</th>
                    <th scope="col" className="num">Connections</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.apps.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.name}</strong><div className="xsmall muted">Added {fmtRelative(a.createdAt)}</div></td>
                      <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><code className="code-block" style={{ padding: '2px 8px', whiteSpace: 'nowrap', wordBreak: 'normal' }}>{a.clientId}</code><CopyButton text={a.clientId} label="Copy client ID" /></span></td>
                      <td className="small" style={{ wordBreak: 'break-all' }}>{a.redirectUris.join(', ')}</td>
                      <td className="num">{a.connections}</td>
                      <td className="num">
                        {admin && (
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn--sm" onClick={() => void rotate(a)}>
                              <RefreshCw size={14} aria-hidden="true" />
                              New secret
                            </button>
                            <button type="button" className="btn btn--sm btn--ghost" aria-label={`Remove ${a.name}`} onClick={() => setRemoving(a)}>
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.connections.length > 0 && (
            <div className="table-wrap" style={{ borderTop: '1px solid var(--border)' }}>
              <table className="table">
                <caption style={{ textAlign: 'left', padding: '14px 16px 4px', fontWeight: 600 }}>Active connections</caption>
                <thead>
                  <tr>
                    <th scope="col">App</th>
                    <th scope="col">Connected by</th>
                    <th scope="col">Access</th>
                    <th scope="col">Last used</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.connections.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.app}</strong><div className="xsmall muted">Connected {fmtRelative(c.createdAt)}</div></td>
                      <td className="small">{c.user}</td>
                      <td>{c.scope.split(' ').map((s) => <span key={s} className="chip" style={{ marginRight: 4 }}>{s}</span>)}</td>
                      <td className="small">{c.lastUsedAt ? fmtRelative(c.lastUsedAt) : 'Never'}</td>
                      <td className="num">
                        <button type="button" className="btn btn--sm" onClick={() => void disconnect(c.id)}>
                          <Unplug size={14} aria-hidden="true" />
                          Disconnect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details className="card__foot" style={{ display: 'block' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text-2)' }}>OAuth endpoints for developers</summary>
            <dl className="dl" style={{ marginTop: 10 }}>
              <dt>Authorization</dt><dd><code>{data.endpoints.authorize}</code></dd>
              <dt>Token</dt><dd><code>{data.endpoints.token}</code></dd>
              <dt>Revocation</dt><dd><code>{data.endpoints.revoke}</code></dd>
              <dt>Metadata</dt><dd><code>{data.endpoints.metadata}</code></dd>
              <dt>API base</dt><dd><code>{data.endpoints.api}</code></dd>
              <dt>Grant</dt><dd>Authorization code with PKCE (S256); client authentication with HTTP Basic or client_secret_post.</dd>
              <dt>Scopes</dt><dd>{data.scopes.map((s) => `${s.id} (${s.label.toLowerCase()})`).join('; ')}</dd>
            </dl>
          </details>
        </>
      )}

      {registering && (
        <Modal
          title="Register a connected app"
          onClose={() => setRegistering(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setRegistering(null)}>Cancel</button>
              <button type="submit" form="register-app" className="btn btn--primary" disabled={busy}>Register app</button>
            </>
          }
        >
          <form id="register-app" className="stack" onSubmit={(e) => void register(e)} noValidate>
            <TextField label="App name" value={registering.name} onChange={(e) => setRegistering({ ...registering, name: e.target.value })} hint="Shown to people on the consent screen." required />
            <TextField
              label="Redirect URI"
              value={registering.redirectUri}
              onChange={(e) => setRegistering({ ...registering, redirectUri: e.target.value })}
              hint="Where people return after approving. Must match exactly. https only (http is allowed for localhost)."
              error={formError?.fieldError('redirectUri')}
              spellCheck={false}
              required
            />
            {formError && !formError.fieldError('redirectUri') && <ErrorBanner message={formError.message} />}
          </form>
        </Modal>
      )}

      {credentials && (
        <Modal title={`Credentials for ${credentials.name}`} onClose={() => setCredentials(null)} footer={<button type="button" className="btn btn--primary" onClick={() => setCredentials(null)}>I've saved these</button>}>
          <div className="stack">
            <div className="banner banner--warning">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>Copy the client secret now. It's shown once; if you lose it, generate a new one.</div>
            </div>
            <p className="small">Add these lines to the Remediation Platform's <code>.env</code> file, then restart it:</p>
            <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{envBlock(credentials)}</pre>
            <CopyButton text={envBlock(credentials)} label="Copy .env lines" small={false} />
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmModal
          title={`Remove ${removing.name}?`}
          message={<p>All {removing.connections} connection(s) stop working immediately, and people would need to reconnect after it's registered again.</p>}
          confirmLabel="Remove app"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.del(`/oauth/apps/${removing.id}`);
            setRemoving(null);
            push({ kind: 'success', title: `${removing.name} removed` });
            void reload(true);
          }}
        />
      )}
    </section>
  );
}

const envBlock = (c: { clientId: string; clientSecret: string }) =>
  [`SORTSITE_URL=${window.location.origin}`, `SORTSITE_CLIENT_ID=${c.clientId}`, `SORTSITE_CLIENT_SECRET=${c.clientSecret}`].join('\n');
