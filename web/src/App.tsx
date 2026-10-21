import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, EventsProvider, TitleProvider, ToastProvider, useAuth } from './lib/app';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui';
import { LoginPage, ForgotPasswordPage, ResetPasswordPage } from './pages/Login';
import { OAuthConsentPage } from './pages/OAuthConsent';
import type { Permission } from '@shared/types';

const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })));
const ScansPage = lazy(() => import('./pages/Scans').then((m) => ({ default: m.ScansPage })));
const HistoryPage = lazy(() => import('./pages/History').then((m) => ({ default: m.HistoryPage })));
const ComparePage = lazy(() => import('./pages/Compare').then((m) => ({ default: m.ComparePage })));
const EditScanPage = lazy(() => import('./pages/EditScan').then((m) => ({ default: m.EditScanPage })));
const ReportRoutes = lazy(() => import('./pages/report/ReportShell').then((m) => ({ default: m.ReportRoutes })));
const DashboardPage = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })));
const SitemapsPage = lazy(() => import('./pages/Sitemaps').then((m) => ({ default: m.SitemapsPage })));
const SitemapResultPage = lazy(() => import('./pages/Sitemaps').then((m) => ({ default: m.SitemapResultPage })));
const SitemapOptionsPage = lazy(() => import('./pages/Sitemaps').then((m) => ({ default: m.SitemapOptionsPage })));
const ClientsPage = lazy(() => import('./pages/account/Clients').then((m) => ({ default: m.ClientsPage })));
const SettingsPage = lazy(() => import('./pages/account/Settings').then((m) => ({ default: m.SettingsPage })));
const SecurityPage = lazy(() => import('./pages/account/Security').then((m) => ({ default: m.SecurityPage })));
const BillingPage = lazy(() => import('./pages/account/Billing').then((m) => ({ default: m.BillingPage })));
const AuditPage = lazy(() => import('./pages/account/Audit').then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import('./pages/account/Users').then((m) => ({ default: m.UsersPage })));
const ReleaseNotesPage = lazy(() => import('./pages/account/ReleaseNotes').then((m) => ({ default: m.ReleaseNotesPage })));
const RulesPage = lazy(() => import('./pages/account/Rules').then((m) => ({ default: m.RulesPage })));
const RuleDetailPage = lazy(() => import('./pages/account/Rules').then((m) => ({ default: m.RuleDetailPage })));
const MailboxPage = lazy(() => import('./pages/account/Mailbox').then((m) => ({ default: m.MailboxPage })));

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <EventsProvider>
          <TitleProvider>
            <AppRoutes />
          </TitleProvider>
        </EventsProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/oauth/authorize" element={<OAuthConsentPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Lazy><HomePage /></Lazy>} />
        <Route path="dashboard" element={<Lazy><DashboardPage /></Lazy>} />
        <Route path="scans" element={<Lazy><ScansPage /></Lazy>} />
        <Route path="sites/:id" element={<Lazy><HistoryPage /></Lazy>} />
        <Route path="sites/:id/compare" element={<Lazy><ComparePage /></Lazy>} />
        <Route path="sites/:id/options" element={<Lazy><Guard perm="scan.options"><EditScanPage /></Guard></Lazy>} />
        <Route path="scans/:id/report/*" element={<Lazy><ReportRoutes /></Lazy>} />
        <Route path="sitemaps" element={<Lazy><SitemapsPage /></Lazy>} />
        <Route path="sitemaps/:id" element={<Lazy><SitemapResultPage /></Lazy>} />
        <Route path="sitemaps/:id/options" element={<Lazy><Guard perm="sitemap.run"><SitemapOptionsPage /></Guard></Lazy>} />
        <Route path="clients" element={<Lazy><ClientsPage /></Lazy>} />
        <Route path="account/settings" element={<Lazy><SettingsPage /></Lazy>} />
        <Route path="account/security" element={<Lazy><SecurityPage /></Lazy>} />
        <Route path="billing" element={<Lazy><Guard perm="billing.view"><BillingPage /></Guard></Lazy>} />
        <Route path="audit" element={<Lazy><Guard perm="audit.view"><AuditPage /></Guard></Lazy>} />
        <Route path="users" element={<Lazy><Guard perm="users.manage"><UsersPage /></Guard></Lazy>} />
        <Route path="release-notes" element={<Lazy><ReleaseNotesPage /></Lazy>} />
        <Route path="rules" element={<Lazy><RulesPage /></Lazy>} />
        <Route path="rules/:id" element={<Lazy><RuleDetailPage /></Lazy>} />
        <Route path="mailbox" element={<Lazy><Guard perm="users.manage"><MailboxPage /></Guard></Lazy>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingBlock rows={5} />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <img src="/ecomback-mark.svg" alt="Loading SortSite Tools by Ecomback" width={56} height={56} className="spin" style={{ animationDuration: '1.6s' }} />
      </div>
    );
  }
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) {
    return (
      <div className="card card__body" role="alert">
        <h2>You don't have access to this page</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          Ask an administrator for the permission you need.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="card card__body">
      <h2>Page not found</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        The address may be mistyped, or the item was deleted. <a href="/">Go to Home</a>
      </p>
    </div>
  );
}
