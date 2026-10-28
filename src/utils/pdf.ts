/*
 * The drawing sheets as a PDF made here, the same in every browser: each sheet drawn to a picture at print size and
 * put on a page of its own, A3 landscape. Printing leaves the page to the browser, and Safari lays the sheets out for
 * its own paper (A4 upright on an iPhone): they come out cut, shrunk and run across pages, and an iPhone keeps "save
 * as PDF" out of sight in the print sheet.
 */

/** a sheet's paper, mm */
export const SHEET_MM = { w: 420, h: 297 };
/** picture pixels per CSS pixel: about 190 dpi on A3, and well inside the largest canvas an iPhone draws */
const SCALE = 2;
const JPEG_QUALITY = 0.9;
const PT_PER_MM = 72 / 25.4;
const SVG_NS = 'http://www.w3.org/2000/svg';

export interface PdfPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const latin1 = (s: string): Uint8Array => {
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
  return u;
};

/** a text string of the document's info: UTF-16 with its byte order mark, in hex (Chinese names too) */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

/** A PDF of JPEG pictures, each filling a page of its own `w` × `h` mm. */
export function imagesPdf(pages: PdfPage[], w: number, h: number, title: string, at = new Date()) {
  const W = (w * PT_PER_MM).toFixed(2);
  const H = (h * PT_PER_MM).toFixed(2);
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const put = (x: string | Uint8Array) => {
    const u = typeof x === 'string' ? latin1(x) : x;
    chunks.push(u);
    size += u.length;
  };
  const obj = (n: number, ...body: (string | Uint8Array)[]) => {
    offsets[n] = size;
    put(`${n} 0 obj\n`);
    body.forEach(put);
    put('\nendobj\n');
  };
  // objects: 1 catalog, 2 page tree, 3 info, then per page its page, picture and drawing
  const pageObj = (i: number) => 4 + 3 * i;
  const count = pageObj(pages.length);
  const stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  obj(3, `<< /Title ${pdfText(title)} /Producer (Deck Builder) /CreationDate (D:${stamp}Z) >>`);
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const draw = `q ${W} 0 0 ${H} 0 0 cm /Im Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    obj(
      n + 1,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    );
    obj(n + 2, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  });
  const xref = size;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Each SVG of a copied sheet made whole on its own, as html2canvas draws it (a picture of the SVG alone): the font it
 * takes from the page written on it, the patterns it borrows from another SVG copied in, and the empty SVG that only
 * held those patterns taken out.
 */
function selfContained(sheet: HTMLElement): void {
  for (const svg of [...sheet.querySelectorAll('svg')]) {
    const css = getComputedStyle(svg);
    svg.style.fontFamily = css.fontFamily;
    svg.style.fontSize = css.fontSize;
    svg.style.color = css.color;
    const ids = new Set<string>();
    for (const el of svg.querySelectorAll('*')) {
      for (const name of ['fill', 'stroke', 'clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end']) {
        const m = /url\(#([^)]+)\)/.exec(el.getAttribute(name) ?? '');
        if (m) ids.add(m[1]);
      }
    }
    let defs: Element | null = null;
    for (const id of ids) {
      if ([...svg.querySelectorAll('[id]')].some((x) => x.id === id)) continue;
      const def = document.getElementById(id);
      if (!def) continue;
      if (!defs) {
        defs = document.createElementNS(SVG_NS, 'defs');
        svg.insertBefore(defs, svg.firstChild);
      }
      defs.appendChild(def.cloneNode(true));
    }
  }
  for (const svg of [...sheet.querySelectorAll('svg')]) if (svg.getAttribute('width') === '0' && svg.getAttribute('height') === '0') svg.remove();
}

const jpegOf = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('no JPEG from the canvas'))),
      'image/jpeg',
      JPEG_QUALITY,
    ),
  );

/**
 * The sheets as a PDF, a page each. Every sheet is copied out of view at its print size (the sheets on screen are
 * zoomed to fit), drawn, and its picture kept; `onPage` hears how many are done.
 */
export async function sheetsPdf(sheets: HTMLElement[], title: string, onPage?: (done: number) => void): Promise<Blob> {
  const { default: html2canvas } = await import('html2canvas');
  const host = document.createElement('div');
  host.className = 'sheets pdf-host';
  document.body.appendChild(host);
  const pages: PdfPage[] = [];
  try {
    for (const sheet of sheets) {
      const copy = sheet.cloneNode(true) as HTMLElement;
      host.replaceChildren(copy);
      selfContained(copy);
      const canvas = await html2canvas(copy, {
        scale: SCALE,
        backgroundColor: '#ffffff',
        logging: false,
        // html2canvas copies the whole page to draw from: only the sheet's copy (and the styles) need to go
        ignoreElements: (el) => el !== document.body && document.body.contains(el) && !el.contains(host) && !host.contains(el),
      });
      pages.push({ jpeg: await jpegOf(canvas), width: canvas.width, height: canvas.height });
      // an iPhone holds little canvas memory: give it back before the next sheet
      canvas.width = 0;
      canvas.height = 0;
      onPage?.(pages.length);
    }
  } finally {
    host.remove();
  }
  return new Blob([imagesPdf(pages, SHEET_MM.w, SHEET_MM.h, title)], { type: 'application/pdf' });
}
