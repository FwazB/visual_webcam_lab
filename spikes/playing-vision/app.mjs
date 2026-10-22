import {loadModels} from './runtime.mjs';
import {calibrate,locateTips,compareEvidence} from './core.mjs';
const $=id=>document.getElementById(id),view=$('view'),ctx=view.getContext('2d');
const raw=document.createElement('canvas'),rawCtx=raw.getContext('2d');
let models,source,video,stream,audioStream,audioContext,audioNode,objectURL;
let grid=null,corners=[],calibrating=false,busy=false,running=false,runId=0,generation=0,heard=null,last=null;
const names=['E','A','D','G'];
const status=text=>$('status').textContent=text;
function guard(fn){return async(...args)=>{try{await fn(...args);}catch(e){running=false;status(e.message);console.error(e);}};}
function clearEvidence(){last=null;heard=null;$('seen').textContent='No frame analyzed';$('heard').textContent='Audio disconnected';$('matched').textContent='Unconfirmed';$('output').textContent='No observations yet.';$('output').dataset.hands='0';}
async function stopAudio(){
 audioStream?.getTracks().forEach(t=>t.stop());audioStream=null;
 audioNode?.disconnect();audioNode=null;
 if(audioContext&&audioContext.state!=='closed')await audioContext.close();audioContext=null;heard=null;
}
async function stopSource(){
 generation++;runId++;running=false;stream?.getTracks().forEach(t=>t.stop());stream=null;
 video?.pause();await stopAudio();if(video){video.srcObject=null;video.removeAttribute('src');video.load();}
 source=null;video=null;$('video-controls').replaceChildren();
 if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;
 grid=null;corners=[];calibrating=false;clearEvidence();$('calibration').textContent='No calibration — hand observations only.';
}
function frame(){
 if(!source)throw Error('Open a local image/video or start the camera first.');
 const w=source.videoWidth||source.naturalWidth,h=source.videoHeight||source.naturalHeight;
 if(!w||!h)throw Error('Waiting for a decoded video frame.');
 const scale=Math.min(1,1920/w,1080/h);raw.width=Math.round(w*scale);raw.height=Math.round(h*scale);
 rawCtx.drawImage(source,0,0,raw.width,raw.height);view.width=raw.width;view.height=raw.height;
}
function draw(result=last){
 ctx.drawImage(raw,0,0);ctx.lineWidth=Math.max(2,view.width/500);
 const p=grid?.points||corners;
 ctx.strokeStyle='#73dabd';ctx.fillStyle='#73dabd';ctx.font=`${Math.max(16,view.width/70)}px sans-serif`;
 p.forEach(([x,y],i)=>{ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillText(String(i+1),x+9,y-8);});
 if(grid){ctx.beginPath();[0,2,3,1,0].forEach((i,n)=>n?ctx.lineTo(...p[i]):ctx.moveTo(...p[i]));ctx.stroke();}
 for(const hand of result?.hands||[]){
  ctx.strokeStyle='#7095be';ctx.strokeRect(hand.box.x1,hand.box.y1,hand.box.x2-hand.box.x1,hand.box.y2-hand.box.y1);
  for(const point of hand.points)if(point.score>=0.5){ctx.fillStyle=[8,12,16,20].includes(point.id)?'#ffc16e':'#9ac2fb';ctx.beginPath();ctx.arc(point.x,point.y,5,0,Math.PI*2);ctx.fill();}
 }
}
$('load').onclick=guard(async()=>{
 if(models)return; $('load').disabled=true;status('Loading local ONNX models…');
 try{models=await loadModels();status('Models ready');}finally{$('load').disabled=!!models;}
});
$('file').onchange=guard(async e=>{
 const f=e.target.files[0];if(!f)return;await stopSource();objectURL=URL.createObjectURL(f);
 if(f.type.startsWith('image/')){source=new Image();source.src=objectURL;await source.decode();frame();draw();}
 else {video=document.createElement('video');video.controls=true;video.playsInline=true;video.muted=true;video.src=objectURL;source=video;$('video-controls').append(video);await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(Error('Cannot decode this video'));});frame();draw();video.onseeked=()=>{if(!busy){clearEvidence();frame();draw();}};}
 status('Local file ready. No data uploaded. Recalibrate whenever the neck moves.');
});
$('camera').onclick=guard(async()=>{
 await stopSource();const epoch=generation;
 const acquired=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080}},audio:false});
 if(epoch!==generation){acquired.getTracks().forEach(t=>t.stop());return;}
 stream=acquired;video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;source=video;await video.play();frame();draw();status('Camera active. Audio remains off until Connect audio.');
});
$('audio').onclick=guard(async()=>{
 if(audioContext)return;if(!video)throw Error('Audio requires a video or live camera source.');
 const epoch=generation;let acquired=null;
 if(stream)acquired=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
 if(epoch!==generation){acquired?.getTracks().forEach(t=>t.stop());return;}
 audioStream=acquired;const localContext=new AudioContext();audioContext=localContext;
 try{await localContext.audioWorklet.addModule('/pitch-processor.js');}catch(e){acquired?.getTracks().forEach(t=>t.stop());if(localContext.state!=='closed')await localContext.close();if(epoch!==generation)return;audioContext=null;throw e;}
 if(epoch!==generation||localContext.state==='closed'){acquired?.getTracks().forEach(t=>t.stop());if(localContext.state!=='closed')await localContext.close();return;}
 const input=acquired?audioContext.createMediaStreamSource(acquired):audioContext.createMediaElementSource(video);
 audioNode=new AudioWorkletNode(audioContext,'pitch-processor');
 audioNode.port.postMessage({type:'config',profile:{fMin:30,fMax:800,windowMs:93,hopMs:23.2,clarityThreshold:0.85,gateDb:-45}});
 const silence=audioContext.createGain();silence.gain.value=0;input.connect(audioNode);audioNode.connect(silence);silence.connect(audioContext.destination);
 audioNode.port.onmessage=e=>{
  const d=e.data;if(d.type!=='frame'||!audioContext)return;
  const at=performance.now()-(audioContext.currentTime-d.t)*1000;
  heard=d.hz>0&&d.clarity>=0.85?{midi:Math.round(69+12*Math.log2(d.hz/440)),hz:d.hz,clarity:d.clarity,at}:null;
  $('heard').textContent=heard?`MIDI ${heard.midi} · ${heard.hz.toFixed(1)} Hz`:'No clear sounded pitch';
 };
 await audioContext.resume();if(!acquired){video.muted=false;await video.play();}
 status(acquired?'Microphone active; monitored silently.':'Video audio active; monitored silently.');
});
async function analyze(){
 if(busy)return;if(!models)throw Error('Load RTMPose first.');if(calibrating)throw Error('Finish or clear calibration first.');
 busy=true;const epoch=generation;
 try{
  frame();const at=performance.now(),videoTime=video?.currentTime??null,audio=heard?{...heard}:null;
  const result=await models.infer(raw);if(epoch!==generation)return;
  const seen=locateTips(result.hands.flatMap(h=>h.points),grid);
  const evidence=compareEvidence(seen,audio,audio?at-audio.at:Infinity);
  last={...result,...evidence,frameAt:at,videoTime,calibration:grid,sourceKind:stream?'camera':video?'video':'image'};
  draw();$('seen').textContent=seen.length?seen.map(p=>`${names[p.string]} / fret ${p.fret} (finger ${p.finger})`).join(' · '):grid?'No confident fret/string candidate':'Calibrate to interpret hand observations';
  $('matched').textContent=evidence.status.replaceAll('-',' ');
  $('output').dataset.hands=String(result.hands.length);
  $('output').textContent=JSON.stringify({hands:result.hands.length,inferenceMs:Math.round(result.ms),visualCandidates:seen,status:evidence.status,heardAtFrame:audio,customJointModel:'not-trained'},null,2);
  status(`${result.hands.length} hand(s) · ${Math.round(result.ms)} ms inference. Geometry baseline, not learned contact recognition.`);
 }finally{busy=false;}
}
$('analyze').onclick=guard(analyze);
$('run').onclick=guard(async()=>{
 if(!models||!source)throw Error('Load models and a source first.');running=!running;
 const loopId=++runId;
 if(running){await video?.play();const loop=async()=>{if(!running||loopId!==runId)return;try{await analyze();}catch(e){running=false;status(e.message);}if(running&&loopId===runId)setTimeout(loop,40);};await loop();}
 status(running?'Continuous analysis active.':'Analysis paused.');
});
$('stop').onclick=guard(async()=>{await stopSource();status('Devices stopped. No camera or microphone remains active.');});
$('calibrate').onclick=guard(()=>{
 if(busy)throw Error('Pause analysis and wait for the current frame.');running=false;runId++;video?.pause();frame();corners=[];grid=null;last=null;calibrating=true;draw();$('calibration').textContent='Click 1: first wire, low E.';
});
$('clear').onclick=()=>{grid=null;corners=[];calibrating=false;last=null;draw();$('seen').textContent='Calibration cleared';$('matched').textContent='Unconfirmed';$('calibration').textContent='No calibration — hand observations only.';};
view.onclick=guard(e=>{
 if(!calibrating)return;const r=view.getBoundingClientRect();corners.push([(e.clientX-r.left)*view.width/r.width,(e.clientY-r.top)*view.height/r.height]);
 if(corners.length===4){try{grid=calibrate(corners,Number($('first').value),Number($('last').value));$('calibration').textContent=`Calibrated wires ${grid.first}–${grid.last}. Recalibrate if the neck moves.`;}finally{calibrating=false;} }else $('calibration').textContent=`Click ${corners.length+1}: ${['','first wire, high G','last wire, low E','last wire, high G'][corners.length]}.`;
 draw();
});
$('export').onclick=guard(()=>{
 if(busy||running||!last)throw Error('Pause analysis after analyzing the frame you want to label.');
 const session=$('session').value.trim(),string=Number($('label-string').value),fret=Number($('label-fret').value);
 if(!session||!Number.isInteger(fret)||fret<0||fret>24)throw Error('Supply a session identifier and valid fret.');
 const record={schema:1,session,split:'unassigned',label:{author:'human',string,fret,tuning:[28,33,38,43]},frame:{width:raw.width,height:raw.height,png:raw.toDataURL('image/png')},observation:last,model:'RTMPose-Hand/hand5-256x256',note:'Geometric candidates are not training labels; contact remains unverified.'};
 const url=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`playing-frame-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Labeled frame downloaded locally. Nothing uploaded.');
});
window.addEventListener('pagehide',()=>{running=false;stream?.getTracks().forEach(t=>t.stop());audioStream?.getTracks().forEach(t=>t.stop());audioContext?.close();});
