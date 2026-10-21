/**
 * In-page checks for WCAG failure techniques that need the CSS cascade, implemented from the W3C
 * technique documents (not from any vendor's rule text):
 *
 *   F24  (1.4.3, 1.4.6, 1.4.8) foreground colour specified without a background colour, or vice versa.
 *        "Check whether an author-specified foreground colour is present … background colour is present."
 *        A background on an ancestor satisfies it (colours are inherited / backgrounds are transparent).
 *   F78  (2.4.7) the focus indicator is turned off (e.g. :focus { outline: none }) with no replacement.
 *   2.2.2 (Pause, Stop, Hide) CSS animation that starts automatically and lasts more than 5 seconds with no
 *        pause/stop control. prefers-reduced-motion is noted but does not exempt it: it is a sufficient
 *        technique for 2.3.3 (AAA), not for 2.2.2.
 *   F87  (1.3.1) meaningful text inserted with CSS ::before / ::after content.
 *
 * Runs in the page with page.evaluate. Cross-origin stylesheets can't be read through CSSOM, so their
 * text is fetched by the scanner and parsed here with constructable stylesheets (never applied).
 */
import type { Page } from 'puppeteer-core';

export interface CssFinding { technique: 'F24' | 'F78' | 'anim' | 'F87'; html: string; selector: string; detail: string }

/** The TS runtime wraps functions with a __name helper; make sure it exists in the page before evaluating. */
const NAME_SHIM = 'globalThis.__name = globalThis.__name || ((fn) => fn);';

export async function unreadableStylesheets(page: Page): Promise<string[]> {
  await page.evaluate(NAME_SHIM);
  return page.evaluate(() => {
    const out: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        void sheet.cssRules;
      } catch {
        if (sheet.href) out.push(sheet.href);
      }
    }
    return out;
  });
}

