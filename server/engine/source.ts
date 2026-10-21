import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** Fast offset → line lookup over the original page source. */
export class SourceMap {
  private starts: number[] = [0];
  private lower: string;
  constructor(readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
    this.lower = text.toLowerCase();
  }

  lineAt(offset: number): number {
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** Line of the first occurrence of a plain string (case-insensitive), or null. */
  find(needle: string, from = 0): number | null {
    if (!needle) return null;
    const i = this.lower.indexOf(needle.toLowerCase(), from);
    return i < 0 ? null : this.lineAt(i);
  }

  /**
   * Locate an element (given as rendered outerHTML) in the original source. Strategy, most to least specific:
   * a unique exact opening tag, the element's own text, a distinctive attribute value. Ambiguous matches return
   * null — no line is better than a wrong line. Elements created by JavaScript have no source line.
   */
  locate(outerHtml: string): number | null {
    const html = outerHtml.trim();
    const open = /^<([a-z0-9-]+)\b[^>]*>/i.exec(html);
    if (!open) return null;
    const tag = open[1]!.toLowerCase();
    const openLower = open[0].toLowerCase();

    const first = this.lower.indexOf(openLower);
    if (first >= 0 && this.lower.indexOf(openLower, first + 1) < 0) return this.lineAt(first);

    // Own text (e.g. <b>Free Penguins</b>): find the text, then the nearest preceding <tag.
    const text = html.slice(open[0].length).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase();
    if (text.length >= 4) {
      const words = text.split(' ').filter(Boolean);
      const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:\\s|<[^>]*>)+'), 'g');
      const hits = [...this.lower.matchAll(pattern)];
      if (hits.length === 1) {
        const at = hits[0]!.index!;
        const tagStart = this.lower.lastIndexOf(`<${tag}`, at);
        if (tagStart >= 0 && at - tagStart < 2000) return this.lineAt(tagStart);
      }
    }

    for (const attr of ['id', 'href', 'src', 'name', 'for', 'action', 'aria-label', 'class']) {
      const m = new RegExp(`\\s${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(open[0]);
      const value = m?.[2] ?? m?.[3] ?? m?.[4];
      if (!value || value.length < 3) continue;
      const needle = (attr === 'class' ? value.split(/\s+/)[0]! : value).toLowerCase();
      const lines = new Set<number>();
      let idx = this.lower.indexOf(needle);
      while (idx >= 0 && lines.size < 2) {
        const tagStart = this.lower.lastIndexOf('<', idx);
        if (tagStart >= 0 && this.lower.startsWith(`<${tag}`, tagStart) && !this.lower.slice(tagStart, idx).includes('>')) lines.add(this.lineAt(tagStart));
        idx = this.lower.indexOf(needle, idx + 1);
      }
      if (lines.size === 1) return [...lines][0]!;
    }
    return first >= 0 && html.length > open[0].length ? null : first >= 0 ? this.lineAt(first) : null;
  }
}

/** Parse with source locations so findings from the raw document carry exact line numbers. */
export const loadWithLocations = (html: string) => cheerio.load(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });

export type CheerioDoc = ReturnType<typeof loadWithLocations>;

export function lineOf(node: AnyNode | undefined): number | null {
  const loc = (node as Element | undefined)?.sourceCodeLocation;
  return loc?.startLine ?? null;
}

export function snippetOf($: CheerioDoc, node: AnyNode, max = 300): string {
  const html = $.html(node) ?? '';
  const open = /^<[^>]+>/.exec(html)?.[0] ?? html;
  return (html.length <= max ? html : `${open}${html.length > open.length ? '…' : ''}`).slice(0, max);
}

/** Visible text of a document (skips scripts, styles, templates, hidden and aria-hidden content). */
export function visibleText($: CheerioDoc): string {
  const clone = $.root().clone();
  clone.find('script,style,noscript,template,svg,code,pre,[hidden],[aria-hidden="true"],.visually-hidden,.sr-only').remove();
  return clone.find('body').text().replace(/\s+/g, ' ').trim();
}

/** Readability metrics: Flesch reading ease and Flesch–Kincaid grade. */
export function readability(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
  const words = text.match(/[A-Za-zÀ-ÿ'’-]+/g) ?? [];
  if (words.length < 100 || sentences.length < 3) return null;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const wps = words.length / sentences.length;
  const spw = syllables / words.length;
  return {
    words: words.length,
    sentences: sentences.length,
    ease: Math.round((206.835 - 1.015 * wps - 84.6 * spw) * 10) / 10,
    grade: Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10,
    longSentences: sentences.filter((s) => s.split(/\s+/).length > 30),
  };
}

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}
