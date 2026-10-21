/**
 * Word export in the "Issue Report" format (structure and paragraph styles follow the owner's
 * PowerMapperReport.docx reference), carrying Ecomback branding in the header and footer.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { brandAssets, PRODUCT_NAME } from './branding.js';
import { severityIcon, SEVERITY_ICON_LABEL } from './icons.js';
import { buildIssueReport, foundOnText, sectionCountText, type IssueEntry, type IssueReport, type Segment } from './issueReport.js';
import type { ReportModel } from './model.js';

// Page geometry from the reference: A4, 1" margins → 9020 twips of text width.
const PAGE = { width: 11900, height: 16840, margin: 1440 } as const;
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;
const BAR_CELLS = 24; // characters in the summary bar

/** Boilerplate fix text (axe rules) adds nothing per issue — the guideline links carry the guidance. */
export const GENERIC_FIX = /^See the affected elements below/;

const run = (text: string, opts: { style?: string; bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) => new TextRun({ text, ...opts });

function segmentsToRuns(segs: Segment[]): TextRun[] {
  return segs.map((s) => new TextRun({ text: s.text, style: s.marked ? 'HTMLMarkedCode' : s.code ? 'HTMLCode' : undefined }));
}

function link(url: string, text = url): ExternalHyperlink {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: 'Hyperlink' })] });
}

function icon(severity: IssueEntry['severity']): ImageRun {
  return new ImageRun({
    type: 'png',
    data: severityIcon(severity),
    transformation: { width: 15, height: 15 },
    altText: { name: SEVERITY_ICON_LABEL[severity], title: SEVERITY_ICON_LABEL[severity], description: SEVERITY_ICON_LABEL[severity] },
  });
}

