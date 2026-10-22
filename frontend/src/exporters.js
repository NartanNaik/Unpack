// ---------------------------------------------------------------------------
// File naming: "Quick Summary of Project A by Unpack.pdf"
// ---------------------------------------------------------------------------
const KIND_NAMES = {
  'Quick Summary': 'Quick Summary',
  'Standard Architecture': 'Standard Architecture',
  'Deep Dive': 'Deep Dive',
  Diagnose: 'Diagnose Report',
};

export function splitProjectName(projectName = '') {
  const m = projectName.match(/^(.*?)\s*\[(.+)\]\s*$/);
  if (m) return { project: m[1].trim() || 'Project', label: m[2].trim() };
  return { project: projectName.trim() || 'Project', label: 'Analysis' };
}

export function buildFileBase(projectName) {
  const { project, label } = splitProjectName(projectName);
  const kind = KIND_NAMES[label] || label;
  return `${kind} of ${project} by Unpack`.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Small Markdown parser shared by PDF, Word and PowerPoint
// ---------------------------------------------------------------------------
export function parseMarkdown(md = '') {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let i = 0;
  const flush = () => {
    if (para.length) {
      blocks.push({ type: 'p', text: para.join(' ') });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', lines: code });
      continue;
    }
    if (/^\s*$/.test(line)) {
      flush();
      i++;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      blocks.push({ type: 'h', level: Math.min(h[1].length, 3), text: h[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      blocks.push({
        type: 'li',
        depth: Math.min(Math.floor(li[1].replace(/\t/g, '  ').length / 2), 3),
        ordered: /\d/.test(li[2]),
        marker: li[2],
        text: li[3],
      });
      i++;
      continue;
    }
    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      flush();
      blocks.push({ type: 'p', text: bq[1], quote: true });
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  return blocks;
}

export function parseInline(text = '') {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^\s*][^*\n]*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith('**')) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith('`')) out.push({ text: t.slice(1, -1), code: true });
    else if (t.startsWith('[')) out.push({ text: t.slice(1, t.indexOf(']')) });
    else out.push({ text: t.slice(1, -1), italic: true });
    last = m.index + t.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const stripInline = (t) => parseInline(t).map((s) => s.text).join('');

// ---------------------------------------------------------------------------
// PDF (jsPDF) with diagonal UNPACK watermark and page footers
// ---------------------------------------------------------------------------
const PDF_MAP = {
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-',
  '\u2026': '...', '\u2192': '->', '\u2190': '<-', '\u21D2': '=>', '\u2022': '-',
  '\u2500': '-', '\u2502': '|', '\u251C': '+', '\u2514': '+', '\u2510': '+', '\u250C': '+',
  '\u2524': '+', '\u252C': '+', '\u2534': '+', '\u253C': '+',
  '\u2713': 'v', '\u2714': 'v', '\u2717': 'x', '\u2718': 'x',
  '\u2260': '!=', '\u2264': '<=', '\u2265': '>=',
};
// Built-in PDF fonts only cover Latin characters, so everything else is mapped or replaced
const pdfSafe = (s = '') =>
  s
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x08\x0B-\x1F]/g, '')
    .replace(/[^\x00-\x7F]/g, (ch) => PDF_MAP[ch] ?? (/[\u00A1-\u00FF]/.test(ch) ? ch : '?'));
const softWrap = (s) => s.replace(/(\S{60})(?=\S)/g, '$1 ');

const INK = [30, 16, 51];
const PURPLE = [76, 29, 149];
const GOLD = [166, 124, 26];
const MUTED = [107, 91, 123];

export async function exportPdf(summary, projectName) {
  const { jsPDF } = await import('jspdf');
  const base = buildFileBase(projectName);
  const { project, label } = splitProjectName(projectName);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title: base, author: 'Unpack', creator: 'Unpack' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 50;
  const maxW = W - M * 2;
  let y = M;

  const ensure = (h) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };

  const writeText = (text, o = {}) => {
    const { font = 'helvetica', style = 'normal', size = 10.5, color = INK, indent = 0, gap = 6 } = o;
    const lineH = size * 1.45;
    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(softWrap(pdfSafe(text)), maxW - indent);
    for (const l of lines) {
      ensure(lineH);
      doc.text(l, M + indent, y + size);
      y += lineH;
    }
    y += gap;
  };

  const codeLines = (lines, size = 8.5) => {
    const lh = size * 1.4;
    const maxChars = Math.max(20, Math.floor((maxW - 16) / (size * 0.6)));
    doc.setFont('courier', 'normal');
    doc.setFontSize(size);
    y += 3;
    for (const raw of lines) {
      const line = pdfSafe(raw);
      const chunks = line.length === 0 ? [''] : line.match(new RegExp(`.{1,${maxChars}}`, 'g'));
      for (const c of chunks) {
        ensure(lh);
        doc.setFillColor(244, 241, 250);
        doc.rect(M, y, maxW, lh, 'F');
        doc.setTextColor(60, 30, 110);
        doc.text(c, M + 8, y + size);
        y += lh;
      }
    }
    y += 8;
  };

  // Title block
  writeText('UNPACK', { style: 'bold', size: 10, color: GOLD, gap: 2 });
  writeText(project, { font: 'times', style: 'bold', size: 22, color: PURPLE, gap: 2 });
  writeText(`${label}  |  ${todayLabel()}`, { size: 10, color: MUTED, gap: 6 });
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.5);
  doc.line(M, y, W - M, y);
  y += 18;

  for (const b of parseMarkdown(summary)) {
    if (b.type === 'h') {
      const size = b.level === 1 ? 17 : b.level === 2 ? 14.5 : 12.5;
      y += b.level === 1 ? 8 : 5;
      ensure(size * 2.6);
      writeText(stripInline(b.text), { font: 'times', style: 'bold', size, color: PURPLE, gap: 3 });
      if (b.level <= 2) {
        ensure(8);
        doc.setDrawColor(...GOLD);
        doc.setLineWidth(0.6);
        doc.line(M, y, W - M, y);
        y += 8;
      }
    } else if (b.type === 'p') {
      if (b.quote) writeText(stripInline(b.text), { style: 'italic', color: MUTED, indent: 12 });
      else writeText(stripInline(b.text));
    } else if (b.type === 'li') {
      const indent = 16 + b.depth * 16;
      const size = 10.5;
      const lh = size * 1.45;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(softWrap(pdfSafe(stripInline(b.text))), maxW - indent);
      lines.forEach((l, idx) => {
        ensure(lh);
        if (idx === 0) {
          if (b.ordered) {
            doc.setTextColor(...MUTED);
            doc.text(pdfSafe(b.marker), M + indent - 14, y + size);
          } else {
            doc.setFillColor(...GOLD);
            doc.circle(M + indent - 8, y + size * 0.65, 1.8, 'F');
          }
        }
        doc.setTextColor(...INK);
        doc.text(l, M + indent, y + size);
        y += lh;
      });
      y += 2;
    } else if (b.type === 'code') {
      codeLines(b.lines);
    } else if (b.type === 'table') {
      const rows = b.rows.map((r) => r.map((c) => stripInline(c).slice(0, 40)));
      const cols = Math.max(...rows.map((r) => r.length));
      const widths = Array.from({ length: cols }, (_, ci) => Math.max(...rows.map((r) => (r[ci] || '').length)));
      const fmt = (r) => widths.map((w, ci) => (r[ci] || '').padEnd(w)).join(' | ');
      const out = [];
      rows.forEach((r, ri) => {
        out.push(fmt(r));
        if (ri === 0) out.push(widths.map((w) => '-'.repeat(w)).join('-+-'));
      });
      codeLines(out, 8);
    } else if (b.type === 'hr') {
      ensure(12);
      doc.setDrawColor(220, 210, 190);
      doc.setLineWidth(0.5);
      doc.line(M, y + 4, W - M, y + 4);
      y += 12;
    }
  }

  // Watermark + footer on every page
  const pages = doc.getNumberOfPages();
  const angle = 35;
  const rad = (angle * Math.PI) / 180;
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);

    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.07 }));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(110);
    doc.setTextColor(...PURPLE);
    const tw = doc.getTextWidth('UNPACK');
    const sx = W / 2 - (tw / 2) * Math.cos(rad) + Math.sin(rad) * 110 * 0.35;
    const sy = H / 2 + (tw / 2) * Math.sin(rad) + Math.cos(rad) * 110 * 0.35;
    doc.text('UNPACK', sx, sy, { angle });
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Generated by Unpack', M, H - 24);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 24, { align: 'right' });
  }

  doc.save(`${base}.pdf`);
}

