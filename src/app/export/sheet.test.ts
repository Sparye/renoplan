import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import {
  addOpening,
  addOutline,
  addRoom,
  applyScenario,
  derive,
  emptyPlan,
  emptyScenario,
  recordChange
} from '@/core';
import { exportName, fileName } from '../files';
import { TOKENS, fixStrokes, haloLabels, resolveVars } from './flatten';
import { buildSheet, chooseScale } from './sheet';
import type { Pane, Sheet } from './types';

// Vitest stubs CSS out, ?raw included; give the sheet the real stylesheet its colours come from.
vi.mock('../styles.css?raw', () => ({
  default: readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
}));

/** Outline 10 × 8 m; Kitchen and Dining side by side sharing a Wall, a door in it. */
function house() {
  let p = addOutline(emptyPlan(), 10000, 8000, { x: 0, y: 0 });
  const k = addRoom(p, { name: 'Kitchen', w: 4000, l: 3800, x: 200, y: 200 });
  const d = addRoom(k.plan, { name: 'Dining', w: 3000, l: 3800, x: 4300, y: 200 });
  p = d.plan;
  const shared = Object.keys(p.walls).find((w) => p.walls[w]!.neg === k.id && p.walls[w]!.pos === d.id)!;
  p = addOpening(p, shared, 'door', 2000).plan;
  return { p, shared };
}

/** Option A demolishes the Shared Wall between Kitchen and Dining. */
function optionA() {
  const { p, shared } = house();
  const s = recordChange(p, emptyScenario('s1', 'Option A'), { op: 'demolishWall', wall: shared })!.scenario;
  const a = applyScenario(p, s);
  return { existing: p, plan: a.plan, statuses: a.statuses };
}

const date = new Date(2026, 9, 18);
const one = (pane: Pane): Sheet => ({ project: 'Home', title: pane.title, date, panes: [pane] });
const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