/** Summary bar: shaded characters, red share = % of pages with issues (no images needed). */
function bar(pct: number): TextRun[] {
  const red = Math.max(pct > 0 ? 1 : 0, Math.round((pct / 100) * BAR_CELLS));
  const runs: TextRun[] = [];
  if (red) runs.push(new TextRun({ text: ' '.repeat(red), shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D02020' } }));
  if (BAR_CELLS - red) runs.push(new TextRun({ text: ' '.repeat(BAR_CELLS - red), shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEEEEE' } }));
  return runs;
}

const noBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function summaryTable(r: IssueReport): Table {
  const widths = [1780, 2580, 4280].map((w) => Math.round((w / 8640) * TEXT_WIDTH));
  const row = (cells: ParagraphChild[][], after = 72) =>
    new TableRow({
      children: cells.map(
        (children, i) =>
          new TableCell({
            width: { size: widths[i]!, type: WidthType.DXA },
            borders: noBorders,
            children: [new Paragraph({ spacing: { after }, children })],
          }),
      ),
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders: { ...noBorders, insideHorizontal: noBorders.top, insideVertical: noBorders.top },
    rows: [...r.summary.map((s) => row([[run(s.label)], bar(s.pct), [run(s.text)]])), row([[run('Totals')], [run('')], [run(`${r.totalUrls.toLocaleString()} URLs checked`)]], 0)],
  });
}

function issueBlocks(issue: IssueEntry, showOccurrences: boolean): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({ style: 'Issue', children: [icon(issue.severity), new TextRun({ children: [new Tab()] }), ...segmentsToRuns(issue.title)] }),
    new Paragraph({ style: 'Details', children: segmentsToRuns(issue.description) }),
  ];
  if (issue.fix && !GENERIC_FIX.test(issue.fix)) out.push(new Paragraph({ style: 'Details', children: [run('How to fix: ', { bold: true }), run(issue.fix)] }));
  const guideLinks: ParagraphChild[] = [];
  for (const g of issue.guidelines) {
    if (guideLinks.length) guideLinks.push(run(' '));
    guideLinks.push(g.url ? link(g.url, g.label) : run(g.label));
  }
  if (issue.templateLevel) guideLinks.push(run(guideLinks.length ? '   ' : ''), run('Theme-level: fix once in a shared template', { italics: true, color: '1A1CA8' }));
  if (guideLinks.length) out.push(new Paragraph({ style: 'Details', children: guideLinks }));

  if (!showOccurrences) {
    out.push(new Paragraph({ style: 'Details', spacing: { after: 300 }, children: [run(foundOnText(issue), { italics: true })] }));
    return out;
  }
  for (const page of issue.pages) {
    for (const line of page.lines) {
      const children: ParagraphChild[] = [...segmentsToRuns(line.segments)];
      if (line.line) children.push(run(` line ${line.line}`));
      if (children.length) out.push(new Paragraph({ style: 'Snippet', children }));
      if (line.detail) out.push(new Paragraph({ style: 'Details', children: [run(line.detail, { italics: true, color: '555555', size: 20 })] }));
    }
    if (page.more) out.push(new Paragraph({ style: 'Details', children: [run(`and ${page.more} more on this page`, { italics: true, color: '555555', size: 20 })] }));
    out.push(new Paragraph({ style: 'Details', spacing: { after: 300 }, children: [link(page.url)] }));
  }
  if (issue.morePages) {
    out.push(new Paragraph({ style: 'Details', spacing: { after: 300 }, children: [run(`and ${issue.morePages.toLocaleString()} more ${issue.morePages === 1 ? 'page' : 'pages'} (raise "Max pages shown per issue" in scan options to list them)`, { italics: true, color: '555555' })] }));
  }
  return out;
}

export async function renderIssueReportDocx(m: ReportModel): Promise<Buffer> {
  const r = buildIssueReport(m);
  const children: (Paragraph | Table)[] = [
    new Paragraph({ style: 'Title', children: [run(r.title)] }),
    new Paragraph({ children: [new TextRun({ break: 1 }), run(r.intro), new TextRun({ break: 2 })] }),
    summaryTable(r),
    new Paragraph({ children: [new TextRun({ break: 1 })] }),
  ];

  if (m.type === 'executive') {
    children.push(new Paragraph({ style: 'Heading1', pageBreakBefore: true, children: [run('Top issues to fix')] }));
    children.push(new Paragraph({ children: [run('The highest-impact fixes for the effort they take. Theme-level issues are fixed once in a shared template and resolve every page that uses it.')] }));
    for (const f of r.topFixes) {
      children.push(
        new Paragraph({ style: 'Issue', children: [icon(f.severity), new TextRun({ children: [new Tab()] }), run(f.title)] }),
        new Paragraph({ style: 'Details', spacing: { after: 240 }, children: [run(`${f.pages.toLocaleString()} ${f.pages === 1 ? 'page' : 'pages'} · estimated effort ${f.effort}${f.templateLevel ? ' · theme-level' : ''}`, { color: '555555' })] }),
      );
    }
  }

  for (const [ci, cat] of r.categories.entries()) {
    children.push(new Paragraph({ style: 'Heading1', pageBreakBefore: ci === 0 || m.type !== 'summary', children: [run(cat.label)] }));
    children.push(new Paragraph({ children: [run(cat.intro), new TextRun({ break: 1 })] }));
    for (const sec of cat.sections) {
      children.push(new Paragraph({ style: 'Heading2', children: [run(sec.name)] }));
      children.push(new Paragraph({ children: [run(sectionCountText(sec)), new TextRun({ break: 1 })] }));
      for (const issue of sec.issues) children.push(...issueBlocks(issue, r.showOccurrences));
    }
  }

  const { logoSvg, logoPng } = brandAssets();
  const headerLogo = new ImageRun({ type: 'svg', data: logoSvg, fallback: { type: 'png', data: logoPng }, transformation: { width: 72, height: 16 }, altText: { name: 'Ecomback', title: 'Ecomback', description: 'Ecomback logo' } });
  const small = { size: 18 };
  const rightTab = [{ type: TabStopType.RIGHT, position: TEXT_WIDTH }];

  const doc = new Document({
    creator: PRODUCT_NAME,
    title: `${r.title} — ${r.url}`,
    description: r.intro,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 24 } } },
      paragraphStyles: [
        { id: 'Normal', name: 'Normal', quickFormat: true, run: { font: 'Calibri' } },
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', bold: true, size: 56 }, paragraph: { contextualSpacing: true } },
        { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', bold: true, size: 36 }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 240, after: 80 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Calibri Light', bold: true, size: 30 }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 240, after: 80 }, outlineLevel: 1 } },
        { id: 'Issue', name: 'Issue', basedOn: 'Normal', quickFormat: true, paragraph: { indent: { left: 360, hanging: 360 }, spacing: { before: 0, after: 120 }, keepNext: true } },
        { id: 'Details', name: 'Details', basedOn: 'Normal', quickFormat: true, paragraph: { indent: { left: 360 }, spacing: { before: 0, after: 120 } } },
        { id: 'Snippet', name: 'Snippet', basedOn: 'Normal', quickFormat: true, paragraph: { indent: { left: 360 }, spacing: { before: 0, after: 120 }, keepNext: true } },
      ],
      characterStyles: [
        { id: 'Hyperlink', name: 'Hyperlink', basedOn: 'DefaultParagraphFont', run: { color: '0563C1', underline: {} } },
        {
          id: 'HTMLCode',
          name: 'HTML Code',
          basedOn: 'DefaultParagraphFont',
          run: { border: { style: BorderStyle.SINGLE, size: 2, space: 0, color: 'E8E8E8' }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAFAFA' } },
        },
        {
          id: 'HTMLMarkedCode',
          name: 'HTML Marked Code',
          basedOn: 'HTMLCode',
          run: { color: '800000', underline: { type: 'dotted', color: 'F00000' }, border: { style: BorderStyle.SINGLE, size: 2, space: 0, color: 'E8E8E8' }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'FAFAFA' } },
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, header: 708, footer: 708 } } },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                tabStops: rightTab,
                children: [headerLogo, run(`   ${r.url}`, small), new TextRun({ ...small, children: [new Tab(), r.date] })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                tabStops: rightTab,
                alignment: AlignmentType.LEFT,
                children: [run(PRODUCT_NAME, small), new TextRun({ ...small, children: [new Tab(), 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
