import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STAGES } from '../src/data/stages.ts';

async function openWorkshop(page: Page) {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveClass(/is-ready/);
  await page.waitForFunction(() => Boolean(window.__ORBITAL__));
  await expect(page.locator('.masthead')).toHaveCSS('opacity', '1');
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.__ORBITAL__!.snapshot());
}

async function placeSolutionByDragging(page: Page) {
  const points = await page.evaluate(() => ({
    starts: window.__ORBITAL__!.lensScreens(), ends: window.__ORBITAL__!.solutionScreens(),
  }));
  for (let i = 0; i < points.starts.length; i++) {
    const from = points.starts[i]!;
    const to = points.ends[i]!;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
  }
}

test('first stage: actual dragging, sound, fixed placement, completion and silent scrubbing', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const started = Date.now();
  await openWorkshop(page);
  const initial = await snapshot(page);
  expect(initial.audio.activated).toBe(false);
  expect(initial.audio.notesPlayed).toBe(0);
  expect(initial.predictedRings).toBe(2);
  await placeSolutionByDragging(page);
  const placed = await snapshot(page);
  expect(placed.placements[0]!.y).toBeCloseTo(0.8, 2);
  expect(placed.predictedOutcome).toBe('caught');
  expect(await page.evaluate(() => window.__ORBITAL__!.diagnostics().predictionVertices)).toBeGreaterThan(200);
  await page.screenshot({ path: testInfo.outputPath('first-stage-ready.png') });
  await page.getByRole('button', { name: '星を放つ' }).click();
  await expect.poll(async () => (await snapshot(page)).audio.notesPlayed).toBeGreaterThan(1);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeGreaterThan(0.001);
  expect(Date.now() - started).toBeLessThan(30_000);
  const before = await snapshot(page);
  await placeSolutionByDragging(page);
  expect((await snapshot(page)).placements).toEqual(before.placements);
  await expect.poll(async () => (await snapshot(page)).lastOutcome).toBe('caught');
  const completed = await snapshot(page);
  expect(completed.recordedDuration).toBe(completed.predictedDuration);
  expect(completed.audio.state).toBe('running');
  expect(completed.audio.notesPlayed).toBeGreaterThanOrEqual(5);
  await page.screenshot({ path: testInfo.outputPath('first-stage-complete.png') });
  const slider = await page.locator('#timeline').boundingBox();
  expect(slider).not.toBeNull();
  await page.mouse.click(slider!.x + slider!.width * 0.5, slider!.y + slider!.height / 2);
  const scrubbed = await snapshot(page);
  expect(scrubbed.phase).toBe('scrubbing');
  expect(scrubbed.audio.notesPlayed).toBe(completed.audio.notesPlayed);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(0.00001);
  await page.mouse.click(slider!.x + slider!.width * 0.1, slider!.y + slider!.height / 2);
  expect((await snapshot(page)).audio.notesPlayed).toBe(completed.audio.notesPlayed);
  await page.getByRole('button', { name: '最初から再生' }).click();
  expect((await snapshot(page)).time).toBeLessThan(1);
  await page.getByRole('button', { name: '初期配置' }).click();
  const reset = await snapshot(page);
  expect(reset.phase).toBe('editing');
  expect(reset.recordedDuration).toBeNull();
  expect(reset.time).toBe(0);
  expect(errors).toEqual([]);
  const diagnostics = await page.evaluate(() => window.__ORBITAL__!.diagnostics());
  expect(diagnostics).toMatchObject({ renderWidth: 1440, renderHeight: 900, dpr: 1, webgl: 2 });
  console.log('1440x900 DPR1 rendering:', JSON.stringify(diagnostics));
});

