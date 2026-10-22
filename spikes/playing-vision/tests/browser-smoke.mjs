// Run after npm start. All media is a public fixture or synthetic test signal.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});
 const outside=[];page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:4381')&&!r.url().startsWith('blob:'))outside.push(r.url());});
 await page.addInitScript(()=>{window.testTracks=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{const s=await gum(c);window.testTracks.push(...s.getTracks());return s;};});
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4381');
 await page.getByRole('button',{name:'Load RTMPose'}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent==='Models ready',{timeout:120000});
 await page.locator('#file').setInputFiles(new URL('../private/hand-fixture.jpg',import.meta.url).pathname);
 await page.getByRole('button',{name:'Analyze frame',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('inferenceMs'),null,{timeout:120000});
 console.log('status',await page.locator('#status').textContent(),'errors',errors);
 assert.ok(Number(await page.locator('#output').getAttribute('data-hands'))>0,'Expected positive hand fixture');
 // Exercise manual calibration UI on this non-instrument fixture: geometry plumbing only.
 await page.getByRole('button',{name:'Start calibration',exact:true}).click();
 const rect=await page.locator('#view').boundingBox();
 for(const [x,y] of [[.1,.1],[.1,.8],[.9,.1],[.9,.8]])await page.mouse.click(rect.x+x*rect.width,rect.y+y*rect.height);
 assert.ok((await page.locator('#calibration').textContent()).startsWith('Calibrated wires'));
 await page.getByRole('button',{name:'Analyze frame',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('hand(s)'));
 await page.screenshot({path:new URL('../private/hand-overlay-1080p.png',import.meta.url).pathname});
 // Preserve actual image pixels + raw model observations for later supervised training.
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download labeled frame'}).click();
 const download=await downloadPromise;const fs=await import('node:fs/promises');
 const record=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 assert.ok(record.frame.png.startsWith('data:image/png;base64,'));
 assert.equal(record.observation.hands[0].points.length,21);
 assert.equal(record.label.author,'human');
 // A real video decoder + existing AudioWorklet must hear the generated 55-Hz tone.
 await page.locator('#file').setInputFiles(new URL('../private/hand-tone.mp4',import.meta.url).pathname);
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Local file ready'));
 await page.getByRole('button',{name:'Connect audio'}).click();
 await page.waitForFunction(()=>document.querySelector('#heard').textContent.includes('MIDI 33'),null,{timeout:15000});
 console.log('audio',await page.locator('#heard').textContent());
 await page.getByRole('button',{name:'Analyze frame',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('inferenceMs'));
 await page.getByRole('button',{name:'Stop devices'}).click();
 assert.equal(await page.locator('#matched').textContent(),'Unconfirmed');
 // A synthetic black frame should not fall back to invented full-frame hand landmarks.
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const x=c.getContext('2d');x.fillStyle='black';x.fillRect(0,0,640,480);return c.toDataURL().split(',')[1];});
 await page.locator('#file').setInputFiles({name:'blank.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Local file ready'));
 await page.getByRole('button',{name:'Analyze frame',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('inferenceMs'));
 console.log('blank',await page.locator('#output').textContent());
 assert.equal(await page.locator('#output').getAttribute('data-hands'),'0');
 for(const p of ['/private/hand-fixture.jpg','/.env','/../../package.json','/models/receipt.json'])assert.equal((await page.request.get('http://127.0.0.1:4381'+p)).status(),404);
 assert.equal((await page.request.get('http://127.0.0.1:4381/',{headers:{Origin:'https://example.com'}})).status(),403);
 await page.getByRole('button',{name:'Start camera',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Camera active'));
 await page.getByRole('button',{name:'Connect audio',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Microphone active'));
 await page.getByRole('button',{name:'Stop devices',exact:true}).click();
 await page.waitForFunction(()=>window.testTracks.length===2&&window.testTracks.every(t=>t.readyState==='ended'));
 assert.deepEqual(outside,[],'Unexpected external network request');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(await page.locator('#output').textContent());
 await page.screenshot({path:new URL('../private/browser-1080p.png',import.meta.url).pathname});
} finally {await browser.close();}
