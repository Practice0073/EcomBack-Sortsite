import { Router } from 'express';
import QRCode from 'qrcode';
import { q, nowIso } from '../db/index.js';
import { config } from '../config.js';
import {
  createSession,
  destroySession,
  destroyUserSessions,
  ipRateLimited,
  requireAuth,
  toMe,
  upgradeSession,
  authed,
  actorOf,
  type UserRow,
} from '../auth/session.js';
import {
  hashPassword,
  verifyPassword,
  passwordPolicyError,
  randomToken,
  sha256,
  newTotpSecret,
  otpauthUrl,
  verifyTotp,
  newRecoveryCodes,
  encrypt,
  decrypt,
} from '../lib/crypto.js';
import { HttpError, badRequest, bool, clientIp, str } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { brandedEmail, sendMail } from '../mail/mailer.js';

export const authRouter = Router();

const GENERIC_FAIL = 'That email and password combination is not recognised.';

authRouter.post('/login', (req, res) => {
  const ip = clientIp(req);
  if (ipRateLimited(ip)) throw new HttpError(429, 'Too many sign-in attempts from this network. Wait 15 minutes and try again.');
  const email = str(req, 'email', { required: true, max: 254 }).toLowerCase();
  const password = str(req, 'password', { required: true, max: 1024, trim: false });
  const remember = bool(req, 'remember');
  const user = q.get<UserRow>('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || user.status === 'disabled') {
    verifyPassword(password, 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '=='); // equalise timing
    throw new HttpError(401, GENERIC_FAIL);
  }
  const actor = { accountId: user.account_id, userId: user.id, label: `${user.name} <${user.email}>`, ip };
  if (user.locked_until && user.locked_until > nowIso()) {
    const mins = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60000);
    throw new HttpError(423, `This account is locked after too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failures = user.failed_logins + 1;
    const lock = failures >= config.login.maxFailures ? new Date(Date.now() + config.login.lockoutMs).toISOString() : null;
    q.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', [lock ? 0 : failures, lock, user.id]);
    audit(actor, 'login-failed', lock ? 'Account locked after repeated failed sign-ins' : `Failed sign-in (${failures}/${config.login.maxFailures})`);
    if (lock) throw new HttpError(423, 'Too many failed attempts. This account is locked for 15 minutes.');
    const left = config.login.maxFailures - failures;
    throw new HttpError(401, `${GENERIC_FAIL} ${left} attempt${left === 1 ? '' : 's'} left before a temporary lock.`);
  }
  q.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', [user.id]);
  if (user.totp_enabled) {
    createSession(res, req, user.id, '2fa', remember);
    res.json({ stage: '2fa' });
    return;
  }
  createSession(res, req, user.id, 'full', remember);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  audit(actor, 'login', 'Signed in');
  res.json({ stage: 'done' });
});

authRouter.post('/login/2fa', (req, res) => {
  const pending = req.pending2fa;
  if (!pending) throw new HttpError(401, 'Your sign-in expired. Enter your email and password again.');
  const code = str(req, 'code', { required: true, max: 32 });
  const mode = str(req, 'mode') === 'recovery' ? 'recovery' : 'totp';
  const { user, sessionId } = pending;
  const actor = { accountId: user.account_id, userId: user.id, label: `${user.name} <${user.email}>`, ip: clientIp(req) };
  if (ipRateLimited(clientIp(req))) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  let ok = false;
  if (mode === 'totp') {
    ok = !!user.totp_secret && verifyTotp(decrypt(user.totp_secret), code);
  } else {
    const codes: string[] = user.recovery_codes ? JSON.parse(decrypt(user.recovery_codes)) : [];
    const hash = sha256(code.trim().toLowerCase());
    if (codes.includes(hash)) {
      ok = true;
      q.run('UPDATE users SET recovery_codes = ? WHERE id = ?', [encrypt(JSON.stringify(codes.filter((c) => c !== hash))), user.id]);
      audit(actor, '2fa', `Recovery code used (${codes.length - 1} left)`);
    }
  }
  if (!ok) {
    audit(actor, 'login-failed', 'Wrong two-factor code');
    throw new HttpError(401, mode === 'totp' ? 'That code is not valid. Check your authenticator app and try again.' : 'That recovery code is not valid or was already used.');
  }
  upgradeSession(sessionId);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  audit(actor, 'login', 'Signed in with two-factor authentication');
  res.json({ stage: 'done' });
});

authRouter.post('/logout', (req, res) => {
  if (req.auth) audit(actorOf(req), 'logout', 'Signed out');
  destroySession(res, req.auth?.sessionId ?? req.pending2fa?.sessionId ?? null);
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  if (!req.auth) {
    res.status(401).json({ error: 'Not signed in', stage: req.pending2fa ? '2fa' : 'login' });
    return;
  }
  res.json({ me: toMe(req.auth.user), csrf: req.auth.csrf });
});

// ── Forgot / reset password ───────────────────────────────────────────────────
authRouter.post('/forgot', async (req, res) => {
  if (ipRateLimited(clientIp(req))) throw new HttpError(429, 'Too many requests. Wait 15 minutes and try again.');
  const email = str(req, 'email', { required: true, max: 254 }).toLowerCase();
  const user = q.get<UserRow>("SELECT * FROM users WHERE email = ? AND status != 'disabled'", [email]);
  if (user) {
    const token = randomToken(32);
    q.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', [sha256(token), user.id, new Date(Date.now() + 3600_000).toISOString()]);
    const url = `${config.baseUrl}/reset-password?token=${token}`;
    await sendMail({
      accountId: user.account_id,
      to: [user.email],
      subject: 'Reset your SortSite Tools password',
      html: brandedEmail({
        heading: 'Reset your password',
        intro: `Hi ${user.name}, we received a request to reset your password. The link below works for one hour.`,
        cta: { label: 'Choose a new password', url },
        footnote: 'If you did not ask for this, you can ignore this email — your password stays the same.',
      }),
    });
    audit({ accountId: user.account_id, userId: user.id, label: user.email, ip: clientIp(req) }, 'password', 'Password reset requested');
  }
  // Same response either way: never reveal whether an account exists.
  res.json({ ok: true });
});

authRouter.post('/reset', (req, res) => {
  const token = str(req, 'token', { required: true, max: 200 });
  const password = str(req, 'password', { required: true, max: 1024, trim: false });
  const row = q.get<{ user_id: number; expires_at: string; used: number }>('SELECT * FROM password_resets WHERE token_hash = ?', [sha256(token)]);
  if (!row || row.used || row.expires_at < nowIso()) throw badRequest('This reset link has expired or was already used. Request a new one.');
  const policy = passwordPolicyError(password);
  if (policy) throw badRequest(policy, [{ path: 'password', message: policy }]);
  const user = q.get<UserRow>('SELECT * FROM users WHERE id = ?', [row.user_id]);
  if (!user) throw badRequest('Account not found.');
  q.run("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = ?", [hashPassword(password), nowIso(), user.id]);
  q.run('UPDATE password_resets SET used = 1 WHERE token_hash = ?', [sha256(token)]);
  destroyUserSessions(user.id);
  audit({ accountId: user.account_id, userId: user.id, label: user.email, ip: clientIp(req) }, 'password', 'Password reset via email link');
  res.json({ ok: true });
});

// ── Signed-in security: password change and 2FA ───────────────────────────────
export const securityRouter = Router();
securityRouter.use(requireAuth);

securityRouter.post('/password', (req, res) => {
  const user = authed(req);
  const current = str(req, 'current', { required: true, trim: false });
  const next = str(req, 'password', { required: true, max: 1024, trim: false });
  const confirm = str(req, 'confirm', { required: true, trim: false });
  if (!verifyPassword(current, user.password_hash)) throw badRequest('Your current password is not correct.', [{ path: 'current', message: 'Incorrect password.' }]);
  if (next !== confirm) throw badRequest('The new passwords do not match.', [{ path: 'confirm', message: 'Does not match the new password.' }]);
  if (next === current) throw badRequest('Choose a password you have not used here before.', [{ path: 'password', message: 'Same as the current password.' }]);
  const policy = passwordPolicyError(next);
  if (policy) throw badRequest(policy, [{ path: 'password', message: policy }]);
  q.run('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?', [hashPassword(next), nowIso(), user.id]);
  destroyUserSessions(user.id, req.auth?.sessionId);
  audit(actorOf(req), 'password', 'Password changed; other sessions signed out');
  res.json({ ok: true });
});

securityRouter.post('/2fa/setup', async (req, res) => {
  const user = authed(req);
  if (user.totp_enabled) throw badRequest('Two-factor authentication is already on.');
  const secret = newTotpSecret();
  q.run('UPDATE users SET totp_secret = ? WHERE id = ?', [encrypt(secret), user.id]);
  const url = otpauthUrl(secret, user.email);
  res.json({ secret, otpauthUrl: url, qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#01027f', light: '#ffffff' } }) });
});

securityRouter.post('/2fa/enable', (req, res) => {
  const user = authed(req);
  const code = str(req, 'code', { required: true, max: 10 });
  if (!user.totp_secret) throw badRequest('Start set-up first.');
  if (!verifyTotp(decrypt(user.totp_secret), code)) throw badRequest('That code did not match. Make sure your phone clock is correct and try the newest code.', [{ path: 'code', message: 'Code did not match.' }]);
  const codes = newRecoveryCodes();
  q.run('UPDATE users SET totp_enabled = 1, recovery_codes = ? WHERE id = ?', [encrypt(JSON.stringify(codes.map((c) => sha256(c)))), user.id]);
  audit(actorOf(req), '2fa', 'Two-factor authentication enabled');
  res.json({ recoveryCodes: codes });
});

securityRouter.post('/2fa/disable', (req, res) => {
  const user = authed(req);
  const password = str(req, 'password', { required: true, trim: false });
  if (!verifyPassword(password, user.password_hash)) throw badRequest('Your password is not correct.', [{ path: 'password', message: 'Incorrect password.' }]);
  q.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL WHERE id = ?', [user.id]);
  audit(actorOf(req), '2fa', 'Two-factor authentication disabled');
  res.json({ ok: true });
});

securityRouter.post('/2fa/recovery-codes', (req, res) => {
  const user = authed(req);
  if (!user.totp_enabled) throw badRequest('Turn on two-factor authentication first.');
  const password = str(req, 'password', { required: true, trim: false });
  if (!verifyPassword(password, user.password_hash)) throw badRequest('Your password is not correct.', [{ path: 'password', message: 'Incorrect password.' }]);
  const codes = newRecoveryCodes();
  q.run('UPDATE users SET recovery_codes = ? WHERE id = ?', [encrypt(JSON.stringify(codes.map((c) => sha256(c)))), user.id]);
  audit(actorOf(req), '2fa', 'Recovery codes regenerated');
  res.json({ recoveryCodes: codes });
});

securityRouter.get('/2fa/status', (req, res) => {
  const user = authed(req);
  const left = user.recovery_codes ? (JSON.parse(decrypt(user.recovery_codes)) as string[]).length : 0;
  res.json({ enabled: !!user.totp_enabled, recoveryCodesLeft: left });
});

securityRouter.get('/sessions', (req, res) => {
  const user = authed(req);
  const rows = q.all<{ id: string; ip: string; user_agent: string; created_at: string; last_seen_at: string }>(
    "SELECT id, ip, user_agent, created_at, last_seen_at FROM sessions WHERE user_id = ? AND stage = 'full' ORDER BY last_seen_at DESC",
    [user.id],
  );
  const current = req.auth?.sessionId ? sha256(req.auth.sessionId) : '';
  res.json(rows.map((r) => ({ ip: r.ip, userAgent: r.user_agent, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === current })));
});

securityRouter.post('/sessions/revoke-others', (req, res) => {
  destroyUserSessions(authed(req).id, req.auth?.sessionId);
  audit(actorOf(req), 'login', 'Signed out all other sessions');
  res.json({ ok: true });
});
