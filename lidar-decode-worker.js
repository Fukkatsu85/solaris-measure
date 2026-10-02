let lazModulePromise=null;
async function getLaz(){
 if(!lazModulePromise)lazModulePromise=import('https://esm.sh/laz-perf@0.0.7?bundle&target=es2020').then(m=>m.createLazPerf());
 return lazModulePromise;
}
function parseHeader(buf){
 const v=new DataView(buf);if(buf.byteLength<227)throw new Error('Invalid LAZ node');
 return{
  pointFormat:v.getUint8(104)&15,
  pointLength:v.getUint16(105,true),
  scale:[v.getFloat64(131,true),v.getFloat64(139,true),v.getFloat64(147,true)],
  offset:[v.getFloat64(155,true),v.getFloat64(163,true),v.getFloat64(171,true)]
 };
}
function pip(x,y,poly){
 let inside=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j],hit=((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/((b.y-a.y)||1e-12)+a.x);
  if(hit)inside=!inside;
 }
 return inside;
}
function nodeUrl(ept,key){return ept.replace(/ept\.json$/,'ept-data/'+key+'.laz')}
self.onmessage=async e=>{
 const msg=e.data||{};
 if(msg.type!=='decode')return;
 const {eptUrl,nodes,queryBounds,polygon,maxDecoded=450000,grid=0.45}=msg;
 try{
  const LazPerf=await getLaz(),cells=new Map();let decoded=0,inside=0,files=0;
  const q=queryBounds;
  for(let ni=0;ni<nodes.length;ni++){
   if(decoded>=maxDecoded)break;
   self.postMessage({type:'progress',current:ni+1,total:nodes.length,decoded,inside});
   const r=await fetch(nodeUrl(eptUrl,nodes[ni].key));if(!r.ok)continue;
   const buf=await r.arrayBuffer(),h=parseHeader(buf),lz=new LazPerf.LASZip(),filePtr=LazPerf._malloc(buf.byteLength),pointPtr=LazPerf._malloc(h.pointLength);
   LazPerf.HEAPU8.set(new Uint8Array(buf),filePtr);
   try{
    lz.open(filePtr,buf.byteLength);const n=Math.min(lz.getCount(),maxDecoded-decoded),dv=new DataView(LazPerf.HEAPU8.buffer);
    for(let i=0;i<n;i++){
     lz.getPoint(pointPtr);decoded++;
     const x=dv.getInt32(pointPtr,true)*h.scale[0]+h.offset[0],y=dv.getInt32(pointPtr+4,true)*h.scale[1]+h.offset[1],z=dv.getInt32(pointPtr+8,true)*h.scale[2]+h.offset[2];
     if(x<q[0]||x>q[2]||y<q[1]||y>q[3])continue;
     if(polygon?.length>=3&&!pip(x,y,polygon))continue;
     inside++;
     const gx=Math.floor((x-q[0])/grid),gy=Math.floor((y-q[1])/grid),k=gx+','+gy,prev=cells.get(k);
     if(!prev||z>prev.z)cells.set(k,{x,y,z});
    }
    files++;
   }finally{LazPerf._free(filePtr);LazPerf._free(pointPtr);lz.delete()}
  }
  let pts=[...cells.values()];
  if(pts.length>12000){const step=Math.ceil(pts.length/12000);pts=pts.filter((_,i)=>i%step===0)}
  let minZ=Infinity,maxZ=-Infinity;for(const p of pts){if(p.z<minZ)minZ=p.z;if(p.z>maxZ)maxZ=p.z}
  self.postMessage({type:'done',files,decoded,inside,surfacePoints:pts,minZ:Number.isFinite(minZ)?minZ:null,maxZ:Number.isFinite(maxZ)?maxZ:null});
 }catch(err){self.postMessage({type:'error',error:err?.message||String(err)})}
};