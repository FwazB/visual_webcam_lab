// Run after prepare_fixtures.py and npm start; no physical input devices.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.testContexts = [];
    const NativeContext = window.AudioContext;
    // Observe native audio clocks without replacing rendering or pitch data.
    window.AudioContext = class extends NativeContext {
      constructor(options) { super(options); window.testContexts.push(this); }
    };
  });
  await page.goto('http://127.0.0.1:4381');
  await page.locator('#file').setInputFiles(new URL('../private/hand-tone.mp4', import.meta.url).pathname);
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Local file ready'));
  await page.locator('#audio').click();
  try {
    await page.waitForFunction(() => document.querySelector('#heard').textContent.includes('MIDI 33'), null, { timeout: 15000 });
  } finally {
    console.log('native audio diagnostics', await page.evaluate(() => ({
      heard: document.querySelector('#heard').textContent,
      videoTime: document.querySelector('video').currentTime,
      contexts: window.testContexts.map(c => ({ state: c.state, time: c.currentTime, sink: c.sinkId })),
    })));
  }
  const state = await page.evaluate(() => ({
    videoTime: document.querySelector('video').currentTime,
    audioTime: window.testContexts[0].currentTime,
  }));
  assert.ok(state.videoTime > 0 && state.audioTime > 0.1, 'Native video and audio clocks must advance');
  await page.locator('#stop').click();
  await page.waitForFunction(() => window.testContexts.every(c => c.state === 'closed'));
  assert.deepEqual(errors, []);
  console.log('PASS decoded 55-Hz video → native AudioWorklet → MIDI 33; contexts closed');
} finally { await browser.close(); }
