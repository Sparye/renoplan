/** Integer millimetres (ADR 0003). */
export type Mm = number;

/** Accepts "3.6", "3.6m", "3600", "3600mm". Bare numbers under 100 are metres. */
export function parseLength(text: string): Mm | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(mm|m)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]!.replace(',', '.'));
  const mm = m[2] === 'mm' ? v : m[2] === 'm' || v < 100 ? v * 1000 : v;
  const r = Math.round(mm);
  return r > 0 ? r : null;
}

export const formatMetres = (mm: Mm, digits = 2): string => (mm / 1000).toFixed(digits);

export const formatArea = (mm2: number, digits = 1): string => (mm2 / 1e6).toFixed(digits);
