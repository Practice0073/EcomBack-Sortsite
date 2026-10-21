import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from '../config.js';

// ── Encryption at rest for stored secrets (AES-256-GCM) ───────────────────────
function loadKey(): Buffer {
  if (process.env.SECRET_KEY) return crypto.createHash('sha256').update(process.env.SECRET_KEY).digest();
  if (!fs.existsSync(config.secretKeyFile)) {
    fs.writeFileSync(config.secretKeyFile, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(config.secretKeyFile, 'utf8').trim(), 'base64');
}
const key = loadKey();

export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')}`;
}

export function decrypt(value: string): string {
  if (!value?.startsWith('enc:v1:')) return value ?? '';
  const raw = Buffer.from(value.slice(7), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// ── Password hashing (scrypt) ─────────────────────────────────────────────────
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return crypto.timingSafeEqual(expected, actual);
}

/** Plan.md §2.8: passphrase of 16+ characters, or 8+ with mixed case and digits or punctuation. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length >= 16) return null;
  if (pw.length < 8) return 'Use a passphrase of 16+ characters, or 8+ characters with mixed case and digits or punctuation.';
  const mixed = /[a-z]/.test(pw) && /[A-Z]/.test(pw);
  const digitOrPunct = /[\d\p{P}\p{S}]/u.test(pw);
  return mixed && digitOrPunct ? null : 'Passwords under 16 characters need upper and lower case letters plus a digit or punctuation.';
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// ── TOTP (RFC 6238) ───────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

export function totpNow(secretB32: string, at = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 30000));
}

/** Accepts the current code and one step either side for clock drift. */
export function verifyTotp(secretB32: string, code: string): boolean {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretB32);
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(hotp(secret, step + d)), Buffer.from(clean)));
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`SortSite Tools by Ecomback:${email}`)}?secret=${secret}&issuer=${encodeURIComponent('SortSite Tools by Ecomback')}&algorithm=SHA1&digits=6&period=30`;

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const s = crypto.randomBytes(5).toString('hex');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
