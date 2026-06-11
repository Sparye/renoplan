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
  await expect(page.getByText('Renoplan dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByText('Project details')).toBeVisible();
  await page.getByLabel('Project name').fill('Kitchen renovation');
  await page.getByRole('button', { name: 'Continue' }).click();

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
  await expect(
    page.getByText('Baseline · Locked existing layout')
  ).toBeVisible();
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

  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByText('Renovation 1 · Proposed layout')).toBeVisible();
  await expect(page.getByTestId('scenario-bounds')).toBeVisible();
  await expect(page.getByTestId('reference-bedroom-1')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Bedroom' })
  ).toHaveCount(0);
  await page.getByLabel('Reference background').uncheck();
  await expect(page.getByTestId('reference-bedroom-1')).toHaveCount(0);
  await expect(page.getByTestId('scenario-bounds')).toBeVisible();
  await page.getByLabel('Reference background').check();
  await expect(page.getByRole('button', { name: 'Add wall' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bathroom' }).click();
  await expect(
    page.getByRole('button', { name: 'Select proposed Bathroom 1' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Proposed room' })
  ).toBeVisible();
  await page.getByLabel('Room name').fill('New ensuite');
  await expect(
    page.getByRole('button', { name: 'Select proposed New ensuite' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete room' }).click();
  await expect(
    page.getByRole('button', { name: 'Select proposed New ensuite' })
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bathroom' }).click();
  const proposedRoom = page.getByRole('button', {
    name: 'Select proposed Bathroom 1'
  });
  await expect(proposedRoom).toBeVisible();
  await expect(page.getByRole('button', { name: 'Baseline' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Renovation 1' })
  ).toBeVisible();

  const scenarioBox = await proposedRoom.boundingBox();
  if (!scenarioBox) throw new Error('Proposed room was not rendered');
  const canvas = page.getByRole('application', { name: /Floor plan canvas/ });
  await proposedRoom.dragTo(canvas, {
    targetPosition: { x: 900, y: 500 }
  });
  const draggedBox = await proposedRoom.boundingBox();
  expect(draggedBox?.x).toBeGreaterThanOrEqual(scenarioBox.x);
  expect(draggedBox?.x).toBeLessThan(900);

  await page.getByRole('button', { name: 'Baseline' }).click();
  await expect(
    page.getByText('Baseline · Locked existing layout')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Renovation 1' }).click();
  await expect(page.getByText('Renovation 1 · Proposed layout')).toBeVisible();

  await page.getByRole('button', { name: 'All projects' }).click();
  await expect(page.getByText('Renoplan dashboard')).toBeVisible();
  await expect(page.getByText('Kitchen renovation')).toBeVisible();
  await expect(page.getByText('Locked baseline · 1 scenarios')).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page.getByText('Project details')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('add-bedroom')).toBeVisible();
  await page.getByRole('button', { name: 'Dashboard' }).click();
  await expect(page.getByText('Renoplan dashboard')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lock baseline' })).toHaveCount(
    0
  );
});
