import { HtmlValidate, type Message } from 'html-validate';
import * as csstree from 'css-tree';
import { registerRule, getRule } from '../rules/catalog.js';
import type { Finding } from '../rules/types.js';
import type { PageContext } from '../context.js';
import { lineOf } from '../source.js';

/** html-validate rules that duplicate axe-core accessibility checks or are pure style preferences. */
const DISABLED_HTML_RULES: Record<string, 'off'> = {
  'wcag/h30': 'off',
  'wcag/h32': 'off',
  'wcag/h36': 'off',
  'wcag/h37': 'off',
  'wcag/h63': 'off',
  'wcag/h67': 'off',
  'wcag/h71': 'off',
  'text-content': 'off',
  'no-redundant-role': 'off',
  'prefer-native-element': 'off',
  'hidden-focusable': 'off',
  'unique-landmark': 'off',
  'empty-heading': 'off',
  'empty-title': 'off',
  'input-missing-label': 'off',
  'no-inline-style': 'off',
  'long-title': 'off',
};
const OBSOLETE_RULES = new Set(['deprecated', 'no-deprecated-attr', 'deprecated-rule']);

const validator = new HtmlValidate({ extends: ['html-validate:standard'], rules: DISABLED_HTML_RULES });

const TITLES: Record<string, string> = {
  'no-dup-id': 'Duplicate id attribute',
  'close-order': 'Elements closed in the wrong order',
  'close-attr': 'Attributes on a closing tag',
  'element-permitted-content': 'Element not allowed here',
  'element-permitted-parent': 'Element has a disallowed parent',
  'element-permitted-order': 'Elements in the wrong order',
  'element-permitted-occurrences': 'Element appears too many times',
  'element-required-attributes': 'Required attribute missing',
  'element-required-content': 'Required child element missing',
  'element-name': 'Invalid element name',
  'attribute-allowed-values': 'Attribute has an invalid value',
  'attribute-misuse': 'Attribute used incorrectly',
  'no-dup-attr': 'Duplicate attribute',
  'no-dup-class': 'Duplicate class name',
  'no-raw-characters': 'Unescaped special character',
  'unrecognized-char-ref': 'Unknown character reference',
  'parser-error': 'HTML parse error',
  'no-unknown-elements': 'Unknown element',
  'void-content': 'Content inside a void element',
  'valid-id': 'Invalid id value',
  'map-id-name': 'Image map id and name differ',
  'form-dup-name': 'Duplicate form control name',
  'multiple-labeled-controls': 'Label is associated with several controls',
  'no-implicit-close': 'Element closed implicitly',
  'no-missing-references': 'Reference to a missing id',
  'script-type': 'Unnecessary script type',
  'doctype-html': 'DOCTYPE is not <!doctype html>',
  'missing-doctype': 'DOCTYPE missing',
  'no-conditional-comment': 'IE conditional comment',
  deprecated: 'Obsolete element',
  'no-deprecated-attr': 'Obsolete attribute',
  'unclosed-element': 'Element not closed',
  'element-case': 'Element name not lowercase',
  'attr-case': 'Attribute name not lowercase',
  'attr-spacing': 'Attributes not separated by whitespace',
  'attr-quotes': 'Attribute quoting inconsistent',
  'no-self-closing': 'Self-closing syntax on a non-void element',
  'void-style': 'Void element style inconsistent',
  'area-alt': 'Image map area without alt text',
  'allowed-links': 'Link format not allowed',
  'heading-level': 'Heading levels skip',
  'no-utf8-bom': 'File starts with a UTF-8 byte order mark',
  'meta-refresh': 'Meta refresh used',
};

const docCache = new Map<string, Promise<{ description: string; url: string | null }>>();
async function htmlRule(ruleId: string, severity: number, context: unknown) {
  const id = `standards.html.${ruleId}`;
  const existing = getRule(id);
  if (existing) return existing;
  let doc = docCache.get(ruleId);
  if (!doc) {
    // Some rules (e.g. "deprecated") build their documentation from the message context.
    doc = validator
      .getContextualDocumentation({ ruleId, context })
      .then((d) => ({ description: d?.description ?? '', url: d?.url ?? `https://html-validate.org/rules/${ruleId}.html` }))
      .catch(() => ({ description: '', url: `https://html-validate.org/rules/${ruleId}.html` }));
    docCache.set(ruleId, doc);
  }
  const d = await doc;
  const obsolete = OBSOLETE_RULES.has(ruleId);
  return registerRule({
    id,
    category: 'standards',
    severity: obsolete ? 'other' : severity >= 2 ? 'other' : 'warning',
    section: obsolete ? 'Obsolete features' : 'HTML validation',
    title: TITLES[ruleId] ?? `HTML: ${ruleId.replace(/[-/]/g, ' ')}`,
    // Contextual docs for obsolete-markup rules name one specific element, so use a generic description.
    description: obsolete
      ? 'The page uses an element or attribute that is obsolete in the HTML Living Standard. Browsers may still render it, but it is no longer supported for new content and is often inaccessible.'
      : (d.description || 'The markup does not follow the HTML Living Standard.').replace(/\s+/g, ' ').slice(0, 600),
    fix: obsolete ? 'Replace the obsolete markup with modern HTML and CSS.' : 'Correct the markup at the reported line. In Shopify, the line usually maps to a section or snippet in the theme.',
    guidelines: [{ label: 'HTML Living Standard', url: 'https://html.spec.whatwg.org/multipage/' }, { label: `html-validate ${ruleId}`, url: d.url }],
    effortMinutes: obsolete ? 15 : 5,
    helpUrl: d.url,
  });
}

