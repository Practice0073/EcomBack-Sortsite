/**
 * One-time repairs of stored scan results when a rule is corrected (meta key `results-version`).
 * Rescanning would reach the same outcome; this applies the corrected rule to what is already stored, so
 * reports that are open today show the right numbers without another hour of crawling.
 *
 * 1.1.0 — findings that were false positives in every scan of October 2026:
 *   - "Page title missing" where the page has a title (an <img> inside <head> broke the title lookup).
 *   - Broken links for external sites that only refused the request (400/405/…, certificate chains Node
 *     cannot verify, reset sockets, timeouts); see linkStatus.ts for the corrected verdict.
 *   - Browser-compatibility findings for `cursor` and `resize` on touch browsers (no pointer, no handles).
 *   - CSS "unknown property" for @font-face descriptors and "invalid value" for @viewport descriptors.
 *   - "Text is too small" for font-size: 0 (hidden-text technique) and F87 text inserted into
 *     screen-reader-only elements.
 *   - `<ul role="list">` reported as redundant ARIA (it is the documented VoiceOver fix), virtual-keyboard
 *     attributes (autocapitalize…) reported as unsupported on desktop browsers, and "Meta description
 *     missing (Bing)" counted as a priority issue (now "other", like the Google rule).
 *
 * Each pass is idempotent; the per-scan tally is kept in `meta` so the report's "Results updated"
 * diagnostic stays cumulative when a later version removes more.
 */
import { q, tx } from '../db/index.js';
import { openOptions } from '../lib/options.js';
import { BROKEN_SQL } from './linkStatus.js';
import { linkDiagnostics } from './scanRunner.js';
import { computeStats } from './stats.js';

const RESULTS_VERSION = '4';

const FONT_FACE_DESCRIPTORS = ['src', 'font-display', 'unicode-range', 'ascent-override', 'descent-override', 'line-gap-override', 'size-adjust', 'font-named-instance'];
const HIDDEN_CLASS_HINTS = ['screen-only', 'sr-only', 'visually-hidden', 'visuallyhidden', 'screen-reader-text', 'screen-reader-only', 'elementor-device-mode'];

interface Tally { removed: number; reasons: Record<string, number> }

