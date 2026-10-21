import type { Category } from '../../../shared/options.js';
import type { GuidelineRef, Severity } from '../../../shared/types.js';

export interface RuleDef {
  id: string;
  category: Category;
  severity: Severity;
  /** Report section heading inside the category (e.g. "Level AA", "Broken links", "Google"). */
  section: string;
  title: string;
  description: string;
  fix: string;
  guidelines: GuidelineRef[];
  /** Estimated minutes to fix one occurrence (used by the prioritized fix plan). */
  effortMinutes: number;
  helpUrl: string | null;
  /** Rule version — bumped when logic changes and listed in release notes. */
  version: string;
}

/** A single finding produced by an analyzer for one page/file. */
export interface Finding {
  ruleId: string;
  line?: number | null;
  snippet?: string | null;
  selector?: string | null;
  detail?: string | null;
  /** Overrides the rule's default severity (e.g. axe "needs review" → warning). */
  severity?: Severity;
}
