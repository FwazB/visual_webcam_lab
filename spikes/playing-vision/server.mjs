import {createServer} from 'node:http';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const routes=new Map(['index.html','app.mjs','core.mjs','runtime.mjs','style.css'].map(f=>['/'+f,path.join(root,f)]));
routes.set('/',path.join(root,'index.html'));
routes.set('/pitch-processor.js',path.resolve(root,'../../public/worklets/pitch-processor.js'));
for(const f of ['detector.onnx','pose.onnx'])routes.set('/models/'+f,path.join(root,'models',f));
const runtime=path.join(root,'node_modules/onnxruntime-web/dist');
for(const f of await readdir(runtime))if(/^ort(?:-wasm[^/]*|\.wasm\.min)\.(?:mjs|wasm)$/.test(f))routes.set('/runtime/'+f,path.join(runtime,f));
const port=Number(process.env.PORT||4381),host=`127.0.0.1:${port}`;
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.onnx':'application/octet-stream'};
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
 if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==`http://${host}`)||!['GET','HEAD'].includes(req.method)){res.writeHead(403);res.end();return;}
 const file=routes.get(req.url?.split('?')[0]);
 try{
  if(!file||(await lstat(file)).isSymbolicLink())throw Error('Not allowed');
  const data=await readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Playing vision lab: http://${host}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
