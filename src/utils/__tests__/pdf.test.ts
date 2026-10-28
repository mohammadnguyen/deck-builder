import { describe, expect, it } from 'vitest';
import { imagesPdf } from '../pdf';

const text = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('the drawings PDF', () => {
  // two stand-in pictures: the writer copies the JPEG bytes as they are
  const pages = [
    { jpeg: Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]), width: 3175, height: 2245 },
    { jpeg: Uint8Array.from([0xff, 0xd8, 4, 5, 0xff, 0xd9]), width: 3175, height: 2245 },
  ];
  const pdf = text(imagesPdf(pages, 420, 297, 'ERIC 图纸', new Date('2026-10-28T09:30:00Z')));

  it('has a page per picture, A3 landscape', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf).toContain('/Type /Pages /Kids [4 0 R 7 0 R] /Count 2');
    expect(pdf.match(/\/MediaBox \[0 0 1190\.55 841\.89\]/g)).toHaveLength(2);
    expect(pdf.match(/\/Subtype \/Image \/Width 3175 \/Height 2245 .*\/Filter \/DCTDecode \/Length 7 >>/g)).toHaveLength(1);
    expect(pdf).toContain('q 1190.55 0 0 841.89 0 0 cm /Im Do Q');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('can be read: every object where the cross-reference table says', () => {
    const xref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(xref, xref + 5)).toBe('xref\n');
    const rows = pdf.slice(xref).split('\n').slice(2, 12);
    expect(rows[0]).toBe('0000000000 65535 f ');
    for (let n = 1; n < 10; n++) {
      expect(rows[n]).toMatch(/^\d{10} 00000 n $/);
      const at = Number(rows[n].slice(0, 10));
      expect(pdf.slice(at, at + `${n} 0 obj`.length)).toBe(`${n} 0 obj`);
    }
    expect(pdf).toContain('trailer\n<< /Size 10 /Root 1 0 R /Info 3 0 R >>');
  });

  it('names the job in Chinese too, and dates it', () => {
    // UTF-16 with the byte order mark: E 0045, R 0052, I 0049, C 0043, space, 图 56FE, 纸 7EB8
    expect(pdf).toContain('/Title <FEFF0045005200490043002056FE7EB8>');
    expect(pdf).toContain('/CreationDate (D:20261028093000Z)');
  });
});