// ---------------------------------------------------------------------------
// Word (.docx) with the UNPACK watermark behind the text
// ---------------------------------------------------------------------------
function makeWatermarkPng() {
  return new Promise((resolve) => {
    try {
      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 900;
      const ctx = c.getContext('2d');
      ctx.translate(450, 450);
      ctx.rotate(-Math.PI / 4);
      ctx.font = 'bold 190px Arial, sans-serif';
      ctx.fillStyle = 'rgba(76, 29, 149, 0.10)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('UNPACK', 0, 0);
      c.toBlob(async (blob) => {
        if (!blob) return resolve(null);
        resolve(new Uint8Array(await blob.arrayBuffer()));
      }, 'image/png');
    } catch {
      resolve(null);
    }
  });
}

export async function exportWord(summary, projectName) {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Header, Footer, ImageRun, PageNumber,
    AlignmentType, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
    HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom,
    HorizontalPositionAlign, VerticalPositionAlign,
  } = docx;

  const base = buildFileBase(projectName);
  const { project, label } = splitProjectName(projectName);
  const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const HEADING_SIZES = [36, 30, 26];

  const runsFrom = (text, o = {}) =>
    parseInline(text).map(
      (seg) =>
        new TextRun({
          text: seg.text,
          bold: seg.bold || o.bold,
          italics: seg.italic || o.italics,
          font: seg.code ? 'Consolas' : o.font,
          size: o.size,
          color: seg.code ? '6D28D9' : o.color,
          shading: seg.code ? { type: ShadingType.CLEAR, fill: 'F3F0FA', color: 'auto' } : undefined,
        })
    );

  const children = [
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: 'UNPACK', bold: true, color: 'A67C1A', size: 20, characterSpacing: 80 })],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: project, bold: true, color: '4C1D95', size: 48, font: 'Georgia' })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: 'A67C1A', space: 6 } },
      children: [new TextRun({ text: `${label}  |  ${todayLabel()}`, color: '6B5B7B', size: 20 })],
    }),
  ];

  for (const b of parseMarkdown(summary)) {
    if (b.type === 'h') {
      children.push(
        new Paragraph({
          heading: HEADINGS[b.level - 1],
          spacing: { before: 320, after: 120 },
          children: runsFrom(b.text, { bold: true, color: '4C1D95', size: HEADING_SIZES[b.level - 1], font: 'Georgia' }),
        })
      );
    } else if (b.type === 'p') {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          indent: b.quote ? { left: 360 } : undefined,
          border: b.quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: 'A67C1A', space: 8 } } : undefined,
          children: runsFrom(b.text, { size: 22, italics: b.quote, color: b.quote ? '6B5B7B' : undefined }),
        })
      );
    } else if (b.type === 'li') {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          bullet: b.ordered ? undefined : { level: b.depth },
          indent: b.ordered ? { left: 360 + b.depth * 360, hanging: 300 } : undefined,
          children: b.ordered
            ? [new TextRun({ text: `${b.marker} `, size: 22 }), ...runsFrom(b.text, { size: 22 })]
            : runsFrom(b.text, { size: 22 }),
        })
      );
    } else if (b.type === 'code') {
      for (const line of b.lines) {
        children.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: 'F3F0FA', color: 'auto' },
            spacing: { after: 0 },
            children: [new TextRun({ text: line.replace(/\t/g, '  ') || ' ', font: 'Consolas', size: 18, color: '3C1E6E' })],
          })
        );
      }
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.type === 'table') {
      const cols = Math.max(...b.rows.map((r) => r.length));
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.rows.map(
            (r, ri) =>
              new TableRow({
                tableHeader: ri === 0,
                children: Array.from({ length: cols }, (_, ci) =>
                  new TableCell({
                    shading: ri === 0 ? { type: ShadingType.CLEAR, fill: 'EDE9FE', color: 'auto' } : undefined,
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    children: [new Paragraph({ children: runsFrom(r[ci] || '', { size: 20, bold: ri === 0 }) })],
                  })
                ),
              })
          ),
        }),
        new Paragraph({ spacing: { after: 120 }, children: [] })
      );
    } else if (b.type === 'hr') {
      children.push(
        new Paragraph({
          spacing: { after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDD3B8', space: 4 } },
          children: [],
        })
      );
    }
  }

  const headerRuns = [new TextRun({ text: 'UNPACK', bold: true, color: 'A67C1A', size: 18, characterSpacing: 60 })];
  const watermark = await makeWatermarkPng();
  if (watermark) {
    headerRuns.push(
      new ImageRun({
        type: 'png',
        data: watermark,
        transformation: { width: 560, height: 560 },
        altText: { title: 'Unpack watermark', description: 'Unpack watermark', name: 'unpack-watermark' },
        floating: {
          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
          verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.CENTER },
          behindDocument: true,
        },
      })
    );
  }

  const document = new Document({
    creator: 'Unpack',
    title: base,
    sections: [
      {
        properties: { page: { margin: { top: 1200, bottom: 1200, left: 1200, right: 1200 } } },
        headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: headerRuns })] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ['Generated by Unpack  |  Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: '888888',
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  downloadBlob(blob, `${base}.docx`);
}

// ---------------------------------------------------------------------------
// PowerPoint with the UNPACK watermark on a master slide
// ---------------------------------------------------------------------------
export async function exportPpt(summary, projectName) {
  const { default: pptxgen } = await import('pptxgenjs');
  const base = buildFileBase(projectName);
  const { project, label } = splitProjectName(projectName);

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = base;
  pptx.author = 'Unpack';

  pptx.defineSlideMaster({
    title: 'UNPACK_MASTER',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.18, fill: { color: '4C1D95' } } },
      {
        text: {
          text: 'UNPACK',
          options: {
            x: 1.5, y: 2.0, w: 10.3, h: 3.5, fontSize: 130, bold: true, fontFace: 'Arial',
            color: '4C1D95', transparency: 93, align: 'center', valign: 'middle', rotate: -20,
          },
        },
      },
      { text: { text: 'Generated by Unpack', options: { x: 0.6, y: 7.05, w: 6, h: 0.3, fontSize: 10, color: '888888' } } },
    ],
    slideNumber: { x: 12.2, y: 7.05, fontSize: 10, color: '888888' },
  });

  // Title slide
  const first = pptx.addSlide({ masterName: 'UNPACK_MASTER' });
  first.addText(project, { x: 0.8, y: 2.3, w: 11.7, h: 1.4, fontSize: 40, bold: true, fontFace: 'Georgia', color: '4C1D95' });
  first.addText(label, { x: 0.8, y: 3.7, w: 11.7, h: 0.6, fontSize: 22, color: 'A67C1A', bold: true });
  first.addText(`Generated by Unpack  -  ${todayLabel()}`, { x: 0.8, y: 4.4, w: 11.7, h: 0.5, fontSize: 14, color: '6B5B7B' });

  // Group blocks into sections by heading
  const sections = [];
  let cur = { title: project, blocks: [] };
  for (const b of parseMarkdown(summary)) {
    if (b.type === 'h') {
      if (cur.blocks.length) sections.push(cur);
      cur = { title: stripInline(b.text), blocks: [] };
    } else if (b.type !== 'hr') {
      if (b.type === 'code' && b.lines.length > 14) {
        for (let i = 0; i < b.lines.length; i += 14) cur.blocks.push({ type: 'code', lines: b.lines.slice(i, i + 14) });
      } else {
        cur.blocks.push(b);
      }
    }
  }
  if (cur.blocks.length) sections.push(cur);

  const estimate = (b) => {
    if (b.type === 'code') return b.lines.length * 0.75;
    if (b.type === 'table') return b.rows.length + 1;
    return Math.ceil((stripInline(b.text || '').length + (b.type === 'li' ? 6 : 0)) / 100) + 0.35;
  };

  const toRuns = (b) => {
    if (b.type === 'code') {
      return b.lines.map((l) => ({
        text: l.replace(/\t/g, '  ') || ' ',
        options: { fontFace: 'Courier New', fontSize: 10, color: '4C1D95', breakLine: true },
      }));
    }
    if (b.type === 'table') {
      return b.rows.map((r) => ({
        text: r.map(stripInline).join('  |  '),
        options: { fontFace: 'Courier New', fontSize: 11, color: '333333', breakLine: true },
      }));
    }
    const segs = parseInline(b.text);
    return segs.map((s, i) => ({
      text: s.text,
      options: {
        fontSize: 14,
        color: '333333',
        bold: s.bold,
        italic: s.italic || b.quote,
        fontFace: s.code ? 'Courier New' : 'Calibri',
        breakLine: i === segs.length - 1,
        paraSpaceAfter: 6,
        ...(b.type === 'li' ? { bullet: b.ordered ? { type: 'number' } : true, indentLevel: b.depth } : {}),
      },
    }));
  };

  for (const section of sections) {
    const pages = [];
    let page = [];
    let used = 0;
    for (const b of section.blocks) {
      const e = estimate(b);
      if (used + e > 11 && page.length) {
        pages.push(page);
        page = [];
        used = 0;
      }
      page.push(b);
      used += e;
    }
    if (page.length) pages.push(page);

    pages.forEach((blocks, idx) => {
      const slide = pptx.addSlide({ masterName: 'UNPACK_MASTER' });
      const title = pages.length > 1 ? `${section.title} (${idx + 1}/${pages.length})` : section.title;
      slide.addText(title, { x: 0.6, y: 0.4, w: 12.1, h: 0.8, fontSize: 26, bold: true, fontFace: 'Georgia', color: '4C1D95', valign: 'middle' });
      slide.addShape(pptx.ShapeType.line, { x: 0.6, y: 1.3, w: 12.1, h: 0, line: { color: 'A67C1A', width: 1.5 } });
      slide.addText(blocks.flatMap(toRuns), { x: 0.6, y: 1.5, w: 12.1, h: 5.4, valign: 'top' });
    });
  }

  await pptx.writeFile({ fileName: `${base}.pptx` });
}