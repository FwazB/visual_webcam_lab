import test from 'node:test';
import assert from 'node:assert/strict';
import { compareEvidence, calibrate, locateTips, decodeSimCC, normalizePixels, hasVisualDetail } from '../core.mjs';
test('uniform images are rejected before a detector can hallucinate a hand',()=>{
 assert.equal(hasVisualDetail(new Uint8ClampedArray(64)),false);
 const textured=new Uint8ClampedArray(64);textured.fill(255,32);
 assert.equal(hasVisualDetail(textured),true);
});
test('SimCC decodes both axes and rescales to the original crop', () => {
 const x = new Float32Array(21*512),y = new Float32Array(21*512);
 x[8*512+256]=0.9;y[8*512+128]=0.8;
 const p=decodeSimCC(x,y,{x:10,y:20,size:200})[8];
 assert.equal(p.x,110);assert.equal(p.y,70);assert.ok(Math.abs(p.score-0.8)<1e-6);
});
test('pose receives RGB while detector receives BGR', () => {
 const rgba=new Uint8ClampedArray([255,0,0,255]);
 assert.ok(normalizePixels(rgba, true)[0]>2);
 assert.ok(normalizePixels(rgba, false)[0]<-1);
});
test('calibrated perspective maps index finger to E string fret 3', () => {
 const grid = calibrate([[10,10],[10,110],[610,10],[610,110]],0,12);
 const x = 10 + 600 * (1 - 2 ** (-2.5/12)) / (1 - 2 ** (-12/12));
 assert.deepEqual(locateTips([{id:8,x,y:10,score:0.9}],grid).map(p=>[p.string,p.fret,p.midi]),[[0,3,31]]);
});
test('weak or stale audio cannot confirm vision, and disagreement preserves candidates',()=>{
 const seen=[{string:0,fret:3,midi:31}];
 assert.equal(compareEvidence(seen,{midi:31,clarity:0.95},151).status,'unconfirmed');
 assert.equal(compareEvidence(seen,{midi:31,clarity:0.2},0).status,'unconfirmed');
 assert.equal(compareEvidence(seen,{midi:32,clarity:0.95},0).status,'disagrees');
 assert.equal(compareEvidence(seen,{midi:31,clarity:0.95},0).status,'pitch-agrees-contact-unverified');
 assert.deepEqual(compareEvidence([], {midi:31,clarity:1},0).seen,[]);
});
test('geometry rejects invalid calibration and uncertain/outside points',()=>{
 assert.throws(()=>calibrate([[0,0],[0,0],[0,0],[0,0]],0,12));
 assert.throws(()=>calibrate([[0,0],[0,100],[600,0],[600,100]],12,0));
 const g=calibrate([[0,0],[0,100],[600,0],[600,100]],0,12);
 assert.deepEqual(locateTips([{id:8,x:50,y:0,score:0.1},{id:8,x:-50,y:0,score:1},{id:8,x:100,y:NaN,score:1}],g),[]);
 assert.deepEqual(locateTips([],g),[]);
});
test('same pitch on different strings stays visually ambiguous', () => {
 const seen = [{string:0,fret:5,midi:33},{string:1,fret:0,midi:33}];
 const result = compareEvidence(seen, {midi:33,clarity:0.95}, 50);
 assert.equal(result.status, 'ambiguous');
 assert.deepEqual(result.seen, seen);
});
