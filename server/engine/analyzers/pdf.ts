import type { Finding } from '../rules/types.js';

/**
 * Lightweight PDF/UA-1 checks on the raw file: tagging, language, title, text layer.
 * Compressed object streams can hide some keys, so absence is checked conservatively.
 */
export function pdfAnalyzer(buf: Buffer): Finding[] {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (!head.startsWith('%PDF')) return [];
  const text = buf.toString('latin1');
  const out: Finding[] = [];
  const objectStreams = /\/Type\s*\/ObjStm/.test(text);
  const tagged = /\/StructTreeRoot/.test(text) && /\/Marked\s+true/.test(text);
  if (!tagged && !(objectStreams && /\/StructTreeRoot/.test(text))) out.push({ ruleId: 'accessibility.pdf-untagged' });
  if (!/\/Lang\s*\(/.test(text) && !objectStreams) out.push({ ruleId: 'accessibility.pdf-no-lang' });
  const hasTitle = /\/Title\s*[(<]/.test(text) || /<dc:title>/.test(text);
  const displays = /\/DisplayDocTitle\s+true/.test(text);
  if ((!hasTitle || !displays) && !objectStreams) out.push({ ruleId: 'accessibility.pdf-no-title', detail: !hasTitle ? 'No title in document properties' : 'Title is set but DisplayDocTitle is not enabled' });
  if (!/\/Font\b/.test(text) && /\/Subtype\s*\/Image/.test(text) && !objectStreams) out.push({ ruleId: 'accessibility.pdf-image-only' });
  return out;
}
