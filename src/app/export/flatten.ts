import css from '../styles.css?raw';

// An exported sheet is a standalone SVG document: no stylesheet, no CSS variables, nothing that depends on
// the page it came from. These passes turn the editor's drawing markup into that, as plain string edits on
// what react-dom/server renders, so they run (and are tested) without a DOM.

/** The drawing's colour tokens (--plan-*, --tint-*), read from the app's stylesheet so there is one source. */
export const TOKENS: Readonly<Record<string, string>> = Object.fromEntries(
  [...css.matchAll(/--((?:plan|tint)-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()])
);

/** Replaces every var(--token) with its colour; an unknown token is a bug, so it throws. */
export function resolveVars(svg: string, tokens: Readonly<Record<string, string>> = TOKENS): string {
  return svg.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
    const v = tokens[name];
    if (!v) throw new Error(`no colour for var(--${name})`);
    return v;
  });
}

const round = (n: number) => String(+n.toPrecision(4));

/**
 * Strokes drawn with vector-effect="non-scaling-stroke" are sized in screen pixels. PDF converters ignore
 * vector-effect, so convert their widths and dashes to the drawing's own units at scale `s` (px per mm).
 */
export function fixStrokes(svg: string, s: number): string {
  return svg.replace(/<(\w+)([^>]*?) vector-effect="non-scaling-stroke"([^>]*)>/g, (_, tag: string, a, b) => {
    let attrs: string = a + b;
    let width = false;
    attrs = attrs.replace(/ stroke-width="([^"]*)"/, (_m, w: string) => {
      width = true;
      return ` stroke-width="${round(Number(w) / s)}"`;
    });
    if (!width) attrs = ` stroke-width="${round(1 / s)}"${attrs}`;
    attrs = attrs.replace(
      / stroke-dasharray="([^"]*)"/,
      (_m, d: string) =>
        ` stroke-dasharray="${d
          .trim()
          .split(/[\s,]+/)
          .map((x) => round(Number(x) / s))
          .join(' ')}"`
    );
    return `<${tag}${attrs}>`;
  });
}

/**
 * Labels (.plan-label) get their legibility halo from CSS paint-order, which neither a standalone SVG nor a
 * PDF converter has. Draw each as a paper-coloured stroked copy under the text instead. svg2pdf strokes text
 * in page units rather than the drawing's, so the halo also carries its width on the page at scale `s`.
 */
export function haloLabels(svg: string, s: number, paper = TOKENS['plan-paper'] ?? '#ffffff'): string {
  return svg.replace(
    /<text([^>]*?) class="plan-label" style="stroke-width:([^";]*);?"([^>]*)>([^<]*)<\/text>/g,
    (_, a: string, w: string, b: string, text: string) => {
      const attrs = (a + b).replace(/ dominant-baseline="middle"/, '$& alignment-baseline="middle"');
      const halo = attrs.replace(/ fill="[^"]*"/, '');
      return (
        `<text${halo} fill="${paper}" stroke="${paper}" stroke-width="${w}" stroke-linejoin="round" data-halo="${round(Number(w) * s)}">${text}</text>` +
        `<text${attrs}>${text}</text>`
      );
    }
  );
}

/** A drawing rendered at `s` px per mm, made standalone. */
export const flattenDrawing = (svg: string, s: number) => haloLabels(fixStrokes(svg, s), s);
