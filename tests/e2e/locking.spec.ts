import { expect, test, type Page } from '@playwright/test';

async function expectSidebarFormControlsToFit(page: Page) {
  const offenders = await page
    .getByRole('complementary')
    .evaluate((sidebar) => {
      const sidebarBox = sidebar.getBoundingClientRect();
      const controls = Array.from(
        sidebar.querySelectorAll('input, select, textarea')
      );

      return controls
        .filter((control) => {
          const element = control;
          const box = element.getBoundingClientRect();

          return (
            box.width > 0 &&
            box.height > 0 &&
            (box.left < sidebarBox.left - 1 || box.right > sidebarBox.right + 1)
          );
        })
        .map((control) => {
          const element = control;
          const box = element.getBoundingClientRect();

          return {
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute('type'),
            left: box.left,
            right: box.right,
            sidebarLeft: sidebarBox.left,
            sidebarRight: sidebarBox.right
          };
        });
    });

  expect(offenders).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
});

test('selects and resizes rooms while configuring an unlocked baseline', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();

  const bedroom = page.getByRole('button', { name: 'Select Bedroom' });
  await expect(bedroom).toBeVisible();
  await bedroom.click({ position: { x: 32, y: 32 } });
  const inspector = page.getByRole('complementary');
  await expect(inspector.getByText('Selected room')).toBeVisible();
  await expect(inspector.getByText('1.50m x 1.50m')).toBeVisible();

  const eastHandle = page.getByTestId('resize-bedroom-1-e');
  const handleBox = await eastHandle.boundingBox();
  if (!handleBox) throw new Error('Bedroom resize handle was not rendered');

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 60,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.up();

  await expect(inspector.getByText('2.25m x 1.50m')).toBeVisible();
});

test('scales the canvas viewport for a large measured room', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('6');
  await page.getByLabel('Depth m').fill('13.4');
  await page.getByRole('button', { name: 'Create plan' }).click();

  const canvas = page.getByRole('application', {
    name: 'Floor plan canvas. Drag room blocks to arrange the existing plan.'
  });
  const bedroom = page.getByRole('button', { name: 'Select Bedroom' });

  await expect(bedroom).toBeVisible();
  await expect(canvas).toHaveAttribute('viewBox', '0 0 1008 1382.4');

  const canvasBox = await canvas.boundingBox();
  const bedroomBox = await bedroom.boundingBox();
  if (!canvasBox || !bedroomBox) throw new Error('Canvas did not render');

  expect(bedroomBox.y + bedroomBox.height).toBeLessThanOrEqual(
    canvasBox.y + canvasBox.height + 1
  );
});

test('keeps wall actions menu inside the browser viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('8');
  await page.getByLabel('Depth m').fill('4');
  await page.getByRole('button', { name: 'Create plan' }).click();

  const scroller = page.locator('.overflow-auto').last();
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  await page
    .locator('[data-testid^="wall-bedroom-1-east"][data-testid$="-hitbox"]')
    .click({ position: { x: 8, y: 40 } });

  const menu = page.getByRole('menu', { name: 'Wall actions' });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  if (!menuBox) throw new Error('Wall actions menu was not rendered');

  expect(menuBox.x).toBeGreaterThanOrEqual(8);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(632);
});

test('keeps precise setup measurements instead of rounding to the grid', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Width m').click();
  await page.keyboard.type('2.8');
  await expect(page.getByLabel('Width m')).toHaveValue('2.8');

  await page.getByRole('button', { name: 'Create plan' }).click();

  const bedroom = page.getByRole('button', { name: 'Select Bedroom' });
  await expect(bedroom).toBeVisible();
  await bedroom.click({ position: { x: 32, y: 32 } });

  await expect(page.getByRole('complementary')).toContainText('2.80m x 1.50m');
});

test('fine tunes baseline room dimensions from the inspector', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();

  await page.getByRole('button', { name: 'Select Bedroom' }).click();
  const inspector = page.getByRole('complementary');

  await inspector.getByLabel('Width m').click();
  await page.keyboard.type('2.8');
  await expect(inspector.getByLabel('Width m')).toHaveValue('2.8');
  await expect(inspector).toContainText('2.80m x 1.50m');

  await inspector.getByLabel('Depth m').click();
  await page.keyboard.type('3.2');
  await expect(inspector.getByLabel('Depth m')).toHaveValue('3.2');
  await expect(inspector).toContainText('2.80m x 3.20m');
});

