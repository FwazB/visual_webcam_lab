// DOM-only ownership checks. No browser, microphone, camera, or audio device opens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}

function harness(options={}){
 const elements=new Map(),tracks=[],contexts=[],nodes=[],grants=[],pendingModules=[],pendingResumes=[],pendingPlays=[],pendingCloses=[],errors=[];
 const phase={fail:null,...options};
 const fail=name=>{if(phase.fail===name)throw Error(`Synthetic ${name} failure`);};
 const context2d={drawImage(){fail('draw');},beginPath(){},arc(){},fill(){},fillText(){},stroke(){},moveTo(){},lineTo(){},strokeRect(){}};
 function element(type){
  const value={textContent:'',disabled:false,style:{},dataset:{},getContext:()=>context2d,
   replaceChildren(){},append(){},pause(){},load(){},removeAttribute(){},videoWidth:1920,videoHeight:1080,
   play:async()=>{fail('play');if(phase.deferPlay){const pending=deferred();pendingPlays.push(pending);await pending.promise;}}};
  if(type==='video')Object.defineProperty(value,'onloadeddata',{set(callback){queueMicrotask(callback);}});
  return value;
 }
 const document={getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
 const navigator={mediaDevices:{getUserMedia:async constraints=>{
  const track={kind:constraints.audio?'audio':'video',stopped:false,stop(){this.stopped=true;}};
  tracks.push(track);
  if(constraints.audio&&phase.deferGrant){const grant=deferred();grants.push(grant);await grant.promise;}
  return{getTracks:()=>[track]};
 }}};
 function node(kind){
  const value={kind,disconnected:false,connect(){fail('connect');},disconnect(){this.disconnected=true;},
   gain:{value:1},port:{onmessage:null,postMessage(){fail('config');}}};nodes.push(value);return value;
 }
 class AudioContext{
  constructor(){
   fail('constructor');this.state='suspended';this.currentTime=0;this.destination={};this.closeCalls=0;contexts.push(this);
   this.audioWorklet={addModule:async()=>{fail('addModule');if(phase.deferModule){const pending=deferred();pendingModules.push(pending);await pending.promise;}}};
  }
  createMediaStreamSource(){fail('source');return node('source');}
  createMediaElementSource(){fail('source');return node('source');}
  createGain(){fail('gain');return node('gain');}
  async resume(){fail('resume');if(phase.deferResume){const pending=deferred();pendingResumes.push(pending);await pending.promise;}if(this.state!=='closed')this.state='running';}
  async close(){this.closeCalls++;if(phase.closeReject)throw Error('Synthetic close failure');if(phase.deferClose){const pending=deferred();pendingCloses.push(pending);await pending.promise;}this.state='closed';}
 }
 class AudioWorkletNode{constructor(){fail('worklet');return node('worklet');}}
 const listeners=new Map();
 vm.runInNewContext(source,{document,navigator,AudioContext,AudioWorkletNode,performance,
  window:{addEventListener:(name,handler)=>listeners.set(name,handler)},
  URL:{createObjectURL:()=> 'blob:synthetic-video',revokeObjectURL(){}},
  console:{error:error=>errors.push(error)},setTimeout});
 return{phase,elements,tracks,contexts,nodes,grants,pendingModules,pendingResumes,pendingPlays,pendingCloses,errors,
  camera:()=>elements.get('camera').onclick(),audio:()=>elements.get('audio').onclick(),stop:()=>elements.get('stop').onclick(),
  file:()=>elements.get('file').onchange({target:{files:[{type:'video/mp4'}]}}),
  pagehide:()=>listeners.get('pagehide')(),
 };
}

test('camera playback and drawing failures release capture and allow retry',async t=>{
 for(const failure of ['play','draw'])await t.test(failure,async()=>{
  const run=harness({fail:failure});await run.camera();
  assert.equal(run.tracks.length,1);assert.ok(run.tracks.every(track=>track.stopped));
  assert.equal(run.elements.get('status').textContent,`Synthetic ${failure} failure`);
  await run.audio();assert.equal(run.tracks.length,1);
  run.phase.fail=null;await run.camera();assert.match(run.elements.get('status').textContent,/^Camera active/);
  await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
 });
});

test('camera playback finishing after Stop cannot revive the source or its status',async()=>{
 const run=harness({deferPlay:true});const pending=run.camera();await flush();
 assert.equal(run.pendingPlays.length,1);await run.stop();run.pendingPlays[0].resolve();await pending;
 assert.ok(run.tracks.every(track=>track.stopped));assert.match(run.elements.get('status').textContent,/^Devices stopped/);
 await run.audio();assert.equal(run.tracks.length,1);
});

test('obsolete camera setup only releases its own stream when a newer source is active',async()=>{
 const run=harness({deferPlay:true});const old=run.camera();await flush();
 run.phase.deferPlay=false;await run.camera();run.pendingPlays[0].resolve();await old;
 assert.equal(run.tracks.filter(track=>track.kind==='video'&&!track.stopped).length,1);
 assert.match(run.elements.get('status').textContent,/^Camera active/);
 await run.audio();assert.match(run.elements.get('status').textContent,/^Microphone active/);
 await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
});

test('slow audio teardown from an obsolete source cannot clear a newly started camera',async()=>{
 const run=harness();await run.camera();await run.audio();run.phase.deferClose=true;
 const old=run.camera();await flush();assert.equal(run.pendingCloses.length,1);
 run.phase.deferClose=false;await run.camera();run.pendingCloses[0].resolve();await old;
 assert.equal(run.tracks.filter(track=>track.kind==='video'&&!track.stopped).length,1);
 assert.match(run.elements.get('status').textContent,/^Camera active/);
 await run.audio();assert.match(run.elements.get('status').textContent,/^Microphone active/);
 await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
});

test('every microphone setup failure releases the acquired stream and partial graph',async t=>{
 for(const failure of ['constructor','addModule','source','worklet','config','gain','connect','resume']){
  await t.test(failure,async()=>{
   const run=harness();await run.camera();run.phase.fail=failure;await run.audio();
   assert.equal(run.tracks.filter(track=>track.kind==='audio').length,1);
   assert.ok(run.tracks.filter(track=>track.kind==='audio').every(track=>track.stopped));
   assert.ok(run.contexts.every(context=>context.state==='closed'));
   assert.ok(run.nodes.every(node=>node.disconnected));
   assert.equal(run.elements.get('status').textContent,`Synthetic ${failure} failure`);
   // A failed attempt must not leave a global context that prevents retry.
   run.phase.fail=null;await run.audio();
   assert.match(run.elements.get('status').textContent,/^Microphone active/);
   await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
  });
 }
});

test('file-audio source and playback errors release their partial contexts',async t=>{
 for(const failure of ['source','play'])await t.test(failure,async()=>{
  const run=harness();await run.file();run.phase.fail=failure;await run.audio();
  assert.equal(run.tracks.length,0);
  assert.equal(run.contexts.length,1);
  assert.equal(run.contexts[0].state,'closed');
  assert.ok(run.nodes.every(node=>node.disconnected));
  assert.equal(run.elements.get('status').textContent,`Synthetic ${failure} failure`);
 });
});

test('cleanup failure cannot keep a microphone track live or hide the setup error',async()=>{
 const run=harness();await run.camera();run.phase.fail='source';run.phase.closeReject=true;await run.audio();
 assert.ok(run.tracks.filter(track=>track.kind==='audio').every(track=>track.stopped));
 assert.equal(run.contexts[0].closeCalls,1);
 assert.equal(run.elements.get('status').textContent,'Synthetic source failure');
 await run.stop();
});

test('microphone grants resolved after Stop or pagehide are released without constructing audio',async t=>{
 for(const action of ['stop','pagehide'])await t.test(action,async()=>{
  const run=harness({deferGrant:true});await run.camera();const pending=run.audio();await flush();
  assert.equal(run.grants.length,1);await run[action]();run.grants[0].resolve();await pending;
  assert.ok(run.tracks.every(track=>track.stopped));
  assert.equal(run.contexts.length,0);
 });
});

test('overlapping microphone grants leave only the accepted stream live',async()=>{
 const run=harness({deferGrant:true});await run.camera();const first=run.audio(),second=run.audio();await flush();
 assert.equal(run.grants.length,2);run.grants.forEach(grant=>grant.resolve());await Promise.all([first,second]);
 assert.equal(run.contexts.length,1);
 assert.equal(run.tracks.filter(track=>track.kind==='audio'&&!track.stopped).length,1);
 await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
});

test('a resume completed after Stop cannot reactivate capture or overwrite the stopped status',async()=>{
 const run=harness({deferResume:true});await run.camera();const pending=run.audio();await flush();
 assert.equal(run.pendingResumes.length,1);await run.stop();run.pendingResumes[0].resolve();await pending;
 assert.ok(run.tracks.every(track=>track.stopped));assert.equal(run.contexts[0].state,'closed');
 assert.match(run.elements.get('status').textContent,/^Devices stopped/);
});

test('an old worklet setup cannot tear down a newer microphone session',async()=>{
 const run=harness({deferModule:true});await run.camera();const old=run.audio();await flush();
 assert.equal(run.pendingModules.length,1);await run.stop();await run.camera();run.phase.deferModule=false;await run.audio();
 run.pendingModules[0].resolve();await old;
 assert.equal(run.contexts.length,2);assert.equal(run.contexts[0].state,'closed');assert.equal(run.contexts[1].state,'running');
 assert.equal(run.tracks.filter(track=>track.kind==='audio'&&!track.stopped).length,1);
 assert.match(run.elements.get('status').textContent,/^Microphone active/);
 await run.stop();assert.ok(run.tracks.every(track=>track.stopped));
});
