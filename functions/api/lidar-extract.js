const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const EPT_ROOT="https://s3-us-west-2.amazonaws.com/usgs-lidar-public/";
function mercator(lat,lng){return{x:6378137*lng*Math.PI/180,y:6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))}}
function uniq(a){return[...new Set(a.filter(Boolean))]}
function cleanCandidates(src={}){
 const out=[];
 const url=String(src.downloadUrl||"");
 const m=url.match(/\/Projects\/([^/]+)\//i);if(m)out.push(m[1]);
 const title=String(src.title||"").trim();
 if(title){
  out.push(title);
  out.push(title.replace(/\s+/g,"_"));
  out.push(title.replace(/^USGS[_\s-]*LPC[_\s-]*/i,"").replace(/\s+/g,"_"));
  out.push(title.replace(/^USGS[_\s-]*LPC[_\s-]*/i,"").replace(/_D\d+.*$/i,"").replace(/\s+/g,"_"));
 }
 const sid=String(src.sourceId||"").trim();if(sid)out.push(sid);
 return uniq(out.map(s=>s.replace(/\.laz$/i,"").replace(/[^A-Za-z0-9._-]/g,"_")));
}
async function probe(name){
 const url=EPT_ROOT+encodeURIComponent(name).replace(/%2F/g,"/")+"/ept.json";
 const r=await fetch(url,{headers:{"User-Agent":"Solaris-Measure/1.0"}});
 if(!r.ok)return null;
 const d=await r.json().catch(()=>null);return d?{name,url,meta:d}:null;
}
function nodeBounds(key,bounds){
 const [d,x,y,z]=key.split("-").map(Number),[xmin,ymin,zmin,xmax,ymax,zmax]=bounds;
 const n=2**d,dx=(xmax-xmin)/n,dy=(ymax-ymin)/n,dz=(zmax-zmin)/n;
 return[xmin+x*dx,ymin+y*dy,zmin+z*dz,xmin+(x+1)*dx,ymin+(y+1)*dy,zmin+(z+1)*dz];
}
function intersects2D(b,q){return!(b[3]<q[0]||b[0]>q[2]||b[4]<q[1]||b[1]>q[3])}
async function collectNodes(ept,lat,lng,halfMeters=28,maxDepth=14){
 const {x,y}=mercator(lat,lng),q=[x-halfMeters,y-halfMeters,x+halfMeters,y+halfMeters];
 const rootUrl=ept.url.replace(/ept\.json$/,"ept-hierarchy/0-0-0-0.json");
 const rr=await fetch(rootUrl,{headers:{"User-Agent":"Solaris-Measure/1.0"}});if(!rr.ok)return{queryBounds:q,nodes:[],estimatedPoints:0,error:"EPT hierarchy unavailable"};
 const root=await rr.json(),nodes=[];let estimated=0;
 for(const [key,count] of Object.entries(root)){
  const depth=Number(key.split("-")[0]);if(depth>maxDepth||count<0)continue;
  const b=nodeBounds(key,ept.meta.bounds);if(!intersects2D(b,q))continue;
  nodes.push({key,count,bounds:b});estimated+=Number(count)||0;
 }
 nodes.sort((a,b)=>a.key.localeCompare(b.key));
 return{queryBounds:q,nodes,estimatedPoints:estimated};
}
export async function onRequestPost({request}){
 const b=await request.json().catch(()=>({})),lat=Number(b.lat),lng=Number(b.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 const candidates=cleanCandidates(b.source||{});
 let ept=null;
 for(const name of candidates){ept=await probe(name);if(ept)break}
 if(!ept)return json({ok:false,error:"USGS coverage exists, but the matching public EPT resource could not be resolved automatically yet.",candidates},422);
 const subset=await collectNodes(ept,lat,lng,Number(b.halfMeters||28),14);
 return json({
   ok:true,
   ept:{name:ept.name,url:ept.url,dataType:ept.meta.dataType,points:ept.meta.points,bounds:ept.meta.bounds,srs:ept.meta.srs||null},
   subset:{
     halfMeters:Number(b.halfMeters||28),
     queryBounds:subset.queryBounds,
     nodeCount:subset.nodes.length,
     estimatedPoints:subset.estimatedPoints,
     nodes:subset.nodes.slice(0,120)
   }
 });
}