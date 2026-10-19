import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { addRoom, drag, newHouse, place, roomBox } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** A 10 × 8 m house with Living (4 × 3.8 m) and Kitchen (3 × 3.8 m) side by side, sharing a Wall. */
async function twoRooms(page: Page) {
  await newHouse(page);
  await addRoom(page, 'Living', '4', '3.8');
  await addRoom(page, 'Kitchen', '3', '3.8');
  await page.keyboard.press('Escape');
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'Living', inside.x + 2, inside.y + 2);
  const living = await roomBox(page, 'Living');
  await place(page, 'Kitchen', living.x + living.width + 6, living.y + 2);
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 of 2 placed')).toBeVisible();
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Scenarios' });
const summary = (page: Page) => page.getByRole('table', { name: 'Comparison summary' });
const row = (page: Page, label: string) =>
  summary(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
const transform = (page: Page, which: 'left' | 'right') =>
  page.getByTestId(`compare-${which}`).locator('g[data-view]').getAttribute('transform');

async function pick(page: Page, side: 'Left side' | 'Right side', name: string) {
  await page.getByRole('combobox', { name: side }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('Comparison: the Existing Plan against a Scenario that demolishes a Shared Wall', async ({ page }) => {
  await twoRooms(page);
  await expect(tabs(page).getByRole('button', { name: 'Compare' })).toBeDisabled();

  await page.getByRole('button', { name: 'New scenario' }).click();
  const living = await roomBox(page, 'Living');
  await page.mouse.click(living.x + living.width + 2, living.y + living.height / 2);
  await page.getByRole('button', { name: 'Demolish wall — merge rooms' }).click();
  await page.keyboard.press('Escape');

  await tabs(page).getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Comparison' })).toBeVisible();
  // The editor's chrome is gone; the Export spot is there, not yet wired.
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export comparison' })).toBeEnabled();

  // Pick the sides: the Existing plan on the left, the Scenario on the right.
  await pick(page, 'Right side', 'Existing plan');
  await expect(summary(page).getByRole('columnheader')).toHaveText([
    'Room',
    'Existing plan',
    'Existing plan'
  ]);
  await pick(page, 'Left side', 'Existing plan');
  await pick(page, 'Right side', 'Option A');
  await expect(summary(page).getByRole('columnheader')).toHaveText(['Room', 'Existing plan', 'Option A']);

  // Both panes are drawn read-only; the right one with Show Changes.
  await expect(page.getByTestId('compare-left').locator('[data-hit]')).toHaveCount(0);
  await expect(page.getByTestId('compare-left').getByTestId('demolished')).toHaveCount(0);
  await expect(page.getByTestId('compare-right').getByTestId('demolished')).toHaveAttribute('d', /M/);

  // The table: one Wall demolished, and the merged Room's area.
  await expect(row(page, 'Walls demolished').getByRole('cell')).toHaveText(['0', /^1 · 3\.\d\d m$/]);
  await expect(row(page, 'Living').getByRole('cell')).toHaveText(['15.2 m²', '27.0 m²']);
  await expect(row(page, 'Kitchen').getByRole('cell')).toHaveText(['11.4 m²', 'Merged into Living']);
  await expect(row(page, 'Room area').getByRole('cell')).toHaveText(['26.6 m²', '27.0 m²']);

  // Panning one pane moves the other.
  const before = await transform(page, 'left');
  const left = (await page.getByTestId('compare-left').boundingBox())!;
  await drag(page, { x: left.x + left.width / 2, y: left.y + left.height / 2 }, 120, 60);
  const panned = await transform(page, 'left');
  expect(panned).not.toBe(before);
  expect(await transform(page, 'right')).toBe(panned);

  // Zooming the other pane zooms both.
  const right = (await page.getByTestId('compare-right').boundingBox())!;
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(() => transform(page, 'right')).not.toBe(panned);
  expect(await transform(page, 'left')).toBe(await transform(page, 'right'));

  // Done returns to the editor, in the Scenario it came from.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Comparison' })).toHaveCount(0);
  await expect(tabs(page).getByRole('button', { name: 'Option A', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.locator('[data-hit^="room:"]')).toHaveCount(1);

  // From the Existing plan, Escape returns there too.
  await tabs(page).getByText('Existing plan').click();
  await tabs(page).getByRole('button', { name: 'Compare' }).click();
  await expect(summary(page).getByRole('columnheader')).toHaveText(['Room', 'Existing plan', 'Option A']);
  await page.keyboard.press('Escape');
  await expect(tabs(page).getByRole('button', { name: 'Existing plan' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.locator('[data-hit^="room:"]')).toHaveCount(2);
});

test('a compared Scenario with Conflicts shows them as a passive warning', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  const living = await roomBox(page, 'Living');
  await page.mouse.click(living.x + living.width + 2, living.y + living.height / 2);
  await page.keyboard.press('Delete');

  // The Kitchen is deleted from the existing plan after all: the demolition no longer applies.
  await tabs(page).getByText('Existing plan').click();
  const kitchen = await roomBox(page, 'Kitchen');
  await page.mouse.click(kitchen.x + kitchen.width / 2, kitchen.y + kitchen.height / 2);
  await page.keyboard.press('Delete');

  await tabs(page).getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('region', { name: 'Right side' }).getByRole('status')).toHaveText(
    '1 conflict skipped'
  );
  await expect(page.getByRole('region', { name: 'Left side' }).getByRole('status')).toHaveCount(0);
});

test('a Comparison exports as PDF and PNG, named for both sides', async ({ page }) => {
  await twoRooms(page);
  await tabs(page).getByRole('button', { name: 'New scenario' }).click();
  const living = await roomBox(page, 'Living');
  await page.mouse.click(living.x + living.width + 2, living.y + living.height / 2);
  await page.keyboard.press('Delete');
  await tabs(page).getByRole('button', { name: 'Compare' }).click();
  await expect(summary(page)).toBeVisible();

  for (const [item, magic, ext] of [
    ['PDF document', '%PDF', 'pdf'],
    ['PNG image', '\x89PNG', 'png']
  ] as const) {
    await page.getByRole('button', { name: 'Export comparison' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: item }).click()
    ]);
    expect(download.suggestedFilename()).toBe(`Untitled house - Existing plan vs Option A.${ext}`);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe(magic);
  }
});