export async function runCssTechniques(page: Page, externalCss: string[], externalNames: string[] = []): Promise<CssFinding[]> {
  await page.evaluate(NAME_SHIM);
  return page.evaluate((extraCss: string[], extraNames: string[]) => {
    const MAX_PER_TECHNIQUE = 40;
    const sel = (el: Element): string => {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur !== document.documentElement && parts.length < 5) {
        const parent: Element | null = cur.parentElement;
        const idx = parent ? Array.from(parent.children).filter((c) => c.tagName === cur!.tagName).indexOf(cur) + 1 : 1;
        parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${idx})`);
        cur = parent;
      }
      return parts.join(' > ');
    };
    const html = (el: Element) => el.outerHTML.slice(0, 600);
    const visible = (el: Element) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const hasOwnText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && /\S/.test(n.textContent ?? ''));

    // ── Collect author style rules (readable sheets + fetched cross-origin sheets), honouring @media.
    interface Rule { selector: string; style: CSSStyleDeclaration; reducedMotion: boolean; source: string }
    const rules: Rule[] = [];
    const sourceName = (href: string | null | undefined) => (href ? (href.split('?')[0] ?? href).split('/').pop() || href : 'an inline style block');
    let currentSource = '';
    const walk = (list: CSSRuleList, reducedMotion: boolean) => {
      for (const r of Array.from(list)) {
        if (r instanceof CSSStyleRule) {
          rules.push({ selector: r.selectorText, style: r.style, reducedMotion, source: currentSource });
          if (r.cssRules?.length) walk(r.cssRules, reducedMotion); // CSS nesting
        } else if (r instanceof CSSMediaRule) {
          const cond = r.conditionText || r.media.mediaText;
          const rm = /prefers-reduced-motion\s*:\s*reduce/i.test(cond);
          if (/^\s*print\b/i.test(cond)) continue;
          if (rm || window.matchMedia(cond).matches) walk(r.cssRules, reducedMotion || rm);
        } else if (r instanceof CSSSupportsRule || (typeof CSSLayerBlockRule !== 'undefined' && r instanceof CSSLayerBlockRule) || (typeof CSSContainerRule !== 'undefined' && r instanceof CSSContainerRule)) {
          walk((r as CSSGroupingRule).cssRules, reducedMotion);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.media.mediaText && !window.matchMedia(sheet.media.mediaText).matches && !/prefers-reduced-motion/.test(sheet.media.mediaText)) continue;
        currentSource = sourceName(sheet.href);
        walk(sheet.cssRules, /prefers-reduced-motion\s*:\s*reduce/i.test(sheet.media.mediaText));
      } catch {
        /* cross-origin: handled through extraCss */
      }
    }
    for (const [i, text] of extraCss.entries()) {
      currentSource = extraNames[i] ?? 'an external stylesheet';
      try {
        const s = new CSSStyleSheet();
        s.replaceSync(text.replace(/@import[^;]+;/g, ''));
        walk(s.cssRules, false);
      } catch {
        /* unparsable stylesheet */
      }
    }

    // Structural part of a selector: dynamic pseudo-classes removed so we can ask "which elements could this style?"
    const DYNAMIC = /:(hover|focus-visible|focus-within|focus|active|visited|link|target|any-link)\b/g;
    const PSEUDO_EL = /::?(before|after|placeholder|selection|marker|first-line|first-letter|backdrop|-webkit-[\w-]+|-moz-[\w-]+)\b.*$/;
    const structural = (s: string) => s.replace(DYNAMIC, '').replace(/\(\s*\)/g, '').trim() || '*';
    const matches = (selector: string): Element[] => {
      const out: Element[] = [];
      for (const part of selector.split(',')) {
        if (PSEUDO_EL.test(part)) continue;
        const s = structural(part);
        try {
          out.push(...Array.from(document.querySelectorAll(s)));
        } catch {
          /* selector the browser can't evaluate */
        }
      }
      return out;
    };
    const isColourValue = (v: string) => !!v && !/^(inherit|initial|unset|revert|revert-layer|currentcolor)$/i.test(v.trim());

    const findings: { technique: 'F24' | 'F78' | 'anim' | 'F87'; html: string; selector: string; detail: string }[] = [];
    const push = (technique: 'F24' | 'F78' | 'anim' | 'F87', el: Element, detail: string) => {
      if (findings.filter((f) => f.technique === technique).length >= MAX_PER_TECHNIQUE) return;
      findings.push({ technique, html: html(el), selector: sel(el), detail });
    };

    // ── F24: colour from browser settings on an author background, or author colour with no author background.
    // Links are coloured by the browser's own :link/:visited rule, so a link's colour is author-specified only
    // when an author rule (or HTML colour attribute) matches the link itself; other text inherits from the
    // nearest coloured ancestor. Backgrounds are transparent, so an author background on any ancestor counts.
    const fg = new Map<Element, string>();
    const bg = new Map<Element, string>();
    const sheetOf = (r: Rule) => r.source;
    for (const r of rules) {
      if (r.reducedMotion) continue;
      const hasFg = isColourValue(r.style.getPropertyValue('color'));
      const bgc = r.style.getPropertyValue('background-color');
      const bgi = r.style.getPropertyValue('background-image');
      const bgShort = r.style.getPropertyValue('background');
      const hasBg = (isColourValue(bgc) && !/^transparent$/i.test(bgc.trim())) || (!!bgi && bgi !== 'none' && bgi !== 'initial') || (!!bgShort && !/^(none|initial|inherit|unset|transparent)$/i.test(bgShort.trim()));
      if (!hasFg && !hasBg) continue;
      for (const el of matches(r.selector)) {
        if (hasFg && !fg.has(el)) fg.set(el, sheetOf(r));
        if (hasBg && !bg.has(el)) bg.set(el, sheetOf(r));
      }
    }
    for (const el of Array.from(document.querySelectorAll('[style], [bgcolor], font[color], body[text], body[link]'))) {
      const st = (el as HTMLElement).style;
      if (isColourValue(st.color) || el.hasAttribute('color') || el.hasAttribute('text')) fg.set(el, 'HTML');
      if ((isColourValue(st.backgroundColor) && st.backgroundColor !== 'transparent') || (st.backgroundImage && st.backgroundImage !== 'none') || el.hasAttribute('bgcolor')) bg.set(el, 'HTML');
    }
    const bodyLinkAttr = document.body?.hasAttribute('link');
    const isLink = (el: Element) => el.matches('a[href], area[href]');
    /** Where the text colour of el comes from: an author source, or null for the browser default. */
    const fgSource = (el: Element): string | null => {
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        if (fg.has(cur)) return fg.get(cur)!;
        if (isLink(cur)) return bodyLinkAttr ? 'HTML' : null; // browser :link colour stops inheritance
      }
      return null;
    };
    const bgSource = (el: Element): string | null => {
      for (let cur: Element | null = el; cur; cur = cur.parentElement) if (bg.has(cur)) return bg.get(cur)!;
      return null;
    };
    for (const el of Array.from(document.querySelectorAll('body, body *'))) {
      if (!hasOwnText(el) || el.closest('svg, script, style, noscript, template, title')) continue;
      const f = fgSource(el);
      const b = bgSource(el);
      if (!!f === !!b) continue;
      const colours = getComputedStyle(el);
      push('F24', el, f ? `Text colour ${colours.color} is set in ${f}, but no background colour is set for this element or any ancestor.` : `Text colour ${colours.color} comes from the browser's default settings, but the background is set in ${b}.`);
    }

    // ── F78: focus indicator removed without a replacement.
    const focusable = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    const removesOutline = (st: CSSStyleDeclaration) => {
      const o = st.getPropertyValue('outline').trim();
      const os = st.getPropertyValue('outline-style').trim();
      const ow = st.getPropertyValue('outline-width').trim();
      return /^(none|0|0px)\b/.test(o) || os === 'none' || /^0(px)?$/.test(ow);
    };
    const indicates = (st: CSSStyleDeclaration) =>
      (!!st.getPropertyValue('outline') && !removesOutline(st)) ||
      (!!st.getPropertyValue('outline-style') && st.getPropertyValue('outline-style') !== 'none') ||
      (!!st.getPropertyValue('box-shadow') && st.getPropertyValue('box-shadow') !== 'none') ||
      ['border', 'border-color', 'border-bottom', 'border-bottom-color', 'background', 'background-color', 'text-decoration', 'text-decoration-line', 'color'].some((p) => !!st.getPropertyValue(p));
    const removedOn = new Set<Element>();
    const replacedOn = new Set<Element>();
    for (const r of rules) {
      const isFocusRule = /:focus/.test(r.selector);
      // outline: none applies in every state, focus included, unless a :focus rule restores an indicator.
      if (removesOutline(r.style)) {
        for (const el of matches(r.selector)) if (el.matches(focusable)) removedOn.add(el);
      }
      if (isFocusRule && indicates(r.style)) for (const el of matches(r.selector)) replacedOn.add(el);
    }
    // A focus outline drawn in the colour of the background behind the link cannot be seen. Each visible
    // link is focused and its computed outline compared with the background. A decorative border is not
    // flagged: the outline is drawn outside it.
    const effectiveBg = (el: Element): string => {
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const bg = getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return bg;
      }
      return 'rgb(255, 255, 255)';
    };
    const previouslyFocused = document.activeElement as HTMLElement | null;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('a[href]')).filter(visible).slice(0, 400)) {
      el.focus({ preventScroll: true });
      const cs = getComputedStyle(el);
      if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && cs.outlineColor === effectiveBg(el)) {
        push('F78', el, `The focus outline colour ${cs.outlineColor} matches the background, so the keyboard focus outline cannot be seen.`);
      }
      el.blur();
    }
    previouslyFocused?.focus?.({ preventScroll: true });
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`${focusable}`))) {
      if (el.getAttribute('style') && removesOutline(el.style)) removedOn.add(el);
    }
    for (const el of removedOn) {
      if (!replacedOn.has(el) && visible(el)) push('F78', el, 'The focus outline is removed (outline: none / 0) and no other focus style (outline, box-shadow, border, background, underline or colour) is defined.');
    }

    // ── 2.2.2: automatic CSS animation longer than 5 s without a prefers-reduced-motion alternative.
    const reducedTargets = new Set<Element>();
    for (const r of rules) {
      if (!r.reducedMotion) continue;
      const a = `${r.style.getPropertyValue('animation')} ${r.style.getPropertyValue('animation-name')} ${r.style.getPropertyValue('animation-duration')} ${r.style.getPropertyValue('animation-play-state')} ${r.style.getPropertyValue('animation-iteration-count')}`;
      if (/none|paused|\b0s\b|\b0\.0*1?m?s\b|\b1\b/.test(a)) for (const el of matches(r.selector)) reducedTargets.add(el);
    }
    const secs = (v: string) => (v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v)) || 0;
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      if (!cs.animationName || cs.animationName === 'none' || cs.animationPlayState.split(',').every((s) => s.trim() === 'paused')) continue;
      const names = cs.animationName.split(',');
      const durations = cs.animationDuration.split(',');
      const counts = cs.animationIterationCount.split(',');
      const longest = names.reduce((max, _n, i) => {
        const d = secs((durations[i % durations.length] ?? '0s').trim());
        const c = (counts[i % counts.length] ?? '1').trim();
        return Math.max(max, c === 'infinite' ? Infinity : d * (parseFloat(c) || 1));
      }, 0);
      if (longest <= 5 || !visible(el)) continue;
      // An ancestor already reported for the same animation covers its children.
      if (findings.some((f) => f.technique === 'anim' && f.selector && document.querySelector(f.selector)?.contains(el))) continue;
      // prefers-reduced-motion only helps people who set it; 2.2.2 needs a pause/stop mechanism for everyone.
      const rm = reducedTargets.has(el) || Array.from(reducedTargets).some((t) => t.contains(el));
      push('anim', el, `Animation "${cs.animationName}" runs ${longest === Infinity ? 'indefinitely' : `${longest.toFixed(1)} s`} and starts automatically with no pause or stop control${rm ? ' (a prefers-reduced-motion rule exists, but 2.2.2 needs a control for everyone)' : ''}.`);
    }

    // ── F87: meaningful text inserted with CSS ::before/::after.
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      for (const pseudo of ['::before', '::after'] as const) {
        const content = getComputedStyle(el, pseudo).content;
        if (!content || content === 'none' || content === 'normal') continue;
        const m = /^"(.*)"$/s.exec(content);
        if (!m) continue; // counters, attr(), images, quotes keywords
        const text = m[1]!.replace(/\\[0-9a-f]{1,6}\s?/gi, (e) => String.fromCodePoint(parseInt(e.slice(1), 16)));
        // Real words (2+ letters) only: icon-font glyphs (private use area), arrows and punctuation are decorative.
        const letters = text.replace(/[-]/g, '').match(/\p{L}{2,}/gu);
        if (!letters || !visible(el)) continue;
        push('F87', el, `Text "${text.trim().slice(0, 60)}" is inserted with CSS ${pseudo}; it is lost when styles are turned off or customised.`);
      }
    }
    return findings;
  }, externalCss, externalNames);
}
