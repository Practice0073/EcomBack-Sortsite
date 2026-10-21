import type { ScanOptions } from '../../shared/options.js';
import type { RenderResult } from './browser.js';
import type { CheerioDoc, SourceMap } from './source.js';
import type { Finding } from './rules/types.js';

/** Everything an analyzer may inspect for one HTML page. */
export interface PageContext {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  /** Original server response (line numbers refer to this). */
  raw: string;
  src: SourceMap;
  $raw: CheerioDoc;
  /** Post-JavaScript DOM (when rendered), otherwise the raw document. */
  $dom: CheerioDoc;
  rendered: RenderResult | null;
  /** Chrome was available but this page could not be rendered (timeout, network); see the render-failed diagnostic. */
  renderFailed: boolean;
  options: ScanOptions;
  shopify: boolean;
  isHome: boolean;
  text: string;
  redirects: { url: string; status: number }[];
}

export type Analyzer = (ctx: PageContext) => Finding[] | Promise<Finding[]>;
