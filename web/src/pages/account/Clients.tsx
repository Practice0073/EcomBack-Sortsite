import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { TopbarActions, useApi, useAuth, usePage, useToast } from '../../lib/app';
import { ConfirmModal, Empty, ErrorBanner, LoadingBlock, Modal, TextField } from '../../components/ui';
import './shared';

interface Client { id: number; name: string; contactEmail: string | null; logo: string | null; sites: number }

const MAX_LOGO = 500 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

export function ClientsPage() {
  usePage('Clients');
  const { can } = useAuth();
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<Client[]>('/clients');
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const manage = can('clients.manage');

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.del(`/clients/${deleting.id}`);
      push({ kind: 'success', title: `Deleted ${deleting.name}`, body: 'Its sites are kept and now unassigned.' });
      setDeleting(null);
      void reload(true);
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <TopbarActions>
        {manage && (
          <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
            <Plus size={16} aria-hidden="true" />
            New Client…
          </button>
        )}
      </TopbarActions>

      <div className="card note-card">
        <div className="card__body">
          <h2 style={{ fontSize: '1rem' }}>Client workspaces (agency mode)</h2>
          <ul className="muted small">
            <li>Group sites by client, then filter the Scans list and Dashboard by client.</li>
            <li>Reports and exports for a client's sites show the client's name and logo alongside Ecomback branding.</li>
            <li>Viewer users can be limited to one client under Users, so clients only see their own sites.</li>
          </ul>
        </div>
      </div>

      {loading && !data ? (
        <LoadingBlock rows={5} />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => void reload()} />
      ) : !data?.length ? (
        <div className="card">
          <Empty
            icon={<Briefcase size={40} aria-hidden="true" />}
            title="No client workspaces yet"
            action={manage ? <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}><Plus size={16} aria-hidden="true" /> New Client…</button> : undefined}
          >
            Create a workspace for each client to brand their reports and keep their sites separate.
          </Empty>
        </div>
      ) : (
        <ul role="list" className="acct-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {data.map((c) => (
            <li key={c.id} className="card client-card">
              <div className="card__body stack" style={{ flex: 1 }}>
                <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 14 }}>
                  <span className="client-card__logo">{c.logo ? <img src={c.logo} alt={`${c.name} logo`} /> : <span aria-hidden="true">{c.name.slice(0, 2).toUpperCase()}</span>}</span>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: '1.05rem', wordBreak: 'break-word' }}>{c.name}</h2>
                    <p className="small muted" style={{ wordBreak: 'break-all' }}>{c.contactEmail ?? 'No contact email'}</p>
                  </div>
                </div>
                <Link to={`/scans?client=${c.id}`} className="small" style={{ fontWeight: 600 }}>
                  {c.sites.toLocaleString()} site{c.sites === 1 ? '' : 's'} →
                </Link>
              </div>
              {manage && (
                <div className="card__foot">
                  <button type="button" className="btn btn--sm" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}>
                    <Pencil size={14} aria-hidden="true" />
                    Edit
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setDeleteError(null); setDeleting(c); }} aria-label={`Delete ${c.name}`}>
                    <Trash2 size={14} aria-hidden="true" />
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <ClientModal client={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(true); }} />}
      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          message={<p>The workspace is deleted. Its {deleting.sites} site{deleting.sites === 1 ? '' : 's'} and their scans are kept but no longer assigned to a client, and users limited to this client lose that restriction.</p>}
          confirmWord={deleting.name}
          confirmLabel="Delete client"
          busy={busy}
          error={deleteError}
          onConfirm={() => void remove()}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function ClientModal({ client, onClose, onSaved }: { client: Client | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast();
  const [name, setName] = useState(client?.name ?? '');
  const [email, setEmail] = useState(client?.contactEmail ?? '');
  const [logo, setLogo] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove
  const [logoError, setLogoError] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = logo === undefined ? client?.logo ?? null : logo;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setLogoError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError('Choose a PNG, JPEG or SVG image.');
      return;
    }
    if (file.size > MAX_LOGO) {
      setLogoError(`That file is ${Math.round(file.size / 1024)} KB; the limit is 500 KB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.onerror = () => setLogoError('The file could not be read.');
    reader.readAsDataURL(file);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let id = client?.id;
      if (client) await api.patch(`/clients/${client.id}`, { name, contactEmail: email });
      else id = (await api.post<{ id: number }>('/clients', { name, contactEmail: email })).id;
      if (logo !== undefined && id) await api.patch(`/clients/${id}`, { logoDataUrl: logo });
      push({ kind: 'success', title: client ? 'Client updated' : 'Client created', body: name });
      onSaved();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={client ? `Edit ${client.name}` : 'New client'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="client-form" className="btn btn--success" disabled={busy || !name.trim()}>
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            Save
          </button>
        </>
      }
    >
      <form id="client-form" className="stack" onSubmit={submit} noValidate>
        {error && !error.fields.length && <ErrorBanner message={error.message} />}
        <TextField label="Client name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} error={error?.fieldError('name')} data-autofocus="true" />
        <TextField label="Contact email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Optional. Shown on branded reports." error={error?.fieldError('contactEmail')} />
        <div className="field">
          <span className="field__label" id="logo-label">Logo</span>
          <div className="row" style={{ gap: 14 }}>
            <span className="client-card__logo">{preview ? <img src={preview} alt="Logo preview" /> : <ImagePlus size={24} aria-hidden="true" />}</span>
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml" onChange={onFile} className="sr-only" id="logo-file" aria-labelledby="logo-label logo-choose" aria-describedby="logo-hint logo-err" />
            <button type="button" id="logo-choose" className="btn btn--sm" onClick={() => fileRef.current?.click()}>
              Choose image…
            </button>
            {preview && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setLogo(null); if (fileRef.current) fileRef.current.value = ''; }}>
                Remove logo
              </button>
            )}
          </div>
          <span id="logo-hint" className="field__hint">PNG, JPEG or SVG, up to 500 KB. Appears on this client's report covers.</span>
          <span id="logo-err" className="field__error" role={logoError ? 'alert' : undefined}>{logoError}</span>
        </div>
      </form>
    </Modal>
  );
}
