import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { addRoom, drag, newHouse, place, roomBox } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** A 10 × 8 m house with Living (4 × 3.8 m) in its top left corner and Kitchen beside it. */
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

const rooms = (page: Page) => page.locator('[data-hit^="room:"]');
const extensionArea = async (page: Page) =>
  Number((await page.getByTestId('extension-area').textContent())!.replace(/[^\d.]/g, ''));
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Scenarios' });
const row = (page: Page, label: string) =>
  page
    .getByRole('table', { name: 'Comparison summary' })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });

test('an Extension: drawn against the outside of the house, grown, and opened into', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  const living = await roomBox(page, 'Living');
  // Screen pixels per millimetre: Living is 4 m across inside.
  const k = living.width / 4000;
  // The top exterior Wall's centreline is 100 mm above Living's inside face.
  const wallY = living.y - 100 * k;

  // Draw Room from the top exterior Wall, outward, over the middle of Living.
  await page.keyboard.press('r');
  await drag(page, { x: living.x + living.width * 0.25, y: wallY }, living.width * 0.5, -2000 * k);
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.type('Studio');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(rooms(page)).toHaveCount(3);

  // A New Room, flagged as an Extension on the canvas and in the panel.
  await expect(page.getByTestId('extension')).toHaveAttribute('d', /M/);
  await expect(page.locator('svg text', { hasText: 'EXTENSION' })).toHaveCount(1);
  const drawn = await extensionArea(page);
  expect(drawn).toBeGreaterThan(3);
  await expect(page.getByText(/^Extends .* beyond the existing plan/)).toBeVisible();
  // Show Changes off: still flagged.
  await page.getByRole('button', { name: 'Show changes' }).click();
  await expect(page.getByTestId('extension')).toHaveAttribute('d', /M/);
  await page.getByRole('button', { name: 'Show changes' }).click();

  // Its outer Wall moves when dragged: the Extension grows.
  const studio = await roomBox(page, 'Studio');
  await drag(page, { x: studio.x + studio.width / 2, y: studio.y - 2 }, 0, -500 * k);
  await expect(page.getByRole('heading', { name: /Extension wall/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => extensionArea(page)).toBeGreaterThan(drawn + 1);
  const grown = await extensionArea(page);

  // Demolishing the old exterior Wall between them opens Living into the Studio.
  await page.mouse.click(studio.x + studio.width / 2, wallY);
  await page.getByRole('button', { name: 'Demolish wall — merge rooms' }).click();
  await page.keyboard.press('Escape');
  await expect(rooms(page)).toHaveCount(2);
  await expect(page.locator('svg text', { hasText: 'Studio' })).toHaveCount(0);
  await expect(page.getByText('Demolished the wall between Studio and Living')).toBeVisible();
  expect(await extensionArea(page)).toBe(grown);

  // An Export of the Scenario still succeeds.
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'PNG image' }).click()
  ]);
  const png = await readFile((await download.path())!);
  expect(png.subarray(0, 4).toString('latin1')).toBe('\x89PNG');

  // The Comparison shows the Extension area against the Existing Plan.
  await tabs(page).getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('combobox', { name: 'Left side' }).click();
  await page.getByRole('option', { name: 'Existing plan', exact: true }).click();
  await page.getByRole('combobox', { name: 'Right side' }).click();
  await page.getByRole('option', { name: 'Option A', exact: true }).click();
  await expect(row(page, 'Extension area').getByRole('cell')).toHaveText([
    '0.0 m²',
    `${grown.toFixed(1)} m²`
  ]);
  await expect(page.getByTestId('compare-right').getByTestId('extension')).toHaveAttribute('d', /M/);
  await expect(page.getByTestId('compare-left').getByTestId('extension')).toHaveCount(0);
});
