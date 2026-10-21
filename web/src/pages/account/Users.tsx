import { useState, type FormEvent } from 'react';
import { Check, Loader2, Minus, ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { TopbarActions, useApi, usePage, useToast } from '../../lib/app';
import { fmtRelative } from '../../lib/format';
import { ConfirmModal, Empty, ErrorBanner, LoadingBlock, Modal, SelectField, TextField } from '../../components/ui';
import { CopyButton } from './shared';
import type { Role } from '@shared/types';

interface UserItem { id: number; name: string; email: string; role: Role; roleLabel: string; status: 'active' | 'invited' | 'disabled'; lastLoginAt: string | null; clientId: number | null; clientName: string | null; twoFactor: boolean; isYou: boolean }
interface UsersData { limit: { used: number; limit: number }; roles: { id: Role; label: string; permissions: string[] }[]; items: UserItem[] }
interface Client { id: number; name: string }

const STATUS: Record<UserItem['status'], [string, string]> = { active: ['badge--success', 'Active'], invited: ['badge--info', 'Invited'], disabled: ['badge--neutral', 'Disabled'] };

export function UsersPage() {
  usePage('Users');
  const { push } = useToast();
  const { data, error, loading, reload } = useApi<UsersData>('/users');
  const clients = useApi<Client[]>('/clients');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<UserItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const patch = async (u: UserItem, body: Record<string, unknown>, success: string) => {
    try {
      await api.patch(`/users/${u.id}`, body);
      push({ kind: 'success', title: success, body: u.email });
      void reload(true);
    } catch (err) {
      push({ kind: 'error', title: 'Could not update user', body: (err as Error).message });
      void reload(true);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError(null);
    try {
      await api.del(`/users/${removing.id}`);
      push({ kind: 'success', title: `Removed ${removing.email}` });
      setRemoving(null);
      void reload(true);
    } catch (err) {
      setRemoveError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <LoadingBlock rows={6} />;
  if (error || !data) return <ErrorBanner message={error ?? 'Could not load users.'} onRetry={() => void reload()} />;
  const atLimit = data.limit.used >= data.limit.limit;
  const roleOptions = data.roles.map((r) => ({ value: r.id, label: r.label }));
  const clientOptions = [{ value: '', label: 'All workspaces' }, ...(clients.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))];
  const allPerms = [...new Set(data.roles.flatMap((r) => r.permissions))];

  return (
    <div className="stack-lg">
      <TopbarActions>
        <button type="button" className="btn btn--primary" onClick={() => setInviting(true)} disabled={atLimit}>
          <UserPlus size={16} aria-hidden="true" />
          Invite User…
        </button>
      </TopbarActions>

      <div className={`banner ${atLimit ? 'banner--warning' : 'banner--info'}`} role="status">
        <UsersIcon size={18} aria-hidden="true" />
        <div>
          <strong>
            {data.limit.used} of {data.limit.limit} users
          </strong>{' '}
          on your plan.{atLimit ? ' Remove or disable a user before inviting someone new.' : ''}
        </div>
      </div>

      <section className="card card--flush" aria-label="Users">
        {!data.items.length ? (
          <Empty icon={<UsersIcon size={36} aria-hidden="true" />} title="No users" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Users in this account</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Permissions</th>
                  <th scope="col">Client access</th>
                  <th scope="col">Last Login</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className={u.status === 'disabled' ? 'is-muted' : undefined}>
                    <td style={{ minWidth: 220 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <strong>{u.name}</strong>
                        {u.isYou && <span className="badge badge--info">You</span>}
                        {u.twoFactor && (
                          <span className="badge badge--success" title="Two-factor authentication on">
                            <ShieldCheck size={12} aria-hidden="true" />
                            2FA
                          </span>
                        )}
                      </div>
                      <div className="small muted" style={{ wordBreak: 'break-all' }}>{u.email}</div>
                    </td>
                    <td><span className={`badge ${STATUS[u.status][0]}`}>{STATUS[u.status][1]}</span></td>
                    <td style={{ minWidth: 170 }}>
                      {u.isYou ? (
                        u.roleLabel
                      ) : (
                        <SelectField label={`Role for ${u.name}`} labelHidden value={u.role} options={roleOptions} onChange={(e) => void patch(u, { role: e.target.value }, 'Role updated')} />
                      )}
                    </td>
                    <td style={{ minWidth: 180 }}>
                      {u.isYou ? (
                        u.clientName ?? 'All workspaces'
                      ) : (
                        <SelectField label={`Client access for ${u.name}`} labelHidden value={u.clientId ? String(u.clientId) : ''} options={clientOptions} onChange={(e) => void patch(u, { clientId: e.target.value ? Number(e.target.value) : null }, 'Client access updated')} />
                      )}
                    </td>
                    <td>{u.lastLoginAt ? fmtRelative(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {!u.isYou && (
                        <>
                          {u.status !== 'invited' && (
                            <button type="button" className="btn btn--sm" onClick={() => void patch(u, { status: u.status === 'disabled' ? 'active' : 'disabled' }, u.status === 'disabled' ? 'User enabled' : 'User disabled')}>
                              {u.status === 'disabled' ? 'Enable' : 'Disable'}
                            </button>
                          )}{' '}
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setRemoveError(null); setRemoving(u); }} aria-label={`Remove ${u.name}`}>
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card--flush" aria-labelledby="matrix-title">
        <div className="card__head">
          <h2 id="matrix-title">Permissions by role</h2>
        </div>
        <div className="table-wrap">
          <table className="table matrix">
            <caption className="sr-only">What each role can do</caption>
            <thead>
              <tr>
                <th scope="col">Permission</th>
                {data.roles.map((r) => (
                  <th key={r.id} scope="col">{r.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allPerms.map((p) => (
                <tr key={p}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: '0.9rem', color: 'var(--text)', background: 'transparent' }}>{p}</th>
                  {data.roles.map((r) => (
                    <td key={r.id}>
                      {r.permissions.includes(p) ? <Check size={18} color="var(--success)" role="img" aria-label="Allowed" /> : <Minus size={18} color="var(--text-3)" role="img" aria-label="Not allowed" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {inviting && <InviteModal roles={roleOptions} clients={clientOptions} onClose={() => setInviting(false)} onInvited={() => void reload(true)} />}
      {removing && (
        <ConfirmModal
          title={`Remove ${removing.name}?`}
          message={<p>{removing.email} loses access immediately. Their audit history is kept.</p>}
          confirmLabel="Remove user"
          busy={busy}
          error={removeError}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function InviteModal({ roles, clients, onClose, onInvited }: { roles: { value: string; label: string }[]; clients: { value: string; label: string }[]; onClose: () => void; onInvited: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('analyst');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ id: number; inviteUrl: string }>('/users', { name, email, role, clientId: clientId ? Number(clientId) : undefined });
      setInvite(r.inviteUrl);
      onInvited();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={invite ? 'Invitation sent' : 'Invite user'}
      onClose={onClose}
      footer={
        invite ? (
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="invite-form" className="btn btn--success" disabled={busy || !name.trim() || !email.trim()}>
              {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
              Send invitation
            </button>
          </>
        )
      }
    >
      {invite ? (
        <div className="stack" role="status">
          <p>
            We emailed an invitation to <strong>{email}</strong>. The link is valid for 7 days. On localhost without SMTP the email is only in Help › Email Outbox, so you can also share this link directly:
          </p>
          <div className="secret-box">
            <code>{invite}</code>
            <CopyButton text={invite} label="Copy link" />
          </div>
        </div>
      ) : (
        <form id="invite-form" className="stack" onSubmit={submit} noValidate>
          {error && !error.fields.length && <ErrorBanner message={error.message} />}
          <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={120} error={error?.fieldError('name')} data-autofocus="true" />
          <TextField label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" error={error?.fieldError('email')} />
          <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} options={roles} hint="Administrators manage users and billing; Analysts run scans; Viewers read and download reports." />
          <SelectField label="Client access" value={clientId} onChange={(e) => setClientId(e.target.value)} options={clients} hint="Limit this user to one client's sites (typical for client Viewers)." />
        </form>
      )}
    </Modal>
  );
}
