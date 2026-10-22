import * as ort from '/runtime/ort.wasm.min.mjs';
import {normalizePixels,decodeSimCC,hasVisualDetail} from './core.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths='/runtime/';
export async function loadModels() {
 let det;
 try {
  det=await ort.InferenceSession.create('/models/detector.onnx',{executionProviders:['wasm']});
  const pose=await ort.InferenceSession.create('/models/pose.onnx',{executionProviders:['wasm']});
  const temp=document.createElement('canvas'),ctx=temp.getContext('2d',{willReadFrequently:true});
  function tensor(frame,size,crop,rgb) {
   temp.width=temp.height=size;ctx.fillStyle=rgb?'black':'rgb(114,114,114)';ctx.fillRect(0,0,size,size);
   if(crop)ctx.drawImage(frame,crop.x,crop.y,crop.size,crop.size,0,0,size,size);
   else {const ratio=Math.min(size/frame.width,size/frame.height);ctx.drawImage(frame,0,0,Math.floor(frame.width*ratio),Math.floor(frame.height*ratio));}
   return new ort.Tensor('float32',normalizePixels(ctx.getImageData(0,0,size,size).data,rgb),[1,3,size,size]);
  }
  return {async infer(frame){
   const start=performance.now(),ratio=Math.min(320/frame.width,320/frame.height);
   temp.width=temp.height=32;ctx.drawImage(frame,0,0,32,32);
   if(!hasVisualDetail(ctx.getImageData(0,0,32,32).data))return {hands:[],ms:performance.now()-start,reason:'insufficient-image-detail'};
   const input=tensor(frame,320,null,false);let out;
   try {out=await det.run({input});} finally {input.dispose();}
   const raw=out.dets.data,boxes=[];
   for(let i=0;i<raw.length;i+=5)if(raw[i+4]>=0.4){
    const b=Array.from(raw.slice(i,i+5));
    if(b.every(Number.isFinite)&&b[2]>b[0]+4&&b[3]>b[1]+4)boxes.push({x1:b[0]/ratio,y1:b[1]/ratio,x2:b[2]/ratio,y2:b[3]/ratio,score:b[4]});
   }
   Object.values(out).forEach(t=>t.dispose());
   boxes.sort((a,b)=>b.score-a.score);
   const hands=[];
   for(const box of boxes.slice(0,2)){
    const size=Math.max(box.x2-box.x1,box.y2-box.y1)*1.25;
    const crop={x:(box.x1+box.x2-size)/2,y:(box.y1+box.y2-size)/2,size};
    const input=tensor(frame,256,crop,true);let out;
    try{out=await pose.run({input});}finally{input.dispose();}
    const points=decodeSimCC(out.simcc_x.data,out.simcc_y.data,crop);
    Object.values(out).forEach(t=>t.dispose());hands.push({box,crop,points});
   }
   return {hands,ms:performance.now()-start};
  },async dispose(){await det.release();await pose.release();}};
 }catch(e){if(det)await det.release();throw e;}
}