export function repairStoredResults() {
  const current = q.get<{ value: string }>("SELECT value FROM meta WHERE key = 'results-version'")?.value;
  if (current === RESULTS_VERSION) return;
  const scans = q.all<{ id: number; options_json: string }>("SELECT id, options_json FROM scans WHERE status IN ('completed', 'stopped')");
  let touched = 0;
  for (const scan of scans) {
    const removed = tx(() => {
      const before = Number(q.value('SELECT COUNT(*) FROM issues WHERE scan_id = ?', [scan.id]));
      const reasons: Record<string, number> = {};
      const step = (label: string, sql: string) => {
        const n = q.run(sql, [scan.id]).changes;
        if (n) reasons[label] = n;
      };
      step('page titles that exist', "DELETE FROM issues WHERE scan_id = ? AND rule_id = 'search.title-missing' AND page_id IN (SELECT id FROM scan_pages WHERE scan_id = issues.scan_id AND COALESCE(title, '') != '')");
      step(
        'links that were refused, not missing',
        `DELETE FROM issues WHERE scan_id = ? AND rule_id IN ('errors.broken-link', 'errors.broken-resource') AND instr(COALESCE(detail, ''), ' → ') > 0
           AND EXISTS (SELECT 1 FROM scan_resources r WHERE r.scan_id = issues.scan_id AND r.url = substr(issues.detail, 1, instr(issues.detail, ' → ') - 1) AND NOT ${BROKEN_SQL})`,
      );
      step('pointer-only CSS on touch browsers', "DELETE FROM issues WHERE scan_id = ? AND (rule_id LIKE 'compat.css-prop.cursor.%' OR rule_id LIKE 'compat.css-value.cursor_%' OR rule_id LIKE 'compat.css-prop.resize.%' OR rule_id LIKE 'compat.css-value.resize_%') AND (rule_id LIKE '%.safari_ios.%' OR rule_id LIKE '%.chrome_android.%')");
      step('@font-face descriptors', `DELETE FROM issues WHERE scan_id = ? AND rule_id = 'standards.css-unknown-property' AND detail IN (${FONT_FACE_DESCRIPTORS.map((d) => `'Unknown property "${d}"'`).join(', ')})`);
      step('@viewport descriptors', "DELETE FROM issues WHERE scan_id = ? AND rule_id = 'standards.css-invalid-value' AND (snippet LIKE 'width: device-width%' OR snippet LIKE 'height: device-height%')");
      step('hidden text with font-size 0', "DELETE FROM issues WHERE scan_id = ? AND rule_id = 'usability.small-text' AND detail LIKE '0px at %'");
      step('CSS text in screen-reader-only elements', `DELETE FROM issues WHERE scan_id = ? AND rule_id = 'accessibility.f87-css-content' AND (${HIDDEN_CLASS_HINTS.map((h) => `snippet LIKE '%${h}%'`).join(' OR ')})`);
      step('list roles that are a deliberate VoiceOver fix', "DELETE FROM issues WHERE scan_id = ? AND rule_id = 'accessibility.aria-redundant' AND (detail LIKE 'The list role is unnecessary for element %' OR detail LIKE 'The listitem role is unnecessary for element %')");
      step('keyboard hints on desktop browsers', "DELETE FROM issues WHERE scan_id = ? AND rule_id LIKE 'compat.html-attr.%' AND (rule_id LIKE '%autocapitalize%' OR rule_id LIKE '%inputmode%' OR rule_id LIKE '%enterkeyhint%') AND (rule_id LIKE '%.chrome.%' OR rule_id LIKE '%.edge.%' OR rule_id LIKE '%.firefox.%' OR rule_id LIKE '%.opera.%' OR rule_id LIKE '%.safari.%')");
      // Severity corrections change counts and percentages without removing findings.
      const reclassified = q.run("UPDATE issues SET severity = 'other' WHERE scan_id = ? AND rule_id = 'search.description-missing-bing' AND severity = 'priority'", [scan.id]).changes;
      if (reclassified) reasons['missing Bing description no longer counted as priority'] = reclassified;
      const after = Number(q.value('SELECT COUNT(*) FROM issues WHERE scan_id = ?', [scan.id]));
      if (after === before && !reclassified) return 0;
      // Per-page counters and the frozen statistics follow the surviving findings.
      q.run(
        `UPDATE scan_pages SET
           priority_count = (SELECT COUNT(*) FROM issues i WHERE i.page_id = scan_pages.id AND i.severity = 'priority'),
           other_count = (SELECT COUNT(*) FROM issues i WHERE i.page_id = scan_pages.id AND i.severity = 'other'),
           warning_count = (SELECT COUNT(*) FROM issues i WHERE i.page_id = scan_pages.id AND i.severity = 'warning')
         WHERE scan_id = ?`,
        [scan.id],
      );
      linkDiagnostics(scan.id);
      const stats = computeStats(scan.id, openOptions(scan.options_json));
      q.run('UPDATE scans SET stats_json = ?, issue_pct = ?, priority_pct = ?, other_pct = ?, compliance_score = ? WHERE id = ?', [JSON.stringify(stats), stats.issuePct, stats.priorityPct, stats.otherPct, stats.complianceScore, scan.id]);

      // Cumulative tally across repair passes, shown on the report as one diagnostic.
      const key = `results-repaired:${scan.id}`;
      const prior = q.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
      const tally: Tally = prior ? (JSON.parse(prior.value) as Tally) : { removed: 0, reasons: {} };
      tally.removed += before - after;
      for (const [label, n] of Object.entries(reasons)) tally.reasons[label] = (tally.reasons[label] ?? 0) + n;
      q.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, JSON.stringify(tally)]);
      const list = Object.entries(tally.reasons).map(([label, n]) => `${label} (${n.toLocaleString()})`).join('; ');
      const changed = tally.removed + (tally.reasons['missing Bing description no longer counted as priority'] ?? 0);
      q.run("DELETE FROM diagnostics WHERE scan_id = ? AND code = 'results-repaired'", [scan.id]);
      q.run('INSERT INTO diagnostics (scan_id, code, message, url, detail) VALUES (?, ?, ?, NULL, NULL)', [
        scan.id,
        'results-repaired',
        `Results updated by SortSite Tools 1.1: ${changed.toLocaleString()} ${changed === 1 ? 'finding was' : 'findings were'} corrected by newer rules — ${list}. The percentages in this report reflect the corrected results.`,
      ]);
      return before - after + reclassified;
    });
    if (removed) touched++;
  }
  q.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('results-version', ?)", [RESULTS_VERSION]);
  if (touched) console.log(`[results] repaired stored results of ${touched} scan(s) with the 1.1 rules`);
}
