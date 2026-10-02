const json=(d,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8"}});
const EPT_ROOT="https://s3-us-west-2.amazonaws.com/usgs-lidar-public/";
function mercator(lat,lng){return{x:6378137*lng*Math.PI/180,y:6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))}}
function uniq(a){return[...new Set(a.filter(Boolean))]}
function cleanCandidates(src={}){
 const out=[],url=String(src.downloadUrl||""),m=url.match(/\/Projects\/([^/]+)\//i);if(m)out.push(m[1]);
 const title=String(src.title||"").trim();
 if(title){
  out.push(title,title.replace(/\s+/g,"_"));
  const stripped=title
   .replace(/^USGS\s+Lidar\s+Point\s+Cloud\s+/i,"")
   .replace(/^USGS[_\s-]*LPC[_\s-]*/i,"")
   .trim();
  out.push(stripped,stripped.replace(/\s+/g,"_"));
  // TNM tile titles often end with tile coordinates such as "476_4951".
  const noTile=stripped.replace(/[ _-]+\d{2,4}_\d{3,5}$/,"").trim();
  out.push(noTile,noTile.replace(/\s+/g,"_"));
  const noD=noTile.replace(/_D\d+.*$/i,"");out.push(noD,noD.replace(/\s+/g,"_"));
 }
 const sid=String(src.sourceId||"").trim();if(sid)out.push(sid);
 const base=uniq(out.map(s=>s.replace(/\.laz$/i,"").replace(/[^A-Za-z0-9._-]/g,"_").replace(/_+/g,"_").replace(/^_|_$/g,"")));
 const expanded=[...base];
 // Some USGS projects are partitioned into numbered EPT collections:
 // Example MN_CentralMissRiver_B22 -> MN_CentralMissRiver_1_B22 ... _6_B22.
 for(const name of base){
  const m2=name.match(/^(.*)(_B\d{2})$/i);
  if(m2)for(let i=1;i<=12;i++)expanded.push(m2[1]+"_"+i+m2[2]);
 }
 return uniq(expanded);
}
async function probe(name){
 const url=EPT_ROOT+encodeURIComponent(name).replace(/%2F/g,"/")+"/ept.json",r=await fetch(url,{headers:{"User-Agent":"Solaris-Measure/1.0"}});
 if(!r.ok)return null;const meta=await r.json().catch(()=>null);return meta?{name,url,meta}:null;
}
function nodeBounds(key,bounds){
 const [d,x,y,z]=key.split("-").map(Number),[xmin,ymin,zmin,xmax,ymax,zmax]=bounds,n=2**d,dx=(xmax-xmin)/n,dy=(ymax-ymin)/n,dz=(zmax-zmin)/n;
 return[xmin+x*dx,ymin+y*dy,zmin+z*dz,xmin+(x+1)*dx,ymin+(y+1)*dy,zmin+(z+1)*dz];
}
function intersects2D(b,q){return!(b[3]<q[0]||b[0]>q[2]||b[4]<q[1]||b[1]>q[3])}
async function collectNodes(ept,lat,lng,halfMeters=28,maxDepth=18){
 const {x,y}=mercator(lat,lng),q=[x-halfMeters,y-halfMeters,x+halfMeters,y+halfMeters],seen=new Set(),nodes=[];
 async function walk(hkey){
  if(seen.has(hkey))return;seen.add(hkey);
  const u=ept.url.replace(/ept\.json$/,"ept-hierarchy/"+hkey+".json"),r=await fetch(u,{headers:{"User-Agent":"Solaris-Measure/1.0"}});
  if(!r.ok)return;const h=await r.json().catch(()=>null);if(!h)return;
  const deferred=[];
  for(const [key,count] of Object.entries(h)){
   const depth=Number(key.split("-")[0]);if(depth>maxDepth)continue;
   const b=nodeBounds(key,ept.meta.bounds);if(!intersects2D(b,q))continue;
   if(Number(count)===-1)deferred.push(key);
   else if(Number(count)>0)nodes.push({key,count:Number(count),depth,bounds:b});
  }
  for(const key of deferred)await walk(key);
 }
 await walk("0-0-0-0");
 nodes.sort((a,b)=>a.depth-b.depth||a.key.localeCompare(b.key));
 const estimatedPoints=nodes.reduce((s,n)=>s+n.count,0);
 return{queryBounds:q,nodes,estimatedPoints,hierarchyPages:seen.size};
}
export async function onRequestPost({request}){
 const b=await request.json().catch(()=>({})),lat=Number(b.lat),lng=Number(b.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng))return json({error:"lat/lng required"},400);
 const candidates=cleanCandidates(b.source||{});let ept=null;
 const {x:mx,y:my}=mercator(lat,lng);
 for(const name of candidates){
  const p=await probe(name);if(!p)continue;
  const bb=p.meta?.bounds||[];
  const contains=bb.length>=6&&mx>=bb[0]&&mx<=bb[3]&&my>=bb[1]&&my<=bb[4];
  if(contains){ept=p;break}
  if(!ept)ept=p;
 }
 if(!ept)return json({ok:false,error:"USGS coverage exists, but the matching public EPT resource could not be resolved automatically yet.",candidates},422);
 const subset=await collectNodes(ept,lat,lng,Number(b.halfMeters||28),18);
 if(!subset.nodeCount&&candidates.length){
  for(const name of candidates){
   const p=await probe(name);if(!p||p.url===ept.url)continue;
   const s=await collectNodes(p,lat,lng,Number(b.halfMeters||28),18);
   if(s.nodeCount){ept=p;Object.assign(subset,s);break}
  }
 }
 return json({ok:true,ept:{name:ept.name,url:ept.url,dataType:ept.meta.dataType,points:ept.meta.points,bounds:ept.meta.bounds,srs:ept.meta.srs||null,schema:ept.meta.schema||[],span:ept.meta.span||null},subset:{halfMeters:Number(b.halfMeters||28),queryBounds:subset.queryBounds,nodeCount:subset.nodes.length,estimatedPoints:subset.estimatedPoints,hierarchyPages:subset.hierarchyPages,nodes:subset.nodes.slice(0,220)}});
}