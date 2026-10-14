import { expect, test } from '@playwright/test';
import { addRoom, centre, drag, newHouse, place, roomBox } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', (e) => {
    throw e;
  });
});

test('capture a house: outline, rooms, snapping, shared wall, door, undo, autosave', async ({ page }) => {
  await newHouse(page);
  await expect(page.getByText('Unlabelled', { exact: true })).toBeVisible();

  // A whole house can be typed in one go: Enter adds and returns to the name field.
  await addRoom(page, 'Living', '4', '3.8');
  await expect(page.getByLabel('Room name')).toBeFocused();
  await addRoom(page, 'Kitchen', '3', '3.8');
  await page.keyboard.press('Escape');
  await expect(page.getByText('0 of 2 placed')).toBeVisible();

  // Drag Living into the top-left inside corner of the Outline, and Kitchen beside it.
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'Living', inside.x + 2, inside.y + 2);
  const living = await roomBox(page, 'Living');
  await place(page, 'Kitchen', living.x + living.width + 6, living.y + 2);
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 of 2 placed')).toBeVisible();

  // The Wall between them is one Shared Wall, with a Room on each side.
  const l2 = await roomBox(page, 'Living');
  await page.mouse.click(l2.x + l2.width + 2, l2.y + l2.height / 2);
  await expect(page.getByRole('heading', { name: /Shared wall/ })).toBeVisible();
  await expect(page.getByLabel('Living width')).toHaveValue('4.00');
  await expect(page.getByLabel('Kitchen width')).toHaveValue('3.00');

  // Editing a dimension moves the Shared Wall: both Rooms resize together.
  await page.getByLabel('Living width').fill('4.5');
  await page.getByLabel('Living width').press('Enter');
  await expect(page.getByLabel('Kitchen width')).toHaveValue('2.50');

  // A door at the click point.
  await page.getByRole('button', { name: 'Door' }).click();
  await expect(page.getByRole('heading', { name: /Door/ })).toBeVisible();
  await expect(page.locator('[data-hit^="opening:"]')).toHaveCount(1);

  // Undo and redo.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('[data-hit^="opening:"]')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('[data-hit^="opening:"]')).toHaveCount(1);

  // Autosave: a reload brings everything back.
  await page.reload();
  await expect(page.locator('[data-hit^="opening:"]')).toHaveCount(1);
  await expect(page.getByText('2 of 2 placed')).toBeVisible();
});

test('dropping a room on another shows an Overlap; dragging a shared wall resizes both sides', async ({
  page
}) => {
  await newHouse(page, '12', '9');
  await addRoom(page, 'A', '4', '4');
  await addRoom(page, 'B', '4', '4');
  await page.keyboard.press('Escape');
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'A', inside.x + 2, inside.y + 2);
  const a = await roomBox(page, 'A');

  // Dropped half on top of A: shown as an Overlap, never blocked.
  await place(page, 'B', a.x + a.width / 2, a.y + a.height / 3);
  await expect(page.getByText('Overlaps another room.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');

  // Snapped beside A instead: dragging the Shared Wall on the canvas resizes both.
  await place(page, 'B', a.x + a.width + 6, a.y + 2);
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('4.00');
  await drag(page, { x: a.x + a.width + 2, y: a.y + a.height / 2 }, 20, 0);
  await expect(page.getByRole('heading', { name: /Shared wall/ })).toBeVisible();
  const wa = Number(await page.getByLabel('A width').inputValue());
  const wb = Number(await page.getByLabel('B width').inputValue());
  expect(wa).toBeGreaterThan(4);
  expect(wa + wb).toBeCloseTo(8, 5);
});

test('naming Unlabelled Space makes a room; merging removes the wall', async ({ page }) => {
  await newHouse(page, '8', '6');
  await addRoom(page, 'Bed', '3.8', '5.6');
  await page.keyboard.press('Escape');
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'Bed', inside.x + 2, inside.y + 2);
  await page.keyboard.press('Escape');
  const space = (await page.locator('[data-hit="space"]').boundingBox())!;
  await page.mouse.click(space.x + space.width / 2, space.y + space.height / 2);
  await expect(page.getByRole('heading', { name: /Unlabelled space/ })).toBeVisible();
  await page.getByRole('button', { name: 'Make it a room' }).click();
  await expect(page.getByRole('heading', { name: /^Room/ })).toBeVisible();
  await expect(page.locator('[data-hit="space"]')).toHaveCount(0);

  const bed = await roomBox(page, 'Bed');
  await page.mouse.click(bed.x + bed.width + 2, bed.y + bed.height / 2);
  await page.getByRole('button', { name: 'Remove wall — merge rooms' }).click();
  await expect(page.locator('[data-hit^="room:"]')).toHaveCount(1);
});

test('the exterior wall stays put: dragging it resizes the room against it', async ({ page }) => {
  await newHouse(page, '8', '6');
  await addRoom(page, 'Bed', '3', '3');
  await page.keyboard.press('Escape');
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'Bed', inside.x + 2, inside.y + 2);
  const outline = await page.getByLabel('W', { exact: true }).count();
  expect(outline).toBe(1);
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('3.00');
  const bed = await roomBox(page, 'Bed');
  // Grab the top exterior wall above Bed and pull it down.
  await drag(page, { x: bed.x + bed.width / 2, y: bed.y - 4 }, 0, 25);
  // The selection follows what moved: Bed's own new wall (the exterior one stayed put).
  await expect(page.getByRole('heading', { name: /^Wall/ })).toBeVisible();
  const bed2 = await roomBox(page, 'Bed');
  expect(bed2.y).toBeGreaterThan(bed.y + 10);
  await page.mouse.click(centre(bed2).x, centre(bed2).y);
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('3.00');
  expect(Number(await page.getByLabel('L', { exact: true }).inputValue())).toBeLessThan(3);
  // The Outline stayed as measured.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('W', { exact: true })).toHaveValue('8.00');
});

test('save a file and open it again', async ({ page }) => {
  await newHouse(page, '9', '7');
  await addRoom(page, 'Study', '3', '3');
  await page.getByLabel('Project name').fill('Beach house');
  await page.getByLabel('Project name').press('Enter');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('Beach house.renoplan.json');
  const file = await download.path();

  await page.getByRole('button', { name: 'All projects' }).click();
  await expect(page.getByRole('button', { name: /^Beach house edited/ })).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Open file' }).click()
  ]);
  await chooser.setFiles(file);
  // The same project is already here: replacing it asks first.
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByLabel('Project name')).toHaveValue('Beach house');
  await expect(page.locator('[data-hit^="room:"]')).toHaveCount(1);
});