test('keyboard selection, fine movement, pause, edit, reset and mute', async ({ page }) => {
  await openWorkshop(page);
  await page.keyboard.press('1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  expect((await snapshot(page)).placements[0]!.y).toBeCloseTo(-0.005, 6);
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.keyboard.press('Space');
  expect((await snapshot(page)).phase).toBe('paused');
  const paused = await snapshot(page);
  await page.keyboard.press('ArrowUp');
  expect((await snapshot(page)).placements).toEqual(paused.placements);
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  expect((await snapshot(page)).recordedDuration).toBeNull();
  await page.keyboard.press('m');
  expect((await snapshot(page)).audio.muted).toBe(true);
  await page.keyboard.press('r');
  expect((await snapshot(page)).placements[0]!.y).toBe(-0.15);
  expect((await snapshot(page)).time).toBe(0);
});

test('reduced motion starts with automatic looping disabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWorkshop(page);
  expect((await snapshot(page)).reducedMotion).toBe(true);
  await expect(page.locator('#loop')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'ヒント', exact: true }).click();
  await page.getByRole('button', { name: 'お手本を置く', exact: true }).click();
  await page.getByRole('button', { name: '星を放つ' }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('complete');
  const completed = await snapshot(page);
  await page.waitForTimeout(1600);
  expect((await snapshot(page)).time).toBe(completed.time);
  expect((await snapshot(page)).audio.notesPlayed).toBe(completed.audio.notesPlayed);
});

test('unsupported WebGL is explained in the interface', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).includes('webgl')) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto('/');
  await expect(page.locator('#fatal')).toBeVisible();
  await expect(page.locator('#fatal')).toContainText('装置を起動できませんでした');
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible();
});

test('unavailable audio remains explained while the game continues muted', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  });
  await openWorkshop(page);
  await page.locator('#play').click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  expect((await snapshot(page)).audio.muted).toBe(true);
  await expect(page.locator('#notice')).toContainText('Web Audioを利用できません');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
});

for (const [index, stage] of STAGES.entries()) {
  if (index === 0) continue;
  test(`${stage.id}: every lens can be dragged and the complete authored orbit is playable`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openWorkshop(page);
    await page.getByRole('button', { name: `ステージ${index + 1}：${stage.title}` }).click();
    expect((await snapshot(page)).stage).toBe(stage.id);
    await placeSolutionByDragging(page);
    const placed = await snapshot(page);
    expect(placed.predictedOutcome).toBe('caught');
    expect(placed.predictedRings).toBe(3);
    placed.placements.forEach((position, i) => {
      expect(position.x).toBeCloseTo(stage.lenses[i]!.solution.x, 2);
      expect(position.y).toBeCloseTo(stage.lenses[i]!.solution.y, 2);
    });
    await page.screenshot({ path: testInfo.outputPath(`${stage.id}-ready.png`) });
    await page.getByRole('button', { name: '星を放つ' }).click();
    await expect.poll(async () => (await snapshot(page)).lastOutcome).toBe('caught');
    expect((await snapshot(page)).recordedDuration).toBe(placed.predictedDuration);
    expect((await snapshot(page)).audio.notesPlayed).toBeGreaterThanOrEqual(5);
    await page.screenshot({ path: testInfo.outputPath(`${stage.id}-complete.png`) });
    console.log(`${stage.id} rendering:`, JSON.stringify(await page.evaluate(() => window.__ORBITAL__!.diagnostics())));
    await page.locator('#next-stage').click();
    expect((await snapshot(page)).stage).toBe(STAGES[(index + 1) % STAGES.length]!.id);
    expect((await snapshot(page)).recordedDuration).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('tab visibility pauses time and audio, and never resumes without a new action', async ({ page }) => {
  await openWorkshop(page);
  await page.getByRole('button', { name: '星を放つ' }).click();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(0.2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await snapshot(page);
  expect(hidden.phase).toBe('paused');
  await expect.poll(async () => (await snapshot(page)).audio.state).toBe('suspended');
  await page.waitForTimeout(400);
  expect((await snapshot(page)).time).toBe(hidden.time);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(400);
  expect((await snapshot(page)).time).toBe(hidden.time);
  await page.getByRole('button', { name: '続きから' }).click();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(hidden.time);
  expect((await snapshot(page)).audio.state).toBe('running');
});

test('stage changes release old geometry, materials and generated textures', async ({ page }) => {
  await openWorkshop(page);
  const initial = await page.evaluate(() => window.__ORBITAL__!.diagnostics());
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: `ステージ3：${STAGES[2]!.title}` }).click();
    await page.getByRole('button', { name: `ステージ2：${STAGES[1]!.title}` }).click();
    await page.getByRole('button', { name: `ステージ1：${STAGES[0]!.title}` }).click();
  }
  await expect.poll(async () => (await page.evaluate(() => window.__ORBITAL__!.diagnostics())).meshes).toBe(initial.meshes);
  const after = await page.evaluate(() => window.__ORBITAL__!.diagnostics());
  expect(after.materials).toBe(initial.materials);
  expect(after.textures).toBe(initial.textures);
  expect((await snapshot(page)).audio.activated).toBe(false);
});

