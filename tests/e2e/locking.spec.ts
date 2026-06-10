import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
});

test('locks a baseline and creates a bounded renovation scenario', async ({
  page
}) => {
  await page.getByTestId('add-bedroom').click();
  await page.getByTestId('add-kitchen').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();

  await page.getByTestId('wall-bedroom-1-north-48-192-hitbox').click();
  await expect(page.getByRole('menu', { name: 'Wall actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add door/opening' }).click();
  await expect(page.getByText('Openings')).toBeVisible();
  await expect(page.getByTestId('selected-wall-openings')).toHaveText('1');
  await page.getByLabel('Offset m').fill('0.50');
  await expect(page.getByLabel('Offset m')).toHaveValue('0.50');

  await page.getByRole('button', { name: 'Lock baseline' }).click();
  await expect(page.getByText('Existing v1 · Locked baseline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset setup' })).toHaveCount(
    0
  );
  await expect(page.getByRole('button', { name: 'Edit setup' })).toHaveCount(0);
  await expect(
    page.getByRole('application', {
      name: 'Locked floor plan canvas. Review the existing baseline.'
    })
  ).toBeVisible();
  await expect(page.getByTestId('locked-baseline-bounds')).toBeVisible();

  const bedroom = page.getByRole('button', { name: 'Select Bedroom' });
  const lockedCanvas = page.getByRole('application', {
    name: 'Locked floor plan canvas. Review the existing baseline.'
  });
  const beforeLockBox = await bedroom.boundingBox();
  if (!beforeLockBox) throw new Error('Bedroom was not rendered');
  await bedroom.dragTo(lockedCanvas, {
    targetPosition: { x: 900, y: 500 }
  });
  const afterLockBox = await bedroom.boundingBox();
  expect(afterLockBox?.x).toBeCloseTo(beforeLockBox.x, 1);
  expect(afterLockBox?.y).toBeCloseTo(beforeLockBox.y, 1);

  await page.getByRole('button', { name: 'Create renovation plan' }).click();
  await expect(
    page.getByText('Renovation plan · Editable renovation copy')
  ).toBeVisible();
  await expect(page.getByTestId('scenario-bounds')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add wall' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bathroom' }).click();
  await expect(
    page.getByRole('button', { name: 'Select proposed Bathroom 1' })
  ).toBeVisible();
  await expect(page.getByText('Proposed room')).toBeVisible();
  await page.getByLabel('Name').fill('New ensuite');
  await expect(
    page.getByRole('button', { name: 'Select proposed New ensuite' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete room' }).click();
  await expect(
    page.getByRole('button', { name: 'Select proposed New ensuite' })
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Existing' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Renovation', exact: true })
  ).toBeVisible();

  const scenarioBox = await bedroom.boundingBox();
  if (!scenarioBox) throw new Error('Scenario bedroom was not rendered');
  const canvas = page.getByRole('application', { name: /Floor plan canvas/ });
  await bedroom.dragTo(canvas, {
    targetPosition: { x: 900, y: 500 }
  });
  const draggedBox = await bedroom.boundingBox();
  expect(draggedBox?.x).toBeGreaterThanOrEqual(scenarioBox.x);
  expect(draggedBox?.x).toBeLessThan(900);

  await page.getByRole('button', { name: 'Existing' }).click();
  await expect(page.getByText('Existing v1 · Locked baseline')).toBeVisible();
  await page.getByRole('button', { name: 'Renovation', exact: true }).click();
  await expect(
    page.getByText('Renovation plan · Editable renovation copy')
  ).toBeVisible();
});
