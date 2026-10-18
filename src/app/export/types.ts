import type { Plan } from '@/core';
import type { ShownChanges } from '../editor/PlanDrawing';

/** One drawing on a sheet: a plan, with Show Changes when `changes` is given. */
export interface Pane {
  title: string;
  plan: Plan;
  changes?: ShownChanges | null;
}

/**
 * What an Export shows: one Scenario (or the Existing Plan), or a Comparison of two side by side with a
 * summary table under them.
 */
export interface Sheet {
  /** The Project's name, in the title block. */
  project: string;
  title: string;
  subtitle?: string;
  /** Printed in the title block; today if not given. */
  date?: Date;
  /** One or two panes, side by side. */
  panes: readonly Pane[];
  table?: { columns: readonly string[]; rows: readonly (readonly string[])[] };
}

export type Paper = 'a4' | 'a3';

/** A laid-out sheet: a standalone SVG document on landscape paper, `width` × `height` CSS pixels. */
export interface SheetPage {
  svg: string;
  paper: Paper;
  width: number;
  height: number;
  /** The architectural scale 1:N every pane is drawn at, or null if the plan is too big for any. */
  scale: number | null;
}

export type ExportFormat = 'png' | 'pdf';