const LEGACY_DOCTYPE = /<!doctype\s+html\s+public|<!doctype\s+html\s+system/i;

export async function standardsAnalyzer(ctx: PageContext): Promise<Finding[]> {
  const o = ctx.options.rules.standards;
  if (!o.enabled) return [];
  const out: Finding[] = [];
  const head = ctx.raw.slice(0, 2000).replace(/^﻿/, '').trimStart();
  const doctype = /^<!doctype[^>]*>/i.exec(head)?.[0];
  const legacy = !!doctype && LEGACY_DOCTYPE.test(doctype);
  if (!doctype) out.push({ ruleId: 'standards.doctype-missing', line: 1 });
  else if (legacy) out.push({ ruleId: o.legacyDoctype === 'legacy' ? 'standards.doctype-legacy' : 'standards.doctype-legacy-modern', line: 1, snippet: doctype });

  if (o.validateHtml || o.obsoleteFeatures) {
    let messages: Message[] = [];
    try {
      const report = await validator.validateString(ctx.raw, ctx.url);
      messages = report.results[0]?.messages ?? [];
    } catch (e) {
      console.warn('[standards] html-validate failed', ctx.url, (e as Error).message);
    }
    for (const m of messages.slice(0, 400)) {
      if (!m.ruleId) continue;
      if (legacy && o.legacyDoctype === 'legacy' && ['doctype-html', 'no-self-closing', 'void-style', 'element-case', 'attr-case'].includes(m.ruleId)) continue;
      if (['doctype-html', 'missing-doctype'].includes(m.ruleId)) continue; // covered by the DOCTYPE rules above
      const obsolete = OBSOLETE_RULES.has(m.ruleId);
      if (obsolete ? !o.obsoleteFeatures : !o.validateHtml) continue;
      const rule = await htmlRule(m.ruleId, m.severity, m.context);
      out.push({ ruleId: rule.id, line: m.line, snippet: excerpt(ctx.raw, m.offset, m.size), selector: m.selector, detail: m.message });
    }
  }

  if (o.validateCss) {
    ctx.$raw('style').each((_, el) => {
      out.push(...validateCss(ctx.$raw(el).text(), (lineOf(el) ?? 1) - 1));
    });
  }
  return out;
}

/** CSS syntax and property/value validation with css-tree's W3C grammar. */
export function validateCss(css: string, lineOffset = 0): Finding[] {
  const out: Finding[] = [];
  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, {
      positions: true,
      onParseError: (e) => {
        if (out.length < 200) out.push({ ruleId: 'standards.css-syntax', line: ((e as unknown as { line?: number }).line ?? 1) + lineOffset, detail: e.message, snippet: lineText(css, (e as unknown as { line?: number }).line ?? 1) });
      },
    });
  } catch (e) {
    return [{ ruleId: 'standards.css-syntax', line: 1 + lineOffset, detail: (e as Error).message }];
  }
  csstree.walk(ast, {
    visit: 'Declaration',
    enter(node: csstree.Declaration) {
      if (out.length >= 300) return;
      const prop = node.property;
      if (prop.startsWith('--') || /^-[a-z]+-/.test(prop) || prop.startsWith('*') || prop.startsWith('_')) return; // custom, vendor, IE hacks
      const valueText = csstree.generate(node.value);
      if (/var\(|env\(|attr\(|!ie|expression\(/i.test(valueText)) return;
      const m = csstree.lexer.matchProperty(prop, node.value);
      if (!m.error) return;
      const line = (node.loc?.start.line ?? 1) + lineOffset;
      if (m.error.name === 'SyntaxReferenceError') out.push({ ruleId: 'standards.css-unknown-property', line, snippet: `${prop}: ${valueText}`.slice(0, 200), detail: `Unknown property "${prop}"` });
      else if (m.error.name === 'SyntaxMatchError') out.push({ ruleId: 'standards.css-invalid-value', line, snippet: `${prop}: ${valueText}`.slice(0, 200), detail: `"${valueText.slice(0, 80)}" is not a valid value for ${prop}` });
    },
  });
  return out;
}

function excerpt(src: string, offset: number, size: number): string {
  const start = src.lastIndexOf('<', offset);
  const from = start >= 0 && offset - start < 200 ? start : offset;
  return src.slice(from, Math.min(src.length, from + Math.max(size, 120), from + 300)).replace(/\s+/g, ' ');
}

const lineText = (src: string, line: number) => (src.split('\n')[line - 1] ?? '').trim().slice(0, 200);
