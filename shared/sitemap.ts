import type { ScanOptions } from './options';

export interface SitemapOptions {
  scope: 'site' | 'folder';
  maxPages: number;
  depthMode: 'entire' | 'limited';
  maxDepth: number;
  blocks: string;
  obeyRobots: boolean;
  includeImages: boolean;
  schedule: ScanOptions['schedule'];
}

export const DEFAULT_SITEMAP_OPTIONS: SitemapOptions = {
  scope: 'site',
  maxPages: 500,
  depthMode: 'entire',
  maxDepth: 5,
  blocks: '',
  obeyRobots: true,
  includeImages: false,
  schedule: { frequency: 'none', startDate: '', time: '03:00', emailTo: 'nobody', customEmails: '' },
};

export interface SitemapNode {
  url: string;
  parentUrl: string | null;
  title: string | null;
  status: number | null;
  depth: number;
  contentType: string | null;
}
