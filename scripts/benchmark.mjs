import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { STAGES } from '../src/data/stages.ts';

const output = new URL('../test-results/benchmark/', import.meta.url);
await mkdir(output, { recursive: true });
const server = await preview({
  logLevel: 'error',
  preview: { host: '127.0.0.1', port: 0, strictPort: true },
});
let browser;
try {
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chromium' });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#app.is-ready').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.masthead')).opacity === '1');
  assert.equal(await page.evaluate(() => typeof window.__ORBITAL__), 'undefined');
  await page.screenshot({ path: fileURLToPath(new URL('workshop.png', output)) });

  const results = [];
  let graphics;
  for (const [index, stage] of STAGES.entries()) {
    await page.locator('.stage-tab').nth(index).click();
    await page.locator('#hint').click();
    await page.locator('#hint').click();
    await page.waitForTimeout(500);
    assert.match(await page.locator('#route-status').textContent(), /受け皿へ/);
    await page.screenshot({ path: fileURLToPath(new URL(`${stage.id}.png`, output)) });
    await page.locator('#play').click();
    await page.waitForTimeout(1000);
    const timing = await page.evaluate(() => new Promise((resolve) => {
      const intervals = [];
      let previous;
      function frame(now) {
        if (previous !== undefined) intervals.push(now - previous);
        previous = now;
        if (intervals.length < 600) {
          requestAnimationFrame(frame);
          return;
        }
        const sorted = [...intervals].sort((a, b) => a - b);
        const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
        resolve({
          frames: intervals.length,
          meanMs: Number(mean.toFixed(3)),
          fps: Number((1000 / mean).toFixed(2)),
          p95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)),
          maxMs: Number(sorted.at(-1).toFixed(3)),
          framesOver33ms: intervals.filter((value) => value > 33.4).length,
        });
      }
      requestAnimationFrame(frame);
    }));
    const state = await page.evaluate(() => {
      const canvas = document.querySelector('#instrument');
      const gl = canvas.getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        phase: document.querySelector('#app').dataset.phase,
        duration: Number(document.querySelector('#timeline').max),
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
        dpr: devicePixelRatio,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        environment: document.querySelector('#environment-info').textContent,
      };
    });
    assert.equal(state.phase, 'complete', `${stage.id} must complete its real playback`);
    assert.equal(state.width, 1440);
    assert.equal(state.height, 900);
    assert.equal(state.dpr, 1);
    const quality = state.environment.match(/Quality: (\w+)/)?.[1];
    assert.ok(quality);
    graphics = { width: state.width, height: state.height, dpr: state.dpr, renderer: state.renderer };
    results.push({ stage: stage.id, duration: state.duration, quality, ...timing });
    await page.locator('#play').click();
  }
  assert.deepEqual(errors, []);
  const report = {
    measuredAt: new Date().toISOString(),
    browser: `Chromium ${browser.version()} (new headless)`,
    cpu: os.cpus()[0]?.model,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.platform()} ${os.release()}`,
    graphics,
    method: '600 requestAnimationFrame intervals per stage after a 1-second warm-up; not GPU-only timings.',
    results,
  };
  await writeFile(new URL('report.json', output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (results.some((result) => result.fps < 59.5)) {
    console.warn('The 60 fps target was not reached on this device. See the measured frame intervals and rendering quality above.');
  }
} finally {
  try {
    await browser?.close();
  } finally {
    await new Promise((resolve, reject) => server.httpServer.close((error) => error ? reject(error) : resolve()));
  }
}
