import { DEFAULT_SCAN_OPTIONS, SECRET_MASK, SECRET_OPTION_PATHS, mergeOptions, type ScanOptions } from '../../shared/options.js';
import { decrypt, encrypt } from './crypto.js';

type Path = (typeof SECRET_OPTION_PATHS)[number];

function getAt(o: ScanOptions, path: Path): string {
  const [a, b] = path.split('.') as ['crawler', keyof ScanOptions['crawler']];
  return String(o[a][b] ?? '');
}
function setAt(o: ScanOptions, path: Path, v: string) {
  const [a, b] = path.split('.') as ['crawler', keyof ScanOptions['crawler']];
  (o[a] as unknown as Record<string, unknown>)[b] = v;
}

/** Options as stored in the database: secrets encrypted with AES-256-GCM. */
export function sealOptions(o: ScanOptions): string {
  const copy = structuredClone(o);
  for (const p of SECRET_OPTION_PATHS) setAt(copy, p, encrypt(getAt(copy, p)));
  return JSON.stringify(copy);
}

export function openOptions(json: string | null | undefined): ScanOptions {
  const o = mergeOptions(json ? JSON.parse(json) : {}, DEFAULT_SCAN_OPTIONS);
  for (const p of SECRET_OPTION_PATHS) setAt(o, p, decrypt(getAt(o, p)));
  return o;
}

/** For API responses: secrets are never sent back to the browser. */
export function maskOptions(o: ScanOptions): ScanOptions {
  const copy = structuredClone(o);
  for (const p of SECRET_OPTION_PATHS) if (getAt(copy, p)) setAt(copy, p, SECRET_MASK);
  return copy;
}

/** Merge incoming edited options; a field still showing the mask keeps its stored secret. */
export function applyIncoming(stored: ScanOptions, incoming: unknown): ScanOptions {
  const next = mergeOptions(incoming, stored);
  for (const p of SECRET_OPTION_PATHS) if (getAt(next, p) === SECRET_MASK) setAt(next, p, getAt(stored, p));
  return next;
}
