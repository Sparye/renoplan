# Export draws a sheet as standalone SVG, then PNG or vector PDF

Status: accepted (2026-10-19)

Export (CONTEXT.md) is a PNG or PDF of one Scenario or one Comparison, for discussing options with other people. ADR 0008 chose SVG rendering partly so that the drawing could be exported. The editor's drawing depends on the page, though: colours are CSS variables, label halos come from a stylesheet rule (`paint-order`), and strokes are sized in screen pixels with `vector-effect: non-scaling-stroke`.

## Decision

- **One sheet API for both.** `exportSheet(sheet, 'png' | 'pdf', fileName)` in `src/app/export`. A `Sheet` has a project name, a title and subtitle, an optional date, one or two panes side by side (each a plan with optional Show Changes), and an optional table. The editor exports one pane. The Comparison view passes two panes and its summary table.
- **The sheet is a standalone SVG document**, laid out in CSS pixels on landscape paper: A4 for a single pane, A3 for two panes or a table. Each pane is drawn by `PlanDrawing` (rendered with `react-dom/server`), so there is no second copy of the drawing code. Every pane uses the same architectural scale, the largest of 1:20 … 1:1000 at which all of them fit, and prints it ("Scale 1:100 at A4"). A pane with Show Changes gets a legend (Retained, Demolished, New). The title block has the project name and the date.
- **The drawing is made standalone with string passes** (`flatten.ts`) over the rendered markup. `var(--…)` becomes the colour read from `styles.css`, so the stylesheet stays the one source of colour, and an unknown token throws. Non-scaling strokes and dashes are converted to drawing units at the pane's scale. Each label's halo is drawn as a stroked copy under it. Text is set in Helvetica / Arial / sans-serif, which maps to the PDF's built-in Helvetica, so no fonts are embedded.
- **PNG**: the SVG is drawn onto a canvas at 2× (an A4 page is 2246 × 1588 px, about 190 dpi) over a white background.
- **PDF**: vector, via **jsPDF 4.2.1** with **svg2pdf.js 2.8.1**. Together they add about 485 kB minified (155 kB gzip), plus jsPDF's own optional chunks, which are never loaded on this path. They are loaded with dynamic `import()` on first export, as is the sheet builder with `react-dom/server`, so the editor's bundle grows only by the Toolbar's menu. svg2pdf strokes text in page units and jsPDF's Helvetica has no weight 600, so the PDF step sets halo widths and bold weights before converting.
- Downloads go through `files.ts`, which now also takes a Blob. The file is named after the project and the view: "Home - Option A.pdf".

## Considered Options

- **A raster PDF** (the PNG placed in a PDF with jsPDF alone). This is simpler, but the text can't be selected and the PDF doesn't stay sharp when zoomed for print.
- **pdf-lib**. It doesn't convert SVG, so we would have to draw every shape twice.
- **`window.print()` with a print stylesheet.** This adds no dependencies, but it isn't a one-click file, and the page size, margins and file name depend on the browser.
- **Reading colours with `getComputedStyle` at export time.** This needs a DOM, so the sheet couldn't be unit-tested in Node, and it would pick up any theme override on the page.
- **Rendering the sheet off-screen and serialising the live DOM.** This still needs the passes above, and it has to mount React.

## Consequences

- An Export always looks like the editor: same drawing, same colours. A new `var(--…)` in the drawing must exist in `styles.css` or Export throws, and the unit tests catch that.
- The string passes depend on the markup `PlanDrawing` renders: `vector-effect` attributes and `class="plan-label"` with an inline `stroke-width`. They are covered by unit tests.
- Deferred: a choice of paper or scale, portrait pages, embedded custom fonts, and multi-page exports.