test('adds and merges rooms while configuring an unlocked baseline', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();

  await page.getByRole('button', { name: 'Select Bedroom' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bathroom' }).click();

  await expect(
    page.getByRole('button', { name: 'Select Bathroom' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Merge with Bedroom' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Merge with Bedroom' }).click();

  await expect(
    page.getByRole('button', { name: 'Select Bathroom + Bedroom' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Bedroom' })
  ).toHaveCount(0);
});

test('removes rooms while configuring an unlocked baseline', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();

  await page.getByRole('button', { name: 'Select Bedroom' }).click();
  await expect(page.getByRole('button', { name: 'Remove room' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove room' }).click();

  await expect(
    page.getByRole('button', { name: 'Select Bedroom' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Lock baseline' })
  ).toBeDisabled();
});

test('creates an existing baseline from whole-area dimensions', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('5.5');
  await page.getByLabel('Length m').fill('8');
  await expect(
    page.getByText('Preview: width is horizontal, length is vertical')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Swap width/length' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  const wholeArea = page.getByRole('button', { name: 'Select Whole area' });
  await expect(wholeArea).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('8.00m x 5.50m');
  await expect(page.getByRole('complementary')).toContainText('1');
});

test('creates an existing baseline from whole-area dimensions and rooms', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('7');
  await page.getByLabel('Length m').fill('9');
  await page.getByTestId('add-bedroom').click();
  await page.getByTestId('add-kitchen').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByText('Add measurements inside the whole area')
  ).toBeVisible();
  await page.getByLabel('Width m').first().fill('3.4');
  await page.getByLabel('Depth m').first().fill('3');
  await page.getByRole('button', { name: 'Create plan' }).click();

  await expect(
    page.getByRole('button', { name: 'Select Whole area' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Bedroom' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Select Kitchen' })
  ).toBeVisible();
  await expect(page.getByRole('complementary')).toContainText('3');
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

  await page
    .getByTestId('wall-bedroom-1-north-48-192-hitbox')
    .click({ position: { x: 20, y: 9 } });
  await expect(page.getByRole('menu', { name: 'Wall actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add door/opening' }).click();
  await expect(page.getByText('Openings')).toBeVisible();
  await expect(page.getByTestId('selected-wall-openings')).toHaveText('1');
  await expectSidebarFormControlsToFit(page);
  await page.getByLabel('Offset m').click();
  await page.keyboard.type('0.5');
  await expect(page.getByLabel('Offset m')).toHaveValue('0.5');

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
  await page.getByRole('button', { name: 'Add wall' }).click();
  await expect(
    page.getByRole('heading', { name: 'Selected wall' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Proposed wall' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete wall' }).click();
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

  await proposedRoom.click();
  await page.getByRole('button', { name: 'Window' }).first().click();
  await expect(page.getByLabel('Position along wall')).toBeVisible();
  await expectSidebarFormControlsToFit(page);

  await page.getByRole('button', { name: 'Baseline' }).click();
  await expect(
    page.getByText('Baseline · Locked existing layout')
  ).toBeVisible();
  await page.getByRole('button', { name: 'Renovation 1' }).click();
  await expect(page.getByText('Renovation 1 · Proposed layout')).toBeVisible();
  await proposedRoom.click();
  const positionSlider = page.getByLabel('Position along wall');
  await positionSlider.evaluate((input) => {
    if (input instanceof HTMLInputElement) {
      input.value = '24';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await expect(
    page.getByRole('heading', { name: 'Proposed room' })
  ).toBeVisible();
  await expect(positionSlider).toBeVisible();

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

test('keeps a tall renovation room inspector scrollable within the sidebar', async ({
  page
}) => {
  await page.setViewportSize({ width: 1024, height: 620 });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Sidebar scroll test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('add-bedroom').click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await page.getByRole('button', { name: 'Lock baseline' }).click();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bathroom' }).click();

  const inspector = page.getByRole('complementary');
  await expect(
    page.getByRole('button', { name: 'Select proposed Bathroom 1' })
  ).toBeVisible();
  await expect(
    inspector.getByRole('heading', { name: 'Proposed room' })
  ).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    await inspector.getByRole('button', { name: 'Window' }).first().click();
  }
  await expectSidebarFormControlsToFit(page);

  const sidebarMetrics = await inspector.evaluate((element) => {
    const style = window.getComputedStyle(element);

    return {
      clientHeight: element.clientHeight,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight
    };
  });

  expect(sidebarMetrics.overflowY).toBe('auto');
  expect(sidebarMetrics.scrollHeight).toBeGreaterThan(
    sidebarMetrics.clientHeight
  );

  const pageMetrics = await page.evaluate(() => ({
    bodyScrollHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
  }));

  expect(pageMetrics.bodyScrollHeight).toBeLessThanOrEqual(
    pageMetrics.viewportHeight + 1
  );
});

test('keeps precise proposed room measurements from inspector inputs', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('6');
  await page.getByLabel('Length m').fill('8');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Lock baseline' }).click();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bedroom' }).click();

  const inspector = page.getByRole('complementary');
  await inspector.getByLabel('Width m').click();
  await page.keyboard.type('2.8');
  await expect(inspector.getByLabel('Width m')).toHaveValue('2.8');
  await expect(page.getByText('2.80m width')).toBeVisible();
});

test('resizes a proposed room after adding an opening to its wall', async ({
  page
}) => {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Width m').fill('6');
  await page.getByLabel('Length m').fill('8');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Lock baseline' }).click();
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await page.getByRole('button', { name: 'Add room' }).click();
  await page.getByRole('menuitem', { name: 'Bedroom' }).click();

  const proposedRoom = page.getByRole('button', {
    name: 'Select proposed Bedroom 1'
  });
  await expect(proposedRoom).toBeVisible();
  await page.getByRole('button', { name: 'Window' }).first().click();

  const eastHandle = page.locator(
    '[data-testid^="resize-proposed-room-"][data-testid$="-e"]'
  );
  const handleBox = await eastHandle.boundingBox();
  if (!handleBox) {
    throw new Error('Proposed room east resize handle was not rendered');
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 60,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.up();

  await expect(
    page.getByRole('complementary').getByLabel('Width m')
  ).toHaveValue('2.50');
});
