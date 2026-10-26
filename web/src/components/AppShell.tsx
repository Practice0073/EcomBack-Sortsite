import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  BookOpen,
  Briefcase,
  CheckCircle2,
  CreditCard,
  FileClock,
  Home,
  LayoutDashboard,
  Lock,
  Mail,
  Menu,
  Network,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useAuth, useLiveEvents, usePageChrome, useToast } from '../lib/app';
import { api, onLoading } from '../lib/api';
import { ThemeToggle } from './ThemeToggle';
import { fmtRelative } from '../lib/format';
import { PRODUCT_NAME, type Notification, type Permission } from '@shared/types';

interface NavItem { to: string; label: string; icon: typeof Home; perm?: Permission; end?: boolean; hidden?: boolean }
interface NavGroup { title: string; items: NavItem[]; hidden?: boolean }
const NAV: NavGroup[] = [
  {
    title: 'Workspace',
    items: [
      { to: '/', label: 'Home', icon: Home, end: true },
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/scans', label: 'Scans', icon: ScanSearch },
      { to: '/sitemaps', label: 'Sitemaps', icon: Network },
      // Hidden for now (owner request, 19 Oct 2026) — remove `hidden` to bring client workspaces back.
      { to: '/clients', label: 'Clients', icon: Briefcase, hidden: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/account/settings', label: 'Settings', icon: Settings },
      { to: '/account/security', label: 'Security', icon: ShieldCheck },
    ],
  },
  {
    // Hidden for now (owner request, 19 Oct 2026) — set hidden: false to bring Billing, Audit History and Users back.
    title: 'Subscription',
    hidden: true,
    items: [
      { to: '/billing', label: 'Billing', icon: CreditCard, perm: 'billing.view' },
      { to: '/audit', label: 'Audit History', icon: FileClock, perm: 'audit.view' },
      { to: '/users', label: 'Users', icon: Users, perm: 'users.manage' },
    ],
  },
  {
    title: 'Help',
    items: [
      { to: '/release-notes', label: 'Release Notes', icon: Sparkles },
      { to: '/rules', label: 'Rule Library', icon: BookOpen },
      { to: '/mailbox', label: 'Email Outbox', icon: Mail, perm: 'users.manage' },
    ],
  },
];

export function AppShell() {
  const { me, logout, can } = useAuth();
  const { title, setSlot } = usePageChrome();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setNavOpen(false);
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const initials = (me?.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="shell" data-nav-open={navOpen}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <GlobalLoadingBar />
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="sidebar__brand" aria-label={`${PRODUCT_NAME} — home`}>
          <img src="/ecomback-logo-white.svg" alt="" width={150} height={33} />
          <span className="sidebar__product">
            <strong>SortSite Tools</strong> by Ecomback
          </span>
        </Link>
        <nav>
          {NAV.filter((group) => !group.hidden).map((group) => {
            const items = group.items.filter((i) => !i.hidden && (!i.perm || can(i.perm)));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-group__title" id={`nav-${group.title}`}>
                  {group.title}
                </div>
                <ul role="list" aria-labelledby={`nav-${group.title}`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {items.map((item) => (
                    <li key={item.to}>
                      <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}>
                        <item.icon size={19} aria-hidden="true" />
                        {item.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sidebar__foot">
          <div className="sidebar__user">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', color: 'var(--side-text-strong)', fontWeight: 600, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.name}</span>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.accountName}</span>
            </span>
          </div>
          © {new Date().getFullYear()} Ecomback · v{__APP_VERSION__}
        </div>
      </aside>
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn topbar__menu" onClick={() => setNavOpen((o) => !o)} aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen}>
            {navOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="topbar__actions" ref={setSlot} />
          <h1 className="topbar__title">{title}</h1>
          <div className="topbar__right">
            <ThemeToggle />
            <NotificationsBell />
            <button
              type="button"
              className="btn btn--primary"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <Lock size={16} aria-hidden="true" />
              <span className="hide-sm">Log Out</span>
            </button>
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1} ref={mainRef} style={{ outline: 'none' }}>
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}

function GlobalLoadingBar() {
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);
  useEffect(() => onLoading((n) => setBusy(n > 0)), []);
  useEffect(() => {
    if (busy) {
      setWidth(15);
      const t = window.setInterval(() => setWidth((w) => Math.min(90, w + (90 - w) * 0.15)), 200);
      return () => window.clearInterval(t);
    }
    setWidth(100);
    const t = window.setTimeout(() => setWidth(0), 350);
    return () => window.clearTimeout(t);
  }, [busy]);
  return <div className="loading-bar" style={{ width: `${width}%`, opacity: width === 0 || width === 100 ? 0 : 1 }} aria-hidden="true" />;
}

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const { push } = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = async () => {
    const r = await api.get<{ items: Notification[]; unread: number }>('/notifications', { quiet: true }).catch(() => null);
    if (r) {
      setItems(r.items);
      setUnread(r.unread);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useLiveEvents((e) => {
    if (e.type === 'notification') {
      void load();
      push({ kind: e.kind.includes('failed') ? 'error' : e.kind === 'quota' || e.kind === 'issue-rise' ? 'info' : 'success', title: e.title, body: e.body, link: e.link ? { to: e.link, label: 'Open' } : undefined });
    }
  });
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => !ref.current?.contains(ev.target as Node) && setOpen(false);
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAll = async () => {
    await api.post('/notifications/read').catch(() => undefined);
    void load();
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Bell size={21} />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="card" role="region" aria-label="Notifications" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(380px, 90vw)', zIndex: 50, boxShadow: 'var(--shadow-lg)' }}>
          <div className="card__head" style={{ padding: '14px 18px' }}>
            <h2 style={{ fontSize: '1rem' }}>Notifications</h2>
            {unread > 0 && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 380, overflowY: 'auto' }}>
            {items.length === 0 && <li className="muted small" style={{ padding: 20, textAlign: 'center' }}>You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => {
                    void api.post('/notifications/read', { id: n.id });
                    setOpen(false);
                    if (n.link) navigate(n.link);
                    void load();
                  }}
                  style={{ display: 'flex', gap: 12, width: '100%', textAlign: 'left', padding: '12px 18px', background: n.read ? 'transparent' : 'var(--brand-navy-50)', border: 0, cursor: 'pointer' }}
                >
                  {n.kind.includes('failed') || n.kind === 'issue-rise' || n.kind === 'quota' ? <AlertTriangle size={18} color="var(--warning)" aria-hidden="true" /> : <CheckCircle2 size={18} color="var(--success)" aria-hidden="true" />}
                  <span style={{ minWidth: 0 }}>
                    <strong className="small" style={{ display: 'block' }}>{n.title}</strong>
                    <span className="small muted" style={{ display: 'block', wordBreak: 'break-word' }}>{n.body}</span>
                    <span className="xsmall muted">{fmtRelative(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useToast();
  const navigate = useNavigate();
  return (
    <div className="toasts" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.kind === 'error' ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{t.title}</strong>
            {t.body && <span style={{ opacity: 0.85, wordBreak: 'break-word' }}>{t.body}</span>}
            {t.link && (
              <button
                type="button"
                onClick={() => {
                  navigate(t.link!.to);
                  dismiss(t.id);
                }}
                style={{ display: 'block', marginTop: 4, background: 'none', border: 0, padding: 0, color: 'var(--toast-link)', fontWeight: 600, cursor: 'pointer' }}
              >
                {t.link.label} →
              </button>
            )}
          </div>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
