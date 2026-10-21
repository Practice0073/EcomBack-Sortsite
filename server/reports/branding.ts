import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { q } from '../db/index.js';

export const PRODUCT_NAME = 'SortSite Tools by Ecomback';
export const FOOTER_TEXT = 'SortSite Tools by Ecomback';

export const BRAND = {
  navy: '#01027F',
  coral: '#F44C35',
  red: '#AF1C08',
  amber: '#B45309',
  amberDot: '#F59E0B',
  green: '#15803D',
  ink: '#0D0E10',
  muted: '#5B6170',
  line: '#E3E5EE',
  soft: '#F3F4F8',
} as const;

const MIME: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function readAsset(name: string): Buffer {
  return fs.readFileSync(path.join(config.assetsDir, name));
}

let cache: { logoSvg: Buffer; logoPng: Buffer; iconPng: Buffer } | null = null;
export function brandAssets() {
  cache ??= { logoSvg: readAsset('ecomback-logo.svg'), logoPng: readAsset('ecomback-logo.png'), iconPng: readAsset('ecomback-icon.png') };
  return cache;
}

export const toDataUri = (buf: Buffer, mime: string) => `data:${mime};base64,${buf.toString('base64')}`;

export function logoDataUri(): string {
  return toDataUri(brandAssets().logoSvg, 'image/svg+xml');
}

export interface ClientBrand { name: string; logo: { data: Buffer; mime: string; dataUri: string } | null }

/** Client workspace branding (white-label reports, Plan.md §15). */
export function clientBrand(clientId: number | null): ClientBrand | null {
  if (!clientId) return null;
  const c = q.get<{ name: string; logo_path: string | null }>('SELECT name, logo_path FROM clients WHERE id = ?', [clientId]);
  if (!c) return null;
  let logo: ClientBrand['logo'] = null;
  if (c.logo_path) {
    const file = path.isAbsolute(c.logo_path) ? c.logo_path : path.join(config.uploadsDir, c.logo_path);
    const mime = MIME[path.extname(file).toLowerCase()];
    if (mime && fs.existsSync(file)) {
      const data = fs.readFileSync(file);
      logo = { data, mime, dataUri: toDataUri(data, mime) };
    }
  }
  return { name: c.name, logo };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};
