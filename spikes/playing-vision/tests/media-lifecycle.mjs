// Fake-device regression: run with the loopback lab server on port 4381.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.auditTracks = [];
    window.grants = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await gum(constraints);
      window.auditTracks.push(...stream.getTracks());
      if (constraints.audio || window.delayVideo) await new Promise(resolve => window.grants.push(resolve));
      return stream;
    };
  });
  await page.goto('http://127.0.0.1:4381');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Camera active'));
  await page.evaluate(() => { document.querySelector('#audio').click(); document.querySelector('#audio').click(); });
  await page.waitForFunction(() => window.grants.length === 2);
  await page.evaluate(() => window.grants.forEach(resolve => resolve()));
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Microphone active'));
  await page.getByRole('button', { name: 'Stop devices', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Devices stopped'));
  const states = await page.evaluate(() => window.auditTracks.map(track => track.readyState));
  assert.ok(states.every(state => state === 'ended'), 'Overlapping microphone requests must not leak capture');
  console.log('PASS simultaneous microphone requests: all fake tracks stopped');
  await page.evaluate(() => { window.delayVideo = true; window.grants = []; });
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await page.waitForFunction(() => window.grants.length === 1);
  await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.grants[0](); });
  await page.waitForTimeout(500);
  assert.ok(await page.evaluate(() => window.auditTracks.every(track => track.readyState === 'ended')),
    'A camera permission resolved after pagehide must be released');
  console.log('PASS pagehide cancels pending fake-camera permission');
  await page.evaluate(() => {
    window.grants = [];
    document.querySelector('#camera').click(); document.querySelector('#camera').click();
  });
  await page.waitForFunction(() => window.grants.length >= 1);
  await page.waitForTimeout(250);
  await page.evaluate(() => window.grants.forEach(resolve => resolve()));
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Camera active'));
  await page.getByRole('button', { name: 'Stop devices', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Devices stopped'));
  assert.ok(await page.evaluate(() => window.auditTracks.every(track => track.readyState === 'ended')),
    'Overlapping camera requests must not leak capture');
  console.log('PASS simultaneous camera requests: all fake tracks stopped');
} finally { await browser.close(); }