describe('sheet', () => {
  test("draws the plan's Rooms, with their names, as a standalone A4 SVG document", () => {
    const { p } = house();
    const page = buildSheet(one({ title: 'Existing plan', plan: p }));
    expect(page.paper).toBe('a4');
    expect(page.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1123" height="794"/);
    for (const [id, r] of Object.entries(p.rooms)) {
      expect(page.svg).toContain(`>${r.name}</text>`);
      expect(page.svg).toContain(TOKENS[`tint-${r.type}`]!);
      expect(derive(p).rooms[id]).toBeTruthy();
    }
    // Project name and date in the title block.
    expect(page.svg).toContain('>Home</text>');
    expect(page.svg).toContain('18 October 2026');
    // A parseable document.
    expect(count(page.svg, /<svg/g)).toBe(1);
    expect(page.svg.endsWith('</svg>')).toBe(true);
  });

  test('resolves every var(--…) to a colour, and nothing depends on a stylesheet', () => {
    const { existing, plan, statuses } = optionA();
    const page = buildSheet(one({ title: 'Option A', plan, changes: { existing, statuses } }));
    expect(page.svg).not.toContain('var(');
    expect(page.svg).not.toContain('class=');
    expect(page.svg).not.toContain('vector-effect');
    expect(page.svg).toContain(TOKENS['plan-wall']!);
    expect(page.svg).toContain(`stroke="${TOKENS['plan-demolished']}"`);
  });

  test('a pane with Show Changes gets the legend and the Demolished Wall; one without, neither', () => {
    const { existing, plan, statuses } = optionA();
    const shown = buildSheet(one({ title: 'Option A', plan, changes: { existing, statuses } })).svg;
    expect(shown).toContain('data-testid="legend"');
    expect(shown).toContain('data-testid="demolished"');
    for (const s of ['Retained', 'Demolished', 'New']) expect(shown).toContain(`>${s}</text>`);
    const hidden = buildSheet(one({ title: 'Option A', plan })).svg;
    expect(hidden).not.toContain('data-testid="legend"');
    expect(hidden).not.toContain('data-testid="demolished"');
  });

  test('two panes side by side with a table go on A3, at one shared scale', () => {
    const { existing, plan, statuses } = optionA();
    const page = buildSheet({
      project: 'Home',
      title: 'Existing plan vs Option A',
      date,
      panes: [
        { title: 'Existing plan', plan: existing },
        { title: 'Option A', plan, changes: { existing, statuses } }
      ],
      table: { columns: ['', 'Existing plan', 'Option A'], rows: [['Total area', '68.4 m²', '68.9 m²']] }
    });
    expect(page.paper).toBe('a3');
    const panes = [...page.svg.matchAll(/data-testid="pane" data-x="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(panes).toHaveLength(2);
    expect(panes[1]! - panes[0]!).toBeGreaterThan(600);
    // Each pane's drawing in its own place, both at the same scale.
    const transforms = [...page.svg.matchAll(/translate\(([\d.-]+) [\d.-]+\) scale\(([\d.e-]+)\)/g)];
    expect(transforms).toHaveLength(2);
    expect(Number(transforms[1]![1]) - Number(transforms[0]![1])).toBeCloseTo(panes[1]! - panes[0]!, 0);
    expect(transforms[0]![2]).toBe(transforms[1]![2]);
    expect(count(page.svg, /Scale 1:\d+ at A3/g)).toBe(2);
    // Both panes title themselves; only the Scenario has a legend.
    expect(page.svg).toContain('>Option A</text>');
    expect(count(page.svg, /data-testid="legend"/g)).toBe(1);
    // The table.
    expect(page.svg).toContain('data-testid="table"');
    expect(page.svg).toContain('>Total area</text>');
    expect(page.svg).toContain('>68.9 m²</text>');
    // Patterns from the two drawings don't collide.
    const ids = [...page.svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('uses the largest architectural scale the plan fits at', () => {
    const page = buildSheet(one({ title: 'Existing plan', plan: house().p }));
    expect(page.scale).toBe(75);
    expect(page.svg).toContain('Scale 1:75 at A4');
    const box = (w: number) => ({ x0: 0, y0: 0, x1: w, y1: w / 2 });
    expect(chooseScale([box(4000)], { w: 1000, h: 600 })).toBe(50);
    expect(chooseScale([box(4000), box(40000)], { w: 1000, h: 600 })).toBe(200);
    expect(chooseScale([box(1e7)], { w: 1000, h: 600 })).toBeNull();
  });

  test('an empty plan still exports, saying so', () => {
    const page = buildSheet(one({ title: 'Existing plan', plan: emptyPlan() }));
    expect(page.svg).toContain('Nothing drawn yet');
  });
});

describe('flatten', () => {
  test('reads the plan and tint colours from the stylesheet', () => {
    expect(TOKENS['plan-wall']).toMatch(/^#[0-9a-f]{6}$/);
    expect(TOKENS['tint-kitchen']).toMatch(/^#[0-9a-f]{6}$/);
    expect(resolveVars('fill="var(--plan-new)"')).toBe(`fill="${TOKENS['plan-new']}"`);
    expect(() => resolveVars('fill="var(--nope)"')).toThrow(/--nope/);
  });

  test('turns screen-pixel strokes into drawing units at the scale', () => {
    expect(
      fixStrokes(
        '<path d="M0 0" stroke-width="1.5" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>',
        0.5
      )
    ).toBe('<path d="M0 0" stroke-width="3" stroke-dasharray="12 8"/>');
    expect(fixStrokes('<line stroke="red" vector-effect="non-scaling-stroke"/>', 0.25)).toBe(
      '<line stroke-width="4" stroke="red"/>'
    );
  });

  test('draws label halos as a stroked copy under the text', () => {
    const out = haloLabels(
      '<text x="1" y="2" fill="#000" dominant-baseline="middle" class="plan-label" style="stroke-width:30">Kitchen</text>',
      0.1,
      '#fff'
    );
    expect(out).toBe(
      '<text x="1" y="2" dominant-baseline="middle" alignment-baseline="middle" fill="#fff" stroke="#fff" stroke-width="30" stroke-linejoin="round" data-halo="3">Kitchen</text>' +
        '<text x="1" y="2" fill="#000" dominant-baseline="middle" alignment-baseline="middle">Kitchen</text>'
    );
  });
});

describe('file names', () => {
  test('come from the project and the Scenario', () => {
    expect(exportName('Home', 'Option A', 'pdf')).toBe('Home - Option A.pdf');
    expect(exportName('My/house?', 'Existing plan', 'png')).toBe('Myhouse - Existing plan.png');
    expect(exportName('', '', 'png')).toBe('house.png');
    expect(fileName('Home')).toBe('Home.renoplan.json');
  });
});
