import { type Page, expect, test } from '@playwright/test';
import { addRoom, drag, newHouse, place, roomBox } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** A 10 × 8 m house with Living and Kitchen side by side, sharing a Wall. */
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

const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Scenarios' }).getByText(name);
const rooms = (page: Page) => page.locator('[data-hit^="room:"]');

test('a Scenario demolishes a Shared Wall; the existing plan is untouched; it survives a reload', async ({
  page
}) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  await expect(tab(page, 'Option A')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This scenario' })).toBeVisible();

  const living = await roomBox(page, 'Living');
  await page.mouse.click(living.x + living.width + 2, living.y + living.height / 2);
  await page.getByRole('button', { name: 'Demolish wall — merge rooms' }).click();
  await expect(rooms(page)).toHaveCount(1);

  // Show Changes draws it dashed where it was; the Change is listed.
  await expect(page.getByTestId('demolished')).toHaveAttribute('d', /M/);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Demolished the wall between Living and Kitchen')).toBeVisible();

  // Toggling Show Changes off hides the dashed Wall.
  await page.getByRole('button', { name: 'Show changes' }).click();
  await expect(page.getByTestId('demolished')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show changes' }).click();

  // The existing plan still has both Rooms.
  await tab(page, 'Existing plan').click();
  await expect(rooms(page)).toHaveCount(2);

  // Undo in the Scenario undoes its Change only.
  await tab(page, 'Option A').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rooms(page)).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rooms(page)).toHaveCount(1);

  await page.reload();
  await expect(rooms(page)).toHaveCount(2);
  await tab(page, 'Option A').click();
  await expect(rooms(page)).toHaveCount(1);
});

test('Draw Wall divides a Room; naming the part it cuts off makes a New Room', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  const spaces = await page.locator('[data-hit="space"]').count();

  // Draw a Wall down through Living, from the exterior Wall above to the Wall below it.
  const living = await roomBox(page, 'Living');
  await page.keyboard.press('w');
  await expect(page.getByRole('button', { name: 'Draw wall' })).toHaveAttribute('aria-pressed', 'true');
  const x = living.x + living.width * 0.3;
  await drag(page, { x, y: living.y - 8 }, 0, living.height + 12);
  await expect(page.getByRole('heading', { name: /Drawn wall/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Draw wall' })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^New wall, /)).toBeVisible();
  await expect(page.getByTestId('new-walls')).toHaveAttribute('d', /M/);

  // Living keeps the larger part; the rest is Unlabelled Space.
  await expect(page.locator('[data-hit="space"]')).toHaveCount(spaces + 1);
  await page.mouse.click(living.x + living.width * 0.12, living.y + living.height / 2);
  await expect(page.getByRole('heading', { name: /Unlabelled space/ })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Pantry');
  await page.getByRole('button', { name: 'Make it a room' }).click();
  await expect(rooms(page)).toHaveCount(3);
  await expect(page.getByText('New in this scenario.', { exact: false })).toBeVisible();
  await expect(page.locator('svg text', { hasText: 'NEW' })).toHaveCount(1);
});

test('Draw Room makes a Room of part of a space: one Change, named as it is drawn', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  const space = (await page.locator('[data-hit="space"]').boundingBox())!;
  const spaces = await page.locator('[data-hit="space"]').count();

  // A rectangle in the middle of the Unlabelled Space, nowhere near a Wall.
  await page.keyboard.press('r');
  const from = { x: space.x + space.width * 0.55, y: space.y + space.height * 0.55 };
  await drag(page, from, space.width * 0.3, space.height * 0.3);
  await expect(page.getByRole('heading', { name: /^Room/ })).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
  await page.keyboard.type('Study');
  await page.keyboard.press('Enter');
  await expect(page.locator('svg text', { hasText: 'Study' })).toHaveCount(1);
  await expect(rooms(page)).toHaveCount(3);
  // The rest of the space is still Unlabelled.
  await expect(page.locator('[data-hit="space"]')).toHaveCount(spaces);

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByText('New room: Study')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Changes' })).toContainText('1');
  // One undo step removes it.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(rooms(page)).toHaveCount(2);
});

test('an existing-plan edit underneath a Scenario shows as a Conflict', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  const living = await roomBox(page, 'Living');
  await page.mouse.click(living.x + living.width + 2, living.y + living.height / 2);
  await page.keyboard.press('Delete');
  await expect(rooms(page)).toHaveCount(1);

  // In the existing plan, the Kitchen is deleted after all.
  await tab(page, 'Existing plan').click();
  const kitchen = await roomBox(page, 'Kitchen');
  await page.mouse.click(kitchen.x + kitchen.width / 2, kitchen.y + kitchen.height / 2);
  await page.keyboard.press('Delete');
  await expect(rooms(page)).toHaveCount(1);

  await expect(page.getByTitle('1 conflict')).toBeVisible();
  await tab(page, 'Option A').click();
  await expect(page.getByText(/^Conflict:/)).toBeVisible();
  await page.getByRole('button', { name: /^Remove change/ }).click();
  await expect(page.getByTitle('1 conflict')).toHaveCount(0);
});

test('scenarios can be renamed, duplicated and deleted', async ({ page }) => {
  await twoRooms(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  await page.getByRole('button', { name: 'Option A options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByLabel('Scenario name').fill('Open kitchen');
  await page.getByLabel('Scenario name').press('Enter');
  await expect(tab(page, 'Open kitchen')).toBeVisible();

  await page.getByRole('button', { name: 'Open kitchen options' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(tab(page, 'Open kitchen copy')).toBeVisible();

  await page.getByRole('button', { name: 'Open kitchen copy options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(tab(page, 'Open kitchen copy')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Outline' })).toBeVisible();
});
