import { download } from '../files';
import type { ExportFormat, Sheet, SheetPage } from './types';

export type { ExportFormat, Pane, Paper, Sheet, SheetPage } from './types';

/** PNG resolution: device pixels per CSS pixel of the sheet (2× an A4 page is about 190 dpi). */
const PNG_SCALE = 2;

/**
 * Exports a sheet as a PNG or PDF file and offers it to save (ADR 0011). The sheet builder and the PDF
 * libraries load on first use, so they stay out of the editor's bundle.
 */
export async function exportSheet(sheet: Sheet, format: ExportFormat, fileName: string): Promise<void> {
  const { buildSheet } = await import('./sheet');
  const page = buildSheet(sheet);
  const blob = format === 'png' ? await toPng(page) : await toPdf(page, sheet.title);
  download(fileName, blob);
}

async function toPng(page: SheetPage): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([page.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = page.width * PNG_SCALE;
    canvas.height = page.height * PNG_SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the PNG'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A vector PDF: the sheet's SVG drawn onto a landscape page of its paper size. */
async function toPdf(page: SheetPage, title: string): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: page.paper });
  pdf.setProperties({ title, creator: 'Renoplan' });
  const svg = new DOMParser().parseFromString(page.svg, 'image/svg+xml').documentElement;
  // svg2pdf strokes text in page units, and jsPDF's Helvetica has only normal and bold.
  for (const t of svg.querySelectorAll('text[data-halo]'))
    t.setAttribute('stroke-width', t.getAttribute('data-halo')!);
  for (const t of svg.querySelectorAll('text[font-weight="600"]')) t.setAttribute('font-weight', 'bold');
  await svg2pdf(svg, pdf, {
    x: 0,
    y: 0,
    width: pdf.internal.pageSize.getWidth(),
    height: pdf.internal.pageSize.getHeight()
  });
  return pdf.output('blob');
}
