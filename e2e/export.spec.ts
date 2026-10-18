import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { addRoom, newHouse, place } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** A 10 × 8 m house called Home, with Living placed in it. */
async function home(page: Page) {
  await newHouse(page);
  await page.getByLabel('Project name').fill('Home');
  await page.getByLabel('Project name').press('Enter');
  await addRoom(page, 'Living', '4', '3.8');
  await page.keyboard.press('Escape');
  const inside = (await page.locator('[data-hit="space"]').boundingBox())!;
  await place(page, 'Living', inside.x + 2, inside.y + 2);
  await page.keyboard.press('Escape');
  await expect(page.getByText('1 of 1 placed')).toBeVisible();
}

/** Exports through the Toolbar and returns the downloaded file. */
async function exportAs(page: Page, item: 'PNG image' | 'PDF document') {
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: item }).click()
  ]);
  return { name: download.suggestedFilename(), bytes: await readFile((await download.path())!) };
}

/** A PNG's pixel width, from its IHDR chunk. */
const pngWidth = (b: Buffer) => b.readUInt32BE(16);

test('exports the Existing Plan as PNG and PDF', async ({ page }) => {
  await home(page);

  const png = await exportAs(page, 'PNG image');
  expect(png.name).toBe('Home - Existing plan.png');
  expect(png.bytes.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  // A4 landscape at 2×.
  expect(pngWidth(png.bytes)).toBe(2246);

  const pdf = await exportAs(page, 'PDF document');
  expect(pdf.name).toBe('Home - Existing plan.pdf');
  expect(pdf.bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  // Vector: the Room's name is text in the PDF, not pixels.
  expect(pdf.bytes.toString('latin1')).toContain('(Living)');
});

test('exports the open Scenario, with Show Changes as toggled', async ({ page }) => {
  await home(page);
  await page.getByRole('button', { name: 'New scenario' }).click();
  await expect(page.getByRole('navigation', { name: 'Scenarios' }).getByText('Option A')).toBeVisible();

  const png = await exportAs(page, 'PNG image');
  expect(png.name).toBe('Home - Option A.png');
  expect(png.bytes.subarray(0, 4).toString('latin1')).toBe('\x89PNG');

  const pdf = await exportAs(page, 'PDF document');
  expect(pdf.name).toBe('Home - Option A.pdf');
  expect(pdf.bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect(pdf.bytes.toString('latin1')).toContain('(Demolished)');

  // With Show Changes off, no legend.
  await page.getByRole('button', { name: 'Show changes' }).click();
  const plain = await exportAs(page, 'PDF document');
  expect(plain.name).toBe('Home - Option A.pdf');
  expect(plain.bytes.toString('latin1')).not.toContain('(Demolished)');
});
