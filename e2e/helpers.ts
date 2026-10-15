import { type Page, expect } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };

/** The on-screen box of a Room, found by its label. */
export async function roomBox(page: Page, name: string): Promise<Box> {
  const hit = await page.evaluate((n) => {
    const label = [...document.querySelectorAll('svg text')].find((e) => e.textContent === n);
    if (!label) return null;
    const r = label.getBoundingClientRect();
    const el = document
      .elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      .find((e) => e.getAttribute('data-hit')?.startsWith('room:'));
    return el?.getAttribute('data-hit') ?? null;
  }, name);
  expect(hit, `room ${name} on the canvas`).toBeTruthy();
  const b = await page.locator(`[data-hit="${hit}"]`).boundingBox();
  return b!;
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  mods: string[] = []
) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + (dx * i) / 12, from.y + (dy * i) / 12);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

export const centre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Starts a new project with an Outline. */
export async function newHouse(page: Page, w = '10', l = '8') {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('House width').fill(w);
  await page.getByLabel('House length').fill(l);
  await page.getByRole('button', { name: 'Start' }).click();
}

export async function addRoom(page: Page, name: string, w: string, l: string) {
  await page.getByLabel('Room name').fill(name);
  await page.getByLabel('Width', { exact: true }).fill(w);
  await page.getByLabel('Length', { exact: true }).fill(l);
  await page.getByLabel('Length', { exact: true }).press('Enter');
}

/** Drags a Room so its inside top-left corner lands near a screen point; snapping does the rest. */
export async function place(page: Page, name: string, x: number, y: number) {
  const b = await roomBox(page, name);
  await drag(page, centre(b), x - b.x, y - b.y);
}
