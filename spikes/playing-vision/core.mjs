export function hasVisualDetail(rgba) {
 let sum=0,sq=0;const n=rgba.length/4;if(!n)return false;
 for(let i=0;i<rgba.length;i+=4){const v=(rgba[i]+rgba[i+1]+rgba[i+2])/3;sum+=v;sq+=v*v;}
 return sq/n-(sum/n)**2>=4;
}
export function normalizePixels(rgba, rgb) {
 const count=rgba.length/4,out=new Float32Array(count*3);
 const mean=rgb?[123.675,116.28,103.53]:[103.53,116.28,123.675];
 const std=rgb?[58.395,57.12,57.375]:[57.375,57.12,58.395];
 for(let c=0;c<3;c++)for(let i=0;i<count;i++)out[c*count+i]=(rgba[4*i+(rgb?c:2-c)]-mean[c])/std[c];
 return out;
}
export function decodeSimCC(x,y,crop) {
 if(x.length!==21*512||y.length!==21*512)throw Error('Unexpected SimCC shape');
 const points=[];
 for(let k=0;k<21;k++){
  let ix=0,iy=0;for(let j=1;j<512;j++){if(x[k*512+j]>x[k*512+ix])ix=j;if(y[k*512+j]>y[k*512+iy])iy=j;}
  points.push({id:k,x:crop.x+ix/512*crop.size,y:crop.y+iy/512*crop.size,score:Math.min(x[k*512+ix],y[k*512+iy])});
 }
 return points;
}
// Four calibration points: first-wire E, first-wire G, last-wire E, last-wire G.
export function calibrate(points, first, last) {
 if (points.length !== 4 || points.flat().some(v=>!Number.isFinite(v)) || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last > 24 || last <= first) throw Error('Invalid calibration');
 const polygon = [points[0],points[2],points[3],points[1]];
 const turns = polygon.map((p,i)=>{const q=polygon[(i+1)%4],r=polygon[(i+2)%4];return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});
 if (!turns.every(v=>v>1) && !turns.every(v=>v< -1)) throw Error('Corners must form a non-degenerate convex fretboard');
 const targets = [[0,0],[0,1],[1,0],[1,1]], a=[];
 points.forEach(([x,y],i)=>{const [u,v]=targets[i];a.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);});
 for(let c=0;c<8;c++) {
  let pivot=c;for(let r=c+1;r<8;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
  [a[c],a[pivot]]=[a[pivot],a[c]];
  const d=a[c][c];if(Math.abs(d)<1e-9)throw Error('Degenerate calibration');
  for(let j=c;j<=8;j++)a[c][j]/=d;
  for(let r=0;r<8;r++)if(r!==c){const k=a[r][c];for(let j=c;j<=8;j++)a[r][j]-=k*a[c][j];}
 }
 return {points,first,last,h:a.map(row=>row[8])};
}
export function locateTips(tips, grid) {
 if(!grid)return [];
 const result=[],h=grid.h;
 for(const tip of tips) {
  if(![8,12,16,20].includes(tip.id)||tip.score<0.5||![tip.x,tip.y,tip.score].every(Number.isFinite))continue;
  const {x,y}=tip,d=h[6]*x+h[7]*y+1;
  const u=(h[0]*x+h[1]*y+h[2])/d,v=(h[3]*x+h[4]*y+h[5])/d;
  if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v< -0.08||v>1.08)continue;
  const start=2**(-grid.first/12),end=2**(-grid.last/12);
  const fractional=-12*Math.log2(start-u*(start-end));
  // Never infer an open string from an absent fingertip. Near a wire, retain both possibilities.
  const frets=[Math.ceil(fractional)];
  if(Math.abs(fractional-Math.round(fractional))<0.08)frets.push(Math.round(fractional),Math.round(fractional)+1);
  for(let string=0;string<4;string++)if(Math.abs(v*3-string)<=0.35)
   for(const fret of new Set(frets))if(fret>grid.first&&fret<=grid.last)result.push({finger:tip.id,string,fret,midi:[28,33,38,43][string]+fret,score:tip.score});
 }
 return result;
}
export function compareEvidence(seen, heard, deltaMs) {
 const valid = heard && Number.isInteger(heard.midi) && heard.clarity >= 0.85;
 const unique = new Set(seen.map(p => `${p.string}:${p.fret}`));
 const status = !seen.length ? 'unseen' : !valid || !Number.isFinite(deltaMs) || Math.abs(deltaMs) > 150 ? 'unconfirmed' : unique.size !== 1 ? 'ambiguous' : seen[0].midi === heard.midi ? 'pitch-agrees-contact-unverified' : 'disagrees';
 return {status, seen, heard: valid ? heard : null};
}