test('Space and mute work from focused lens controls and the timeline', async ({ page }) => {
  await openWorkshop(page);
  await page.locator('.lens-handle').first().focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.locator('#play').click();
  await page.locator('#timeline').focus();
  await page.keyboard.press('m');
  expect((await snapshot(page)).audio.muted).toBe(true);
  const before = (await snapshot(page)).placements;
  await page.keyboard.press('ArrowRight');
  expect((await snapshot(page)).phase).toBe('scrubbing');
  expect((await snapshot(page)).placements).toEqual(before);
  await page.keyboard.press('Space');
  expect((await snapshot(page)).phase).toBe('playing');
  expect((await snapshot(page)).time).toBeLessThan(0.5);
});

test('a long interruption pauses playback instead of bursting through old notes', async ({ page }) => {
  await openWorkshop(page);
  await page.locator('#play').click();
  await expect.poll(async () => (await snapshot(page)).time).toBeGreaterThan(0.1);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const start = performance.now();
    while (performance.now() - start < 900) { /* Simulate a stalled visible tab. */ }
  });
  await expect.poll(async () => (await snapshot(page)).phase).toBe('paused');
  expect((await snapshot(page)).audio.notesPlayed).toBe(before.audio.notesPlayed);
  await expect.poll(async () => (await snapshot(page)).audio.peak).toBeLessThan(0.00001);
  await expect(page.locator('#notice')).toContainText('描画がしばらく止まった');
  await page.getByRole('button', { name: '続きから' }).click();
  expect((await snapshot(page)).phase).toBe('playing');
});

test('WebGL context loss pauses safely and restored rendering can resume', async ({ page }) => {
  await openWorkshop(page);
  await page.locator('#play').click();
  const extension = await page.evaluateHandle(() =>
    document.querySelector<HTMLCanvasElement>('#instrument')!.getContext('webgl2')!.getExtension('WEBGL_lose_context'));
  expect(await extension.evaluate((value) => value !== null)).toBe(true);
  await extension.evaluate((value) => value!.loseContext());
  await expect(page.locator('#notice')).toContainText('描画が中断');
  expect((await snapshot(page)).phase).toBe('paused');
  await page.waitForTimeout(250);
  await extension.evaluate((value) => value!.restoreContext());
  await expect(page.locator('#notice')).toContainText('描画が復旧');
  await expect.poll(async () => page.evaluate(() => window.__ORBITAL__!.diagnostics().ready)).toBe(true);
  await page.getByRole('button', { name: '続きから' }).click();
  expect((await snapshot(page)).phase).toBe('playing');
  await extension.dispose();
});

test('resizing preserves the fixed camera, picking and the usable narrow layout', async ({ page }, testInfo) => {
  await openWorkshop(page);
  const before = await page.evaluate(() => window.__ORBITAL__!.lensScreens()[0]!);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(async () => page.evaluate(() => window.__ORBITAL__!.diagnostics().renderWidth)).toBe(1024);
  await page.screenshot({ path: testInfo.outputPath('desktop-1024.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => page.evaluate(() => window.__ORBITAL__!.diagnostics().renderWidth)).toBe(1440);
  const after = await page.evaluate(() => window.__ORBITAL__!.lensScreens()[0]!);
  expect(after.x).toBeCloseTo(before.x, 2);
  expect(after.y).toBeCloseTo(before.y, 2);
  await placeSolutionByDragging(page);
  expect((await snapshot(page)).predictedOutcome).toBe('caught');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#play').click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.screenshot({ path: testInfo.outputPath('narrow-390.png') });
  for (const id of ['#play', '#edit', '#reset', '#hint', '#mute']) {
    const box = await page.locator(id).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
});
